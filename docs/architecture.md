# Architecture

db-ai is a pnpm monorepo organized as a layered pipeline. Each layer is a separate package with a single responsibility, and each depends only on the layers beneath it. The guiding idea: **make the database itself understandable to an LLM**, so that natural-language questions can be answered with grounded, reviewable SQL.

## The five layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5  CLI            packages/cli                         │
│           User-facing commands, prompts, result rendering     │
├─────────────────────────────────────────────────────────────┤
│  Layer 4  AI Agent       packages/ai/agent                    │
│           NL → intent + SQL, JSON parsing, query review       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3  AI Context     packages/ai/context + providers      │
│           Retrieval, schema summarization, prompt assembly,   │
│           LLM provider abstraction (openai/anthropic/ollama)  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2  Schema Intel   packages/core                        │
│           Relationship graph, join-path search, traversal     │
├─────────────────────────────────────────────────────────────┤
│  Layer 1  Connectivity   packages/db-postgres                 │
│           Connections, introspection, read-only execution     │
└─────────────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward: `cli → ai → {core, db-postgres}`, and `db-postgres → core`. `core` has no internal dependencies.

---

## Packages

### `packages/core` — Schema Intelligence Engine

Pure, dependency-free graph engine. It defines the canonical data model ([`DatabaseGraph`](../packages/core/src/types.ts): schemas, tables, columns, foreign keys, indexes) and the algorithms over it:

- **`getNeighbors`** — adjacent tables via foreign keys, in both directions (outgoing/incoming).
- **`findJoinPath`** — breadth-first search for the shortest FK join path between two tables (default max depth 6). This is what lets the system answer "how do I get from `customer` to `payment`?"
- **`expandFromTables`** — grow a seed set of tables outward by *n* FK hops. Used by retrieval to pull in related tables a question implies but doesn't name.
- **`formatRelationshipTree`** — the ASCII tree rendered by `db-ai graph`.

Tables are keyed by a `schema.name` id (`tableId` / `parseTableId`), the stable identity used throughout the system.

### `packages/db-postgres` — Database Connectivity

