const DESTRUCTIVE_PATTERN =
  /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY\s+\S+\s+FROM)\b/i;

export type QueryClassification = "read" | "write" | "ddl";

export function classifyQuery(sql: string): QueryClassification {
  const trimmed = sql.trim();
  if (/^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE)\b/i.test(trimmed)) {
    return "read";
  }
  if (/^\s*(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(trimmed)) {
    return "ddl";
  }
  if (DESTRUCTIVE_PATTERN.test(trimmed)) {
    return "write";
  }
  return "read";
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

export interface QueryExecutor {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; fields: string[] }>;
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

  const result = await executor.query(limitedSql);
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
