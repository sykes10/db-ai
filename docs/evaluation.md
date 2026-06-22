# Evaluation Harness

The product hypothesis lives or dies on one question: **how accurately can the system understand a schema and generate correct SQL?** The eval harness answers that with numbers instead of anecdotes, and makes it repeatable across models and providers.

It directly measures the success criteria from [initial-idea.md](../initial-idea.md): the AI correctly identifies tables, identifies joins, and generates queries that execute successfully.

## Running it

```bash
pnpm cli eval                      # full suite against the configured provider
pnpm cli eval --limit 5            # quick slice (first N cases)
pnpm cli eval --provider ollama --model gemma3:4b   # compare a specific model
pnpm cli eval --provider openai --model gpt-4o      # compare a cloud model
```

Each case runs through the real `askQuestion` pipeline (retrieval → context → LLM → parse), the generated SQL is executed **read-only** against the database, and the result is scored. The command exits non-zero if any query failed to execute or the agent errored — so it doubles as a CI gate.

### Sample output

```
Running 16 eval case(s) against ollama...

[ok  ] count-films            tables 100% exec:ok check:ok (3660ms)
[ok  ] films-per-category     tables 100% exec:ok check:ok (7121ms)
[ok  ] never-rented-films     tables  67% exec:ok (16900ms)
...

=== Eval summary ===
Cases:            16
Generated SQL:    15/16
Executed clean:   15/15 (100%)
Table recall:     98% (avg)
Table precision:  100% (avg)
Answer checks:    7/7 correct
```

## Metrics

For each case ([`EvalCaseResult`](../packages/ai/src/eval/types.ts)):

- **Table recall** — fraction of the expected tables the agent actually selected. *Did it find everything it needed?*
- **Table precision** — fraction of the agent's selected tables that were expected. *Did it avoid dragging in junk?*
- **Executed** — did the generated SQL run read-only without error? (`no-sql` if the agent produced no query.)
- **Answer check** — for cases with a known answer, did the result match?

Table names are normalized before comparison (schema prefix and quoting stripped, lowercased), so `public.Film` and `film` compare equal.

The aggregate `EvalSummary` reports totals, execution rate, average recall/precision, and answer-check accuracy.

## The dataset

[`eval/dataset.ts`](../packages/ai/src/eval/dataset.ts) holds `PAGILA_EVAL_CASES` — questions against the Pagila sample database. A case is:

```ts
interface EvalCase {
  id: string;
  question: string;
  expectedTables: string[];     // the minimal correct table set
  expect?: {
    value?: string | number;    // scalar/aggregate answer (first column of first row)
    rows?: number;              // expected number of returned rows
  };
}
```

Two kinds of checks:

- **`value`** — for aggregate answers, compared against the first column of the first row. Example: *"How many films are in the database?"* → `1000`.
- **`rows`** — for set-returning queries, compared against the row count. Example: *"How many films are in each category?"* → `16` rows.

Cases without an `expect` are still scored on table selection and execution — useful for open-ended questions where the answer isn't a fixed number.

> The committed `value`/`rows` figures were verified against a live Pagila instance and are stable across standard Pagila/Sakila. If your dataset differs, adjust the expectations.

## Adding cases

Append to `PAGILA_EVAL_CASES`:

```ts
{
  id: "active-customers",
  question: "How many customers are currently active?",
  expectedTables: ["customer"],
  expect: { value: 584 },
}
```

Guidelines:

- Set `expectedTables` to the **minimal correct** set — the tables a good answer must touch. The harness measures recall/precision against it.
- Only add a `value`/`rows` check when the answer is **stable and known**. Otherwise leave `expect` off and rely on table + execution scoring.
- Keep `id`s short and kebab-case; they're the row labels in the output.

## Architecture

The runner ([`eval/runner.ts`](../packages/ai/src/eval/runner.ts)) is decoupled from any live connection. It takes a `SqlRunner` callback — `(sql) => { rows, fields }` — which the CLI supplies by wrapping `executeQuery({ readOnly: true })`. This keeps the scoring logic unit-testable and lets you point the suite at any execution backend. Progress callbacks (`onCaseStart` / `onCaseDone`) drive the live per-case output.

## Interpreting results

- **High recall, low execution** → tables are found but SQL is malformed; look at the prompt or model.
- **Low recall** → retrieval missed a table (tune [`retrieveRelevantTables`](../packages/ai/src/context/retrieval.ts), e.g. add a synonym) or the model under-selected.
- **`no-sql` on a query that needs one** → an intent-classification miss; tighten the [system prompt](../packages/ai/src/agent/prompts.ts).
- **Execution clean, answer wrong** → correct shape, wrong logic (bad join, missing filter) — the most interesting failures.

Run the same suite across `gemma3:4b`, `gemma4`, and `gpt-4o` to quantify the local-vs-cloud trade-off before committing to a default model.
