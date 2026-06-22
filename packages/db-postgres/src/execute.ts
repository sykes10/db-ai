import { parse, type Statement } from "pgsql-ast-parser";

export type QueryClassification = "read" | "write" | "ddl";

const READ_TYPES = new Set(["select", "union", "values", "show"]);
const WRITE_TYPES = new Set(["insert", "update", "delete"]);

const RANK: Record<QueryClassification, number> = { read: 0, write: 1, ddl: 2 };

/** The most dangerous classification wins (ddl > write > read). */
function mostDangerous(classes: QueryClassification[]): QueryClassification {
  return classes.reduce<QueryClassification>((acc, c) => (RANK[c] > RANK[acc] ? c : acc), "read");
}

/** A CTE statement (`WITH ... AS (...)`) carries its real operation in `bind`/`in`. */
function isCteStatement(stmt: Statement): stmt is Statement & {
  bind: { statement: Statement }[];
  in: Statement;
} {
  return "bind" in stmt && Array.isArray((stmt as { bind?: unknown }).bind) && "in" in stmt;
}

function classifyStatement(stmt: Statement): QueryClassification {
  // Recurse into CTEs so a write hidden in a binding — e.g.
  // `WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d` — is not seen as a read.
  if (isCteStatement(stmt)) {
    return mostDangerous([
      ...stmt.bind.map((b) => classifyStatement(b.statement)),
      classifyStatement(stmt.in),
    ]);
  }
  if (READ_TYPES.has(stmt.type)) return "read";
  if (WRITE_TYPES.has(stmt.type)) return "write";
  // Everything else (create/alter/drop/truncate/grant/revoke/…) is treated as DDL.
  return "ddl";
}

const DDL_LEADING = /^\s*(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i;
const WRITE_LEADING = /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i;
const DESTRUCTIVE_ANYWHERE =
  /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|DROP\b|TRUNCATE\b|ALTER\b|CREATE\b|GRANT\b|REVOKE\b)/i;

/**
 * Keyword heuristic used only when the parser cannot build an AST (e.g. EXPLAIN
 * or syntax pgsql-ast-parser does not support). Errs toward blocking: any
 * destructive keyword anywhere escalates to DDL.
 */
function classifyFallback(sql: string): QueryClassification {
  const trimmed = sql.trim();
  if (DDL_LEADING.test(trimmed)) return "ddl";
  if (WRITE_LEADING.test(trimmed)) return "write";
  if (DESTRUCTIVE_ANYWHERE.test(trimmed)) return "ddl";
  return "read";
}

/**
 * Classify a SQL string as read / write / ddl using a real Postgres parser.
 * Multiple statements and CTE-hidden writes are classified by their most
 * dangerous operation; unparseable input falls back to a keyword heuristic.
 */
export function classifyQuery(sql: string): QueryClassification {
  try {
    const statements = parse(sql);
    if (statements.length === 0) return "read";
    return mostDangerous(statements.map(classifyStatement));
  } catch {
    return classifyFallback(sql);
  }
}

export function isDestructiveQuery(sql: string): boolean {
  const kind = classifyQuery(sql);
  return kind === "write" || kind === "ddl";
}

export interface ExecuteOptions {
  readOnly?: boolean;
  maxRows?: number;
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
  classification: QueryClassification;
  truncated: boolean;
}

export interface ExecutorResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
}

export interface QueryExecutor {
  query(sql: string, params?: unknown[]): Promise<ExecutorResult>;
  /**
   * Run a query inside a `READ ONLY` transaction. When present, `executeQuery`
   * uses it for read-only execution so the database itself rejects any write —
   * defense-in-depth that holds even if classification is wrong.
   */
  queryReadOnly?(sql: string, params?: unknown[]): Promise<ExecutorResult>;
}

export async function executeQuery(
  executor: QueryExecutor,
  sql: string,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const { readOnly = true, maxRows = 1000 } = options;
  const classification = classifyQuery(sql);

  if (readOnly && classification !== "read") {
    throw new Error(
      `Query blocked in read-only mode (${classification}): ${sql.trim().slice(0, 80)}`,
    );
  }

  const limitedSql =
    classification === "read" && !/\bLIMIT\b/i.test(sql)
      ? `${sql.trim().replace(/;$/, "")} LIMIT ${maxRows + 1}`
      : sql;

  // Prefer the transactional read-only path when the executor supports it.
  const run =
    readOnly && executor.queryReadOnly
      ? executor.queryReadOnly.bind(executor)
      : executor.query.bind(executor);

  const result = await run(limitedSql);
  const truncated = result.rows.length > maxRows;
  const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;

  return {
    rows,
    rowCount: rows.length,
    fields: result.fields,
    classification,
    truncated,
  };
}
