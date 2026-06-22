import { describe, expect, it } from "vitest";
import { tableId, type DatabaseGraph } from "@db-ai/core";
import { retrieveRelevantTables, tokenizeQuestion } from "./retrieval.js";

const graph: DatabaseGraph = {
  database: "test",
  schemas: [],
  tables: [
    {
      id: tableId("public", "customer"),
      schema: "public",
      name: "customer",
      kind: "table",
      primaryKey: ["customer_id"],
      columns: [
        { name: "customer_id", dataType: "integer", nullable: false, defaultValue: null, ordinalPosition: 1 },
        { name: "email", dataType: "text", nullable: false, defaultValue: null, ordinalPosition: 2 },
      ],
    },
    {
      id: tableId("public", "rental"),
      schema: "public",
      name: "rental",
      kind: "table",
      primaryKey: ["rental_id"],
      columns: [
        { name: "rental_id", dataType: "integer", nullable: false, defaultValue: null, ordinalPosition: 1 },
        { name: "customer_id", dataType: "integer", nullable: false, defaultValue: null, ordinalPosition: 2 },
      ],
    },
    {
      id: tableId("public", "payment"),
      schema: "public",
      name: "payment",
      kind: "table",
      primaryKey: ["payment_id"],
      columns: [
        { name: "payment_id", dataType: "integer", nullable: false, defaultValue: null, ordinalPosition: 1 },
      ],
    },
    {
      id: tableId("public", "payment_p2022_01"),
      schema: "public",
      name: "payment_p2022_01",
      kind: "table",
      primaryKey: ["payment_id"],
      columns: [
        { name: "payment_id", dataType: "integer", nullable: false, defaultValue: null, ordinalPosition: 1 },
        { name: "customer_id", dataType: "integer", nullable: false, defaultValue: null, ordinalPosition: 2 },
      ],
    },
    {
      id: tableId("public", "film"),
      schema: "public",
      name: "film",
      kind: "table",
      primaryKey: ["film_id"],
      columns: [
        { name: "film_id", dataType: "integer", nullable: false, defaultValue: null, ordinalPosition: 1 },
        { name: "title", dataType: "text", nullable: false, defaultValue: null, ordinalPosition: 2 },
      ],
    },
  ],
  foreignKeys: [
    {
      name: "rental_customer_id_fkey",
      fromSchema: "public",
      fromTable: "rental",
      fromColumn: "customer_id",
      toSchema: "public",
      toTable: "customer",
      toColumn: "customer_id",
      onUpdate: "NO ACTION",
      onDelete: "NO ACTION",
    },
  ],
  indexes: [],
};

describe("tokenizeQuestion", () => {
  it("removes stop words", () => {
    expect(tokenizeQuestion("Show customers who spent more")).toContain("customers");
    expect(tokenizeQuestion("Show customers who spent more")).not.toContain("who");
  });
});

describe("retrieveRelevantTables", () => {
  it("finds customer and related tables for rental question", () => {
    const tables = retrieveRelevantTables(graph, "customers with active rentals");
    const names = tables.map((t) => t.name);
    expect(names).toContain("customer");
    expect(names).toContain("rental");
  });

  it("excludes partition child tables when parent exists", () => {
    const tables = retrieveRelevantTables(graph, "payment totals by customer");
    const names = tables.map((t) => t.name);
    expect(names).toContain("payment");
    expect(names).not.toContain("payment_p2022_01");
  });

  it("finds film table for film question", () => {
    const tables = retrieveRelevantTables(graph, "list all film titles");
    expect(tables.map((t) => t.name)).toContain("film");
  });
});
