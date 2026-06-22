import type { AiPrivacyMode } from "../types.js";

/**
 * Optional correctness check for a case. Use `value` for scalar/aggregate answers
 * (compared against the first column of the first row) or `rows` for the expected
 * number of returned rows.
 */
export interface EvalExpectation {
  value?: string | number;
  rows?: number;
}

export interface EvalCase {
  id: string;
  question: string;
  /** Minimal correct set of tables (names only, schema optional — normalized on compare). */
  expectedTables: string[];
  expect?: EvalExpectation;
}

export interface EvalCaseResult {
  id: string;
  question: string;
  intent: string;
  sql: string | null;
  predictedTables: string[];
  expectedTables: string[];
  /** Fraction of expected tables the agent selected. */
  tablesRecall: number;
  /** Fraction of selected tables that were expected. */
  tablesPrecision: number;
  /** true = ran clean, false = errored/blocked, null = agent produced no SQL. */
  executed: boolean | null;
  execError?: string;
  rowCount?: number;
  /** true/false when the case defines a check and SQL executed; null otherwise. */
  checkOk: boolean | null;
  /** Set when the agent itself failed (LLM/parse error). */
  error?: string;
  durationMs: number;
}

export interface EvalSummary {
  total: number;
  withSql: number;
  executed: number;
  executionRate: number;
  avgTablesRecall: number;
  avgTablesPrecision: number;
  checks: number;
  checksCorrect: number;
  agentErrors: number;
  results: EvalCaseResult[];
}

export interface EvalOptions {
  provider?: import("../providers/factory.js").CreateProviderOptions["provider"];
  model?: string;
  privacyMode?: AiPrivacyMode;
  onCaseStart?: (evalCase: EvalCase) => void;
  onCaseDone?: (result: EvalCaseResult) => void;
}
