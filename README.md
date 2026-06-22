# db-ai

An **AI-native database client**. Instead of bolting a chat sidebar onto a SQL editor, db-ai builds a structural understanding of your database — tables, columns, foreign-key relationships — and uses it to turn natural-language questions into correct, reviewable SQL.

> Developers don't want AI-generated SQL. They want answers. SQL is just the implementation detail.

This repository is the **CLI prototype** that validates the core hypothesis: connect to Postgres, introspect the schema, build a relationship graph, and answer questions accurately while keeping the user in control.

```
$ db-ai ask "How many films are in each category?"
Intent: query
Confidence: high

Counts films per category by joining film_category to category and grouping by name.

Tables: public.film_category, public.category

SQL:
SELECT c.name AS category, COUNT(fc.film_id) AS film_count
FROM film_category fc JOIN category c ON fc.category_id = c.category_id
GROUP BY c.name;

Execute this query? [y/N]
```

---

## Why this is different

| | Traditional clients (DataGrip, DBeaver, TablePlus) | db-ai |
|---|---|---|
| Primary interface | SQL editor | Natural language |
| Schema awareness | You hold it in your head | Introspected relationship graph |
| AI | Chat sidebar that guesses | Grounded in the actual schema |
| Safety | Manual | Generated SQL classified + reviewed before execution |
| Privacy | — | Local-first; choose what leaves the machine |

---

## Quick start

**Prerequisites:** Node ≥ 20, [pnpm](https://pnpm.io), Docker (for the sample DB), and optionally [Ollama](https://ollama.com) for local models.

```bash
# 1. Install dependencies and build the workspace
pnpm install
pnpm build

# 2. Start the sample Pagila database (Postgres on :5433)
pnpm db:up

# 3. Configure the LLM provider
cp .env.example .env
#   edit .env — set DB_AI_LLM and the matching API key, or use Ollama (below)

# 4. Verify everything is wired up
pnpm cli health        # database connectivity
pnpm cli llm-health     # LLM provider / Ollama reachability

# 5. Ask a question
pnpm cli ask "Which actor has appeared in the most films?"
```

> `pnpm cli <args>` runs the CLI from source via `tsx`. After `pnpm build` you can also run the compiled binary directly: `node packages/cli/dist/index.js <args>`.

### Using a local model (Ollama)

No API key, and your schema never leaves the machine:

```bash
ollama pull gemma3            # or gemma2, llama3, etc.
```

```ini
# .env
DB_AI_LLM=ollama
DB_AI_MODEL=gemma3
DB_AI_OLLAMA_BASE_URL=http://localhost:11434/v1
DB_AI_PRIVACY_MODE=local-only
```

See [docs/providers.md](docs/providers.md) for all providers and privacy modes.

---

## Commands

| Command | Description |
|---|---|
| `health` | Check database connectivity |
| `llm-health` | Check the configured LLM provider (pings the server for Ollama) |
| `introspect [-o file]` | Introspect the schema and build the relationship graph |
| `graph --from <table> [--depth n]` | Show the relationship tree from a table |
| `path --from <a> --to <b>` | Find the join path between two tables |
| `context <question>` | Build the AI context packet for a question — **no LLM call** |
| `ask <question>` | Natural language → SQL, with review and optional execution |
| `explain-query --sql <q>` | Explain an existing SQL query in plain English |
| `eval [--limit n]` | Run the accuracy eval suite against the configured LLM |

Common flags: `--url <connectionString>`, `--provider <openai\|anthropic\|ollama>`, `--model <name>`, `--mode <local-only\|schema-sharing\|full-ai>`.

Inspect exactly what gets sent to the model — without making a call — with `context`:

```bash
pnpm cli context "customers who spent more than 100 this year"
```

---

## Configuration

Set in `.env` (loaded from the repo root). See [.env.example](.env.example).

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | — |
| `DB_AI_LLM` | `openai` \| `anthropic` \| `ollama` | `openai` |
| `DB_AI_MODEL` | Model name (provider-specific) | per-provider default |
| `DB_AI_PRIVACY_MODE` | `local-only` \| `schema-sharing` \| `full-ai` | `schema-sharing` |
| `DB_AI_OLLAMA_BASE_URL` | Ollama OpenAI-compatible endpoint | `http://localhost:11434/v1` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Cloud provider keys | — |

`.env` is gitignored — credentials never get committed.

---

## Documentation

- **[docs/architecture.md](docs/architecture.md)** — the five layers, package responsibilities, and the full request lifecycle.
- **[docs/providers.md](docs/providers.md)** — LLM providers, privacy modes, and adding a new provider.
- **[docs/evaluation.md](docs/evaluation.md)** — the eval harness, metrics, and how to extend the dataset.

---

## Project layout

```
packages/
  core/         Relationship-graph engine (graph build, BFS join paths, traversal)
  db-postgres/  Postgres connectivity, schema introspection, read-only execution
  ai/           Context retrieval, agent, LLM providers, query review, eval harness
  cli/          The `db-ai` command-line interface
docker/         Pagila sample-database init
docs/           Architecture and design documentation
```

---

## Development

```bash
pnpm build      # build all packages (tsc -r)
pnpm test       # run the vitest suites
pnpm db:reset   # tear down and recreate the sample database
```

## Status

Prototype. Proving the core hypothesis (accurate schema understanding + safe SQL generation) before building the full desktop client described in [initial-idea.md](initial-idea.md). Supported database: **PostgreSQL**. Planned: MySQL, SQL Server, SQLite.
