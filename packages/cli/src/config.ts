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
