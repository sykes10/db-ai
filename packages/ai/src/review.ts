import { classifyQuery, isDestructiveQuery } from "@db-ai/db-postgres";
import type { AgentResponse } from "./types.js";

export interface ReviewResult {
  approved: boolean;
  classification: ReturnType<typeof classifyQuery>;
  isDestructive: boolean;
  reason?: string;
}

export function reviewAgentResponse(response: AgentResponse): ReviewResult {
  if (!response.sql) {
    return {
      approved: true,
      classification: "read",
      isDestructive: false,
    };
  }

  const classification = classifyQuery(response.sql);
  const isDestructive = isDestructiveQuery(response.sql);

  return {
    approved: !isDestructive,
    classification,
    isDestructive,
    reason: isDestructive
      ? "Query appears destructive (write/DDL). Manual review required."
      : undefined,
  };
}

export function formatAgentResponse(response: AgentResponse): string {
  const lines = [
    `Intent: ${response.intent}`,
    `Confidence: ${response.confidence}`,
    "",
    response.explanation,
  ];

  if (response.tables_used.length > 0) {
    lines.push("", `Tables: ${response.tables_used.join(", ")}`);
  }

  if (response.sql) {
    lines.push("", "SQL:", response.sql);
  }

  if (response.warnings.length > 0) {
    lines.push("", "Warnings:", ...response.warnings.map((w) => `- ${w}`));
  }

  return lines.join("\n");
}

export function formatResultsTable(
  rows: Record<string, unknown>[],
  fields: string[],
  truncated: boolean,
): string {
  if (rows.length === 0) {
    return "(no rows)";
  }

  const widths = fields.map((field) => {
    const values = rows.map((row) => String(row[field] ?? ""));
    return Math.min(40, Math.max(field.length, ...values.map((v) => v.length)));
  });

  const header = fields.map((f, i) => f.padEnd(widths[i]!)).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-+-");
  const body = rows
    .map((row) =>
      fields
        .map((f, i) => String(row[f] ?? "").slice(0, widths[i]).padEnd(widths[i]!))
        .join(" | "),
    )
    .join("\n");

  const footer = truncated ? "\n(row limit reached — results truncated)" : "";
  return `${header}\n${separator}\n${body}${footer}`;
}
