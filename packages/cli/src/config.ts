import type { PostgresClient, QueryExecutor } from "@db-ai/db-postgres";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

loadEnv({ path: resolve(rootDir, ".env") });

export function getConnectionString(override?: string): string {
  const url = override ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No database URL provided. Set DATABASE_URL in .env or pass --url postgres://...",
    );
  }
  return url;
}

/**
 * Adapt a PostgresClient to the QueryExecutor interface, exposing both the
 * normal and read-only (transactional) execution paths. Read-only execution of
 * generated SQL goes through `queryReadOnly` so the database enforces safety.
 */
export function createQueryExecutor(client: PostgresClient): QueryExecutor {
  return {
    query: async (sql, params) => {
      const q = await client.query(sql, params);
      return {
        rows: q.rows as Record<string, unknown>[],
        rowCount: q.rowCount ?? q.rows.length,
        fields: q.fields.map((f) => f.name),
      };
    },
    queryReadOnly: async (sql, params) => {
      const q = await client.queryReadOnly(sql, params);
      return {
        rows: q.rows as Record<string, unknown>[],
        rowCount: q.rowCount ?? q.rows.length,
        fields: q.fields.map((f) => f.name),
      };
    },
  };
}

export function createSampleFetcher(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}) {
  return {
    async sampleTable(schema: string, table: string, limit: number) {
      const result = await client.query(`SELECT * FROM "${schema}"."${table}" LIMIT $1`, [limit]);
      return result.rows;
    },
  };
}