Everything Postgres-specific lives here, so higher layers stay database-agnostic (the model the rest of the app sees is `core`'s `DatabaseGraph`, not Postgres rows).

- **`connection.ts`** — a thin pooled client over `pg` (`max: 5`, 30s statement timeout, optional SSL). `createPostgresClient` validates the connection with `SELECT 1` on startup.
- **`introspect.ts`** — `introspectSchema` queries `information_schema` and `pg_catalog` to assemble the full `DatabaseGraph`: tables/views, columns, primary keys, foreign keys (with update/delete rules), and indexes. System schemas (`pg_catalog`, `information_schema`, `pg_toast`) are excluded.
- **`execute.ts`** — query classification and safe execution:
  - `classifyQuery` → `read` | `write` | `ddl`
  - `isDestructiveQuery` → true for writes/DDL
  - `executeQuery` enforces read-only mode (rejects non-`read` queries), auto-appends a `LIMIT` to unbounded reads, and reports truncation.

### `packages/ai` — Context Engine + Agent

The heart of the system. Three sub-areas:

**`context/`** — turns a question + the full graph into a compact, relevant prompt:
- `retrieval.ts` — keyword retrieval (see [Retrieval](#retrieval-how-relevant-tables-are-chosen)).
- `summary.ts` — renders each selected table as a markdown block (columns with types/PK/nullability, outgoing/incoming FKs).
- `build.ts` — `buildContext` assembles the final `ContextPacket`: relevant schema sections + discovered join paths + (opt-in) sample rows + the user question.

**`providers/`** — the LLM abstraction. A single `LLMProvider` interface (`complete(messages) → string`) with three implementations (`openai`, `anthropic`, `ollama`) selected by `createLLMProvider`. See [docs/providers.md](providers.md).

**`agent/`** — orchestration:
- `prompts.ts` — the system prompt and the strict JSON response schema the model must return.
- `agent.ts` — `askQuestion` / `explainQuery` wire context-building to the provider and enforce the privacy gate.
- `parse.ts` — tolerant parsing of the model's JSON (handles markdown fences) into a typed `AgentResponse`.

Plus `review.ts` (safety classification + output formatting) and `eval/` (the accuracy harness — see [docs/evaluation.md](evaluation.md)).

### `packages/cli` — Desktop-CLI

[commander](https://github.com/tj/commander.js)-based CLI. Each command opens a Postgres client, introspects, does its work, and closes. `config.ts` loads `.env` and builds the sample-data fetcher; `prompt.ts` handles interactive confirmation and flag validation.

---

## The `ask` request lifecycle

What happens when you run `db-ai ask "Which actor has appeared in the most films?"`:

```
   question
      │
      ▼
┌──────────────┐   1. introspectSchema(client) ──► DatabaseGraph (all tables, FKs, indexes)
│  CLI: ask    │
└──────┬───────┘
       ▼
┌────────────────────┐   2. privacy gate: assertPrivacyModeAllowsExternal(mode, provider)
│  ai: askQuestion   │      (local-only blocks cloud providers; Ollama always allowed)
└──────┬─────────────┘
       ▼
┌────────────────────┐   3. buildContext(graph, question)
│  ai: buildContext  │      a. retrieveRelevantTables  → score + expand 1 FK hop, cap at 8
│                    │      b. summarizeTable          → markdown schema sections
│                    │      c. buildJoinPathDescriptions→ BFS join paths between them
│                    │      d. (full-ai only) sample rows
└──────┬─────────────┘      ⇒ ContextPacket.promptText
       ▼
┌────────────────────┐   4. createLLMProvider(config) → openai | anthropic | ollama
│  ai: runAgent      │      llm.complete([system, prompt]) → raw JSON
│                    │   5. parseAgentResponse(raw) → { intent, sql, explanation,
└──────┬─────────────┘                                   tables_used, confidence, warnings }
       ▼
┌────────────────────┐   6. reviewAgentResponse(response) → classification, isDestructive
│  CLI: review +     │      • destructive  → block
│       execute      │      • else         → confirm → executeQuery(readOnly) → results grid
└────────────────────┘
```

The key property: **the model only ever sees a small, relevant slice of the schema** (default 8 tables out of however many exist), not the entire database. This keeps prompts cheap, focused, and accurate.

---

## Retrieval: how relevant tables are chosen

Sending an entire schema to an LLM is expensive and dilutes accuracy. `retrieveRelevantTables` ([retrieval.ts](../packages/ai/src/context/retrieval.ts)) selects only what a question needs, with no embeddings or external calls:

1. **Tokenize** the question — lowercase, strip stop-words, and expand domain **synonyms** (`spent → payment, amount`; `movies → film`; `users → customer`).
2. **Score** every table against the tokens: table-name match (+10), name-part match (+6), column-name match (+4). Singular/plural variants count.
3. **Seed** with the top scorers, then **expand one FK hop** (`expandFromTables`) to pull in join partners the question implies (e.g. `actor` → `film_actor`).
4. **Cap** at `maxTables` (default 8) and **skip partition children** (`payment_p2022_01` when `payment` exists).
5. **Fallback** — if nothing matches, return the most-connected base tables (the schema's core entities).

This is deliberately a simple, transparent, deterministic heuristic. It's a clean seam to later swap in embedding-based retrieval (Layer 3 in the vision) behind the same interface.

---

## Safety model

Generated SQL is never executed blindly:

1. **Classification** — `classifyQuery` labels every statement `read` / `write` / `ddl` via pattern matching.
2. **Review** — `reviewAgentResponse` blocks destructive statements (write/DDL) outright, requiring manual handling.
3. **Read-only execution** — `executeQuery({ readOnly: true })` refuses anything that isn't a `read`, and bounds result size with an automatic `LIMIT`.
4. **Human in the loop** — the CLI shows the SQL and asks for confirmation before executing (unless `--yes`).

Transparency is a product principle: the generated SQL is *always* shown, and `db-ai context` lets you inspect the exact prompt with no model call at all.

---

## Privacy model

Three modes control what leaves the machine (full detail in [docs/providers.md](providers.md)):

| Mode | Schema sent | Row data sent | External calls |
|---|---|---|---|
| `local-only` | local model only | no | **blocked for cloud providers** |
| `schema-sharing` (default) | yes | no | allowed |
| `full-ai` | yes | sampled rows (opt-in) | allowed |

The gate (`assertPrivacyModeAllowsExternal`) treats Ollama as local — so `local-only` + Ollama is a fully offline path where neither schema nor data ever leaves the host.

---

## Design decisions & trade-offs

- **Monorepo with a hard layer boundary.** `core` and `db-postgres` know nothing about LLMs; `ai` knows nothing about the CLI. Adding a second database driver or a desktop UI means adding a package, not rewiring existing ones.
- **`DatabaseGraph` as the universal contract.** Every layer above connectivity speaks this one model. A future `db-mysql` package just needs to produce a `DatabaseGraph`.
- **Provider behind one interface.** `LLMProvider.complete()` is the entire surface. OpenAI and Ollama share an SDK (Ollama is OpenAI-compatible); Anthropic uses its own.
- **Deterministic retrieval first.** Keyword + graph expansion is debuggable and free; embeddings can slot in behind `retrieveRelevantTables` later.
- **JSON-only agent contract.** The model must return a fixed schema, parsed defensively — which is also exactly what makes the [eval harness](evaluation.md) possible.

## Where to extend

| Goal | Touch |
|---|---|
| New database engine | New `packages/db-*` producing a `DatabaseGraph` |
| New LLM provider | Add to `packages/ai/src/providers/` + `factory.ts` ([providers.md](providers.md)) |
| Smarter retrieval | `retrieveRelevantTables` in `context/retrieval.ts` |
| New agent capability | Extend the intent set in `prompts.ts` + `types.ts` |
| Measure accuracy | Add cases to `eval/dataset.ts` ([evaluation.md](evaluation.md)) |
