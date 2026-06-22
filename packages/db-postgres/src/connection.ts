import pg from "pg";

export interface PostgresConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  /** Query timeout in milliseconds. Default: 30000 */
  queryTimeoutMs?: number;
}

export interface PostgresClient {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
  /**
   * Run a query inside a `BEGIN TRANSACTION READ ONLY` block that is always
   * rolled back. Postgres rejects any write or DDL at the engine level, so this
   * is the hard guarantee behind read-only execution of generated SQL.
   */
  queryReadOnly<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
  close(): Promise<void>;
}

export async function createPostgresClient(config: PostgresConfig): Promise<PostgresClient> {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    statement_timeout: config.queryTimeoutMs ?? 30_000,
    max: 5,
  });

  await pool.query("SELECT 1");

  return {
    async query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) {
      return pool.query<T>(sql, params);
    },
    async queryReadOnly<T extends pg.QueryResultRow = pg.QueryResultRow>(
      sql: string,
      params?: unknown[],
    ) {
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN TRANSACTION READ ONLY");
        return await conn.query<T>(sql, params);
      } finally {
        try {
          await conn.query("ROLLBACK");
        } catch {
          // Connection may already be aborted; releasing is what matters.
        }
        conn.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function healthCheck(config: PostgresConfig): Promise<{ ok: true; database: string }> {
  const client = await createPostgresClient(config);
  try {
    const result = await client.query<{ database: string }>(
      "SELECT current_database() AS database",
    );
    const database = result.rows[0]?.database;
    if (!database) {
      throw new Error("Could not determine current database");
    }
    return { ok: true, database };
  } finally {
    await client.close();
  }
}
