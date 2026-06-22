import { type DatabaseGraph, type Table } from "@db-ai/core";
import type { TableSummary } from "../types.js";

export function summarizeTable(graph: DatabaseGraph, table: Table): TableSummary {
  const columnSummary = table.columns
    .slice(0, 20)
    .map((c) => {
      const pk = table.primaryKey.includes(c.name) ? " PK" : "";
      const nullable = c.nullable ? "" : " NOT NULL";
      return `${c.name}: ${c.dataType}${pk}${nullable}`;
    })
    .join(", ");

  const suffix = table.columns.length > 20 ? ` … +${table.columns.length - 20} more` : "";

  const foreignKeysOut = graph.foreignKeys
    .filter((fk) => fk.fromSchema === table.schema && fk.fromTable === table.name)
    .map((fk) => `${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`);

  const foreignKeysIn = graph.foreignKeys
    .filter((fk) => fk.toSchema === table.schema && fk.toTable === table.name)
    .map((fk) => `${fk.fromTable}.${fk.fromColumn} → ${fk.toColumn}`);

  return {
    id: table.id,
    schema: table.schema,
    name: table.name,
    kind: table.kind,
    columnSummary: columnSummary + suffix,
    primaryKey: table.primaryKey,
    foreignKeysOut,
    foreignKeysIn,
  };
}

export function formatTableSummary(summary: TableSummary): string {
  const lines = [
    `### ${summary.schema}.${summary.name} (${summary.kind})`,
    `Columns: ${summary.columnSummary}`,
  ];

  if (summary.primaryKey.length > 0) {
    lines.push(`Primary key: ${summary.primaryKey.join(", ")}`);
  }
  if (summary.foreignKeysOut.length > 0) {
    lines.push(`References: ${summary.foreignKeysOut.join("; ")}`);
  }
  if (summary.foreignKeysIn.length > 0) {
    lines.push(`Referenced by: ${summary.foreignKeysIn.join("; ")}`);
  }

  return lines.join("\n");
}

export function formatSampleData(
  tableName: string,
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) {
    return `Sample rows for ${tableName}: (empty)`;
  }

  const columns = Object.keys(rows[0] ?? {});
  const header = columns.join(" | ");
  const body = rows
    .map((row) => columns.map((col) => String(row[col] ?? "")).join(" | "))
    .join("\n");

  return `Sample rows for ${tableName} (${rows.length}):\n${header}\n${body}`;
}
