import { z } from "zod";
import type { AgentResponse } from "../types.js";

const agentResponseSchema = z.object({
  intent: z.enum([
    "query",
    "schema_explanation",
    "data_discovery",
    "query_explanation",
    "unknown",
  ]),
  sql: z.string().nullable(),
  explanation: z.string(),
  tables_used: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string()),
});

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

export function parseAgentResponse(raw: string): AgentResponse {
  const jsonText = extractJson(raw);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Failed to parse agent JSON response: ${jsonText.slice(0, 200)}`);
  }

  const result = agentResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid agent response shape: ${result.error.message}`);
  }

  return result.data;
}
