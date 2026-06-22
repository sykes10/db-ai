import { describe, expect, it } from "vitest";
import { parseAgentResponse } from "./parse.js";

describe("parseAgentResponse", () => {
  it("parses valid JSON", () => {
    const raw = JSON.stringify({
      intent: "query",
      sql: "SELECT 1",
      explanation: "Returns one row.",
      tables_used: ["customer"],
      confidence: "high",
      warnings: [],
    });

    const result = parseAgentResponse(raw);
    expect(result.intent).toBe("query");
    expect(result.sql).toBe("SELECT 1");
  });

  it("extracts JSON from markdown fences", () => {
    const raw = 'Here is the result:\n```json\n{"intent":"data_discovery","sql":null,"explanation":"Payment status is in payment.amount","tables_used":["payment"],"confidence":"high","warnings":[]}\n```';
    const result = parseAgentResponse(raw);
    expect(result.intent).toBe("data_discovery");
    expect(result.tables_used).toContain("payment");
  });
});
