import type { DatabaseGraph } from "@db-ai/core";
import { askQuestion } from "../agent/agent.js";
import { reviewAgentResponse } from "../review.js";
import type { EvalCase, EvalCaseResult, EvalOptions, EvalSummary } from "./types.js";

export interface SqlRunResult {
  rows: Record<string, unknown>[];
  fields: string[];
}

/** Executes generated SQL read-only and returns rows + column names. */
export type SqlRunner = (sql: string) => Promise<SqlRunResult>;

/** Drop schema qualifier and quoting so "public.Film" and "film" compare equal. */
export function normalizeTable(name: string): string {
  const bare = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  return bare.trim().toLowerCase().replace(/["'`]/g, "");
}

function scoreTables(expected: string[], predicted: string[]) {
  const exp = expected.map(normalizeTable);
  const pred = predicted.map(normalizeTable);
  const intersection = exp.filter((t) => pred.includes(t));
  return {
    expected: exp,
    predicted: pred,
    recall: exp.length === 0 ? 1 : intersection.length / exp.length,
    precision: pred.length === 0 ? (exp.length === 0 ? 1 : 0) : intersection.length / pred.length,
  };
}

export async function runEvalCase(
  graph: DatabaseGraph,
  runSql: SqlRunner,
  evalCase: EvalCase,
  options: EvalOptions = {},
): Promise<EvalCaseResult> {
  const started = Date.now();
  const result: EvalCaseResult = {
    id: evalCase.id,
    question: evalCase.question,
    intent: "unknown",
    sql: null,
    predictedTables: [],
    expectedTables: evalCase.expectedTables.map(normalizeTable),
    tablesRecall: 0,
    tablesPrecision: 0,
    executed: null,
    checkOk: null,
    durationMs: 0,
  };

  try {
    const { response } = await askQuestion(graph, evalCase.question, {
      provider: options.provider,
      model: options.model,
      privacyMode: options.privacyMode,
    });

    const tables = scoreTables(evalCase.expectedTables, response.tables_used);
    result.intent = response.intent;
    result.sql = response.sql;
    result.predictedTables = tables.predicted;
    result.tablesRecall = tables.recall;
    result.tablesPrecision = tables.precision;

    if (response.sql) {
      const review = reviewAgentResponse(response);
      if (!review.approved) {
        result.executed = false;
        result.execError = review.reason ?? "blocked by review";
      } else {
        try {
          const { rows, fields } = await runSql(response.sql);
          result.executed = true;
          result.rowCount = rows.length;
          result.checkOk = evaluateCheck(evalCase, rows, fields);
        } catch (err) {
          result.executed = false;
          result.execError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - started;
  return result;
}

function evaluateCheck(
  evalCase: EvalCase,
  rows: Record<string, unknown>[],
  fields: string[],
): boolean | null {
  const expect = evalCase.expect;
  if (!expect) return null;

  if (expect.value !== undefined) {
    const firstField = fields[0];
    const got = firstField !== undefined ? rows[0]?.[firstField] : undefined;
    if (got === undefined || got === null) return false;
    return String(got).trim() === String(expect.value).trim();
  }

  if (expect.rows !== undefined) {
    return rows.length === expect.rows;
  }

  return null;
}

export async function runEval(
  graph: DatabaseGraph,
  runSql: SqlRunner,
  cases: EvalCase[],
  options: EvalOptions = {},
): Promise<EvalSummary> {
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    options.onCaseStart?.(evalCase);
    const result = await runEvalCase(graph, runSql, evalCase, options);
    results.push(result);
    options.onCaseDone?.(result);
  }
  return summarize(results);
}

export function summarize(results: EvalCaseResult[]): EvalSummary {
  const withSql = results.filter((r) => r.sql !== null);
  const executed = results.filter((r) => r.executed === true);
  const checked = results.filter((r) => r.checkOk !== null);
  const checksCorrect = checked.filter((r) => r.checkOk === true);
  const avg = (nums: number[]) =>
    nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;

  return {
    total: results.length,
    withSql: withSql.length,
    executed: executed.length,
    executionRate: withSql.length === 0 ? 0 : executed.length / withSql.length,
    avgTablesRecall: avg(results.map((r) => r.tablesRecall)),
    avgTablesPrecision: avg(results.map((r) => r.tablesPrecision)),
    checks: checked.length,
    checksCorrect: checksCorrect.length,
    agentErrors: results.filter((r) => r.error).length,
    results,
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function formatEvalCaseLine(r: EvalCaseResult): string {
  const exec = r.error
    ? "AGENT-ERR"
    : r.executed === null
      ? "no-sql"
      : r.executed
        ? "exec:ok"
        : "exec:FAIL";
  const check = r.checkOk === null ? "" : r.checkOk ? " check:ok" : " check:FAIL";
  const status = r.error || r.executed === false || r.checkOk === false ? "FAIL" : "ok";
  return `[${status.padEnd(4)}] ${r.id.padEnd(22)} tables ${pct(r.tablesRecall).padStart(4)} ${exec}${check} (${r.durationMs}ms)`;
}

export function formatEvalSummary(summary: EvalSummary): string {
  const lines = [
    "=== Eval summary ===",
    `Cases:            ${summary.total}`,
    `Generated SQL:    ${summary.withSql}/${summary.total}`,
    `Executed clean:   ${summary.executed}/${summary.withSql} (${pct(summary.executionRate)})`,
    `Table recall:     ${pct(summary.avgTablesRecall)} (avg)`,
    `Table precision:  ${pct(summary.avgTablesPrecision)} (avg)`,
    `Answer checks:    ${summary.checksCorrect}/${summary.checks} correct`,
  ];
  if (summary.agentErrors > 0) {
    lines.push(`Agent errors:     ${summary.agentErrors}`);
  }
  return lines.join("\n");
}
