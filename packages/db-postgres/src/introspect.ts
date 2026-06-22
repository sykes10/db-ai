import {
  type Column,
  type DatabaseGraph,
  type ForeignKey,
  type Index,
  type Schema,
  type Table,
  type TableKind,
  tableId,
} from "@db-ai/core";
import type { PostgresClient } from "./connection.js";

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];

interface TableRow {
  table_schema: string;
  table_name: string;
  table_type: string;
}

interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
}

interface PrimaryKeyRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
}

interface ForeignKeyRow {
  constraint_name: string;
  from_schema: string;
  from_table: string;
  from_column: string;
  to_schema: string;
  to_table: string;
  to_column: string;
  update_rule: string;
  delete_rule: string;
}

interface IndexRow {
  index_name: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  is_unique: boolean;
  is_primary: boolean;
}

export async function introspectSchema(client: PostgresClient): Promise<DatabaseGraph> {
  const dbResult = await client.query<{ database: string }>(
    "SELECT current_database() AS database",
  );
  const database = dbResult.rows[0]?.database ?? "unknown";

  const tablesResult = await client.query<TableRow>(
    `
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema NOT IN (${SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(", ")})
      AND table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY table_schema, table_name
  `,
    SYSTEM_SCHEMAS,
  );

  const columnsResult = await client.query<ColumnRow>(
    `
    SELECT table_schema, table_name, column_name, data_type,
           is_nullable, column_default, ordinal_position
    FROM information_schema.columns
    WHERE table_schema NOT IN (${SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(", ")})
    ORDER BY table_schema, table_name, ordinal_position
  `,
    SYSTEM_SCHEMAS,
  );

  const pkResult = await client.query<PrimaryKeyRow>(
    `
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name,
      kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema NOT IN (${SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(", ")})
    ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
  `,
    SYSTEM_SCHEMAS,
  );

  const fkResult = await client.query<ForeignKeyRow>(
    `
    SELECT
      tc.constraint_name,
      kcu.table_schema AS from_schema,
      kcu.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_schema AS to_schema,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
      AND rc.unique_constraint_schema = ccu.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND kcu.table_schema NOT IN (${SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(", ")})
    ORDER BY from_schema, from_table, tc.constraint_name, kcu.ordinal_position
  `,
    SYSTEM_SCHEMAS,
  );

  const indexResult = await client.query<IndexRow>(
    `
    SELECT
      i.relname AS index_name,
      n.nspname AS table_schema,
      t.relname AS table_name,
      a.attname AS column_name,
      array_position(ix.indkey, a.attnum) AS ordinal_position,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE n.nspname NOT IN (${SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(", ")})
      AND t.relkind IN ('r', 'v')
    ORDER BY n.nspname, t.relname, i.relname, ordinal_position
  `,
    SYSTEM_SCHEMAS,
  );

  const primaryKeys = groupPrimaryKeys(pkResult.rows);
  const columnsByTable = groupColumns(columnsResult.rows);
  const indexes = groupIndexes(indexResult.rows);

  const tables: Table[] = tablesResult.rows.map((row) => {
    const id = tableId(row.table_schema, row.table_name);
    const kind: TableKind = row.table_type === "VIEW" ? "view" : "table";
    return {
      id,
      schema: row.table_schema,
      name: row.table_name,
      kind,
      columns: columnsByTable.get(id) ?? [],
      primaryKey: primaryKeys.get(id) ?? [],
    };
  });

  const foreignKeys: ForeignKey[] = fkResult.rows.map((row) => ({
    name: row.constraint_name,
    fromSchema: row.from_schema,
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toSchema: row.to_schema,
    toTable: row.to_table,
    toColumn: row.to_column,
    onUpdate: row.update_rule,
    onDelete: row.delete_rule,
  }));

  const schemas = buildSchemas(tables);

  return {
    database,
    schemas,
    tables,
    foreignKeys,
    indexes,
  };
}

function groupColumns(rows: ColumnRow[]): Map<string, Column[]> {
  const map = new Map<string, Column[]>();

  for (const row of rows) {
    const id = tableId(row.table_schema, row.table_name);
    const columns = map.get(id) ?? [];
    columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
      defaultValue: row.column_default,
      ordinalPosition: row.ordinal_position,
    });
    map.set(id, columns);
  }

  return map;
}

function groupPrimaryKeys(rows: PrimaryKeyRow[]): Map<string, string[]> {
  const map = new Map<string, PrimaryKeyRow[]>();

  for (const row of rows) {
    const id = tableId(row.table_schema, row.table_name);
    const group = map.get(id) ?? [];
    group.push(row);
    map.set(id, group);
  }

  const result = new Map<string, string[]>();
  for (const [id, group] of map) {
    result.set(
      id,
      group.sort((a, b) => a.ordinal_position - b.ordinal_position).map((r) => r.column_name),
    );
  }
  return result;
}

function groupIndexes(rows: IndexRow[]): Index[] {
  const map = new Map<string, IndexRow[]>();

  for (const row of rows) {
    const key = `${row.table_schema}.${row.table_name}.${row.index_name}`;
    const group = map.get(key) ?? [];
    group.push(row);
    map.set(key, group);
  }

  return [...map.values()].map((group) => {
    const first = group[0]!;
    const sorted = group.sort((a, b) => (a.ordinal_position ?? 0) - (b.ordinal_position ?? 0));
    return {
      name: first.index_name,
      schema: first.table_schema,
      table: first.table_name,
      columns: sorted.map((r) => r.column_name),
      unique: first.is_unique,
      primary: first.is_primary,
    };
  });
}

function buildSchemas(tables: Table[]): Schema[] {
  const map = new Map<string, Table[]>();

  for (const table of tables) {
    const group = map.get(table.schema) ?? [];
    group.push(table);
    map.set(table.schema, group);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, schemaTables]) => ({
      name,
      tables: schemaTables.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export async function introspectFromConnectionString(
  connectionString: string,
): Promise<DatabaseGraph> {
  const { createPostgresClient } = await import("./connection.js");
  const client = await createPostgresClient({ connectionString });
  try {
    return await introspectSchema(client);
  } finally {
    await client.close();
  }
}
