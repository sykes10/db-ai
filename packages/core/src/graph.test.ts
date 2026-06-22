import { describe, expect, it } from "vitest";
import {
  type DatabaseGraph,
  expandFromTables,
  findJoinPath,
  findTableByName,
  formatRelationshipTree,
  getNeighbors,
  tableId,
} from "./types.js";

const sampleGraph: DatabaseGraph = {
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
        {
          name: "customer_id",
          dataType: "integer",
          nullable: false,
          defaultValue: null,
          ordinalPosition: 1,
        },
        {
          name: "email",
          dataType: "text",
          nullable: false,
          defaultValue: null,
          ordinalPosition: 2,
        },
      ],
    },
    {
      id: tableId("public", "rental"),
      schema: "public",
      name: "rental",
      kind: "table",
      primaryKey: ["rental_id"],
      columns: [
        {
          name: "rental_id",
          dataType: "integer",
          nullable: false,
          defaultValue: null,
          ordinalPosition: 1,
        },
        {
          name: "customer_id",
          dataType: "integer",
          nullable: false,
          defaultValue: null,
          ordinalPosition: 2,
        },
      ],
    },
    {
      id: tableId("public", "payment"),
      schema: "public",
      name: "payment",
      kind: "table",
      primaryKey: ["payment_id"],
      columns: [
        {
          name: "payment_id",
          dataType: "integer",
          nullable: false,
          defaultValue: null,
          ordinalPosition: 1,
        },
        {
          name: "rental_id",
          dataType: "integer",
          nullable: false,
          defaultValue: null,
          ordinalPosition: 2,
        },
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
    {
      name: "payment_rental_id_fkey",
      fromSchema: "public",
      fromTable: "payment",
      fromColumn: "rental_id",
      toSchema: "public",
      toTable: "rental",
      toColumn: "rental_id",
      onUpdate: "NO ACTION",
      onDelete: "NO ACTION",
    },
  ],
  indexes: [],
};

describe("graph utilities", () => {
  it("finds neighbors in both directions", () => {
    const customerNeighbors = getNeighbors(sampleGraph, "public", "customer");
    expect(customerNeighbors).toHaveLength(1);
    expect(customerNeighbors[0]?.table.name).toBe("rental");
    expect(customerNeighbors[0]?.direction).toBe("incoming");
  });

  it("finds join path between related tables", () => {
    const path = findJoinPath(sampleGraph, "public", "customer", "public", "payment");
    expect(path).not.toBeNull();
    expect(path?.tables).toEqual([
      tableId("public", "customer"),
      tableId("public", "rental"),
      tableId("public", "payment"),
    ]);
  });

  it("expands from seed tables", () => {
    const expanded = expandFromTables(sampleGraph, ["customer"], 1);
    const names = expanded.map((t) => t.name).sort();
    expect(names).toEqual(["customer", "rental"]);
  });

  it("formats relationship tree", () => {
    const tree = formatRelationshipTree(sampleGraph, "public", "customer", 2);
    expect(tree).toContain("customer");
    expect(tree).toContain("rental");
  });

  it("finds table by name case-insensitively", () => {
    expect(findTableByName(sampleGraph, "CUSTOMER")?.name).toBe("customer");
  });
});
