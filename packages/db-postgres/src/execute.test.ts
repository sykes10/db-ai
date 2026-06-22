import { describe, expect, it, vi } from "vitest";
import {
  classifyQuery,
  executeQuery,
  isDestructiveQuery,
  type ExecutorResult,
  type QueryExecutor,
} from "./execute.js";

describe("classifyQuery", () => {
  it("classifies plain reads", () => {
    expect(classifyQuery("SELECT * FROM film")).toBe("read");
    expect(classifyQuery("SELECT 1 UNION SELECT 2")).toBe("read");
    expect(classifyQuery("VALUES (1), (2)")).toBe("read");
  });

  it("classifies a CTE wrapping a SELECT as read", () => {
    expect(classifyQuery("WITH x AS (SELECT 1) SELECT * FROM x")).toBe("read");
  });

  it("classifies writes", () => {
    expect(classifyQuery("INSERT INTO film (title) VALUES ('x')")).toBe("write");
    expect(classifyQuery("UPDATE film SET title = 'x'")).toBe("write");
    expect(classifyQuery("DELETE FROM film")).toBe("write");
  });

  it("classifies DDL", () => {
    expect(classifyQuery("DROP TABLE film")).toBe("ddl");
    expect(classifyQuery("TRUNCATE film")).toBe("ddl");
    expect(classifyQuery("ALTER TABLE film ADD COLUMN x int")).toBe("ddl");
    expect(classifyQuery("CREATE TABLE t (id int)")).toBe("ddl");
  });

  // The key case the old regex classifier missed: a write hidden inside a CTE
  // binding, where the top-level statement is a harmless-looking SELECT.
  it("detects a write hidden in a CTE binding", () => {
    const sql = "WITH d AS (DELETE FROM film RETURNING *) SELECT * FROM d";
    expect(classifyQuery(sql)).toBe("write");
    expect(isDestructiveQuery(sql)).toBe(true);
  });

  it("classifies stacked statements by the most dangerous one", () => {
    expect(classifyQuery("SELECT 1; DROP TABLE film")).toBe("ddl");
    expect(classifyQuery("SELECT 1; UPDATE film SET title = 'x'")).toBe("write");
  });

  it("falls back to a keyword heuristic for unparseable SQL", () => {
    // EXPLAIN is not supported by the parser → fallback treats it as a read.
    expect(classifyQuery("EXPLAIN SELECT 1")).toBe("read");
    // Unparseable but clearly destructive → blocked.
    expect(classifyQuery("DROP TABLE film CASCADE WEIRD SYNTAX !!!")).toBe("ddl");
  });
});

function mockExecutor(overrides: Partial<QueryExecutor> = {}): {
  executor: QueryExecutor;
  query: ReturnType<typeof vi.fn>;
  queryReadOnly: ReturnType<typeof vi.fn>;
} {
  const result: ExecutorResult = { rows: [{ n: 1 }], rowCount: 1, fields: ["n"] };
  const query = vi.fn(async () => result);
  const queryReadOnly = vi.fn(async () => result);
  return {
    executor: { query, queryReadOnly, ...overrides },
    query,
    queryReadOnly,
  };
}

describe("executeQuery", () => {
  it("routes read-only execution through queryReadOnly when available", async () => {
    const { executor, query, queryReadOnly } = mockExecutor();
    await executeQuery(executor, "SELECT 1", { readOnly: true });
    expect(queryReadOnly).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });

  it("falls back to query when no read-only path exists", async () => {
    const { executor, query } = mockExecutor({ queryReadOnly: undefined });
    await executeQuery(executor, "SELECT 1", { readOnly: true });
    expect(query).toHaveBeenCalledOnce();
  });

  it("blocks non-read queries in read-only mode before touching the DB", async () => {
    const { executor, query, queryReadOnly } = mockExecutor();
    await expect(executeQuery(executor, "DELETE FROM film", { readOnly: true })).rejects.toThrow(
      /read-only/,
    );
    expect(query).not.toHaveBeenCalled();
    expect(queryReadOnly).not.toHaveBeenCalled();
  });

  it("appends a LIMIT to unbounded reads", async () => {
    const { executor, queryReadOnly } = mockExecutor();
    await executeQuery(executor, "SELECT * FROM film", { readOnly: true, maxRows: 50 });
    expect(queryReadOnly).toHaveBeenCalledWith("SELECT * FROM film LIMIT 51");
  });

  it("does not append a LIMIT when one is present", async () => {
    const { executor, queryReadOnly } = mockExecutor();
    await executeQuery(executor, "SELECT * FROM film LIMIT 5", { readOnly: true });
    expect(queryReadOnly).toHaveBeenCalledWith("SELECT * FROM film LIMIT 5");
  });
});
