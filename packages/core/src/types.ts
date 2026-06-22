export type TableKind = "table" | "view";

export interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
}

export interface ForeignKey {
  name: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface Index {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface Table {
  id: string;
  schema: string;
  name: string;
  kind: TableKind;
  columns: Column[];
  primaryKey: string[];
}

export interface Schema {
  name: string;
  tables: Table[];
}

export interface DatabaseGraph {
  database: string;
  schemas: Schema[];
  tables: Table[];
  foreignKeys: ForeignKey[];
  indexes: Index[];
}

export function tableId(schema: string, name: string): string {
  return `${schema}.${name}`;
}

export function parseTableId(id: string): { schema: string; name: string } {
  const dot = id.indexOf(".");
  if (dot === -1) {
    return { schema: "public", name: id };
  }
  return {
    schema: id.slice(0, dot),
    name: id.slice(dot + 1),
  };
}

export function findTable(graph: DatabaseGraph, schema: string, name: string): Table | undefined {
  const id = tableId(schema, name);
  return graph.tables.find((t) => t.id === id);
}

export function findTableByName(graph: DatabaseGraph, name: string): Table | undefined {
  const lower = name.toLowerCase();
  return graph.tables.find((t) => t.name.toLowerCase() === lower);
}

export interface GraphNeighbor {
  table: Table;
  via: ForeignKey;
  direction: "outgoing" | "incoming";
}

export function getNeighbors(graph: DatabaseGraph, schema: string, tableName: string): GraphNeighbor[] {
  const id = tableId(schema, tableName);
  const neighbors: GraphNeighbor[] = [];

  for (const fk of graph.foreignKeys) {
    const fromId = tableId(fk.fromSchema, fk.fromTable);
    const toId = tableId(fk.toSchema, fk.toTable);

    if (fromId === id) {
      const table = findTable(graph, fk.toSchema, fk.toTable);
      if (table) {
        neighbors.push({ table, via: fk, direction: "outgoing" });
      }
    }

    if (toId === id) {
      const table = findTable(graph, fk.fromSchema, fk.fromTable);
      if (table) {
        neighbors.push({ table, via: fk, direction: "incoming" });
      }
    }
  }

  return neighbors;
}

export interface JoinPath {
  tables: string[];
  joins: ForeignKey[];
}

export function findJoinPath(
  graph: DatabaseGraph,
  fromSchema: string,
  fromTable: string,
  toSchema: string,
  toTable: string,
  maxDepth = 6,
): JoinPath | null {
  const start = tableId(fromSchema, fromTable);
  const goal = tableId(toSchema, toTable);

  if (start === goal) {
    return { tables: [start], joins: [] };
  }

  const queue: Array<{ id: string; path: string[]; joins: ForeignKey[] }> = [
    { id: start, path: [start], joins: [] },
  ];
  const visited = new Set<string>([start]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) {
      continue;
    }

    const { schema, name } = parseTableId(current.id);
    const neighbors = getNeighbors(graph, schema, name);

    for (const neighbor of neighbors) {
      const nextId = neighbor.table.id;
      if (visited.has(nextId)) {
        continue;
      }

      const nextPath = [...current.path, nextId];
      const nextJoins = [...current.joins, neighbor.via];

      if (nextId === goal) {
        return { tables: nextPath, joins: nextJoins };
      }

      visited.add(nextId);
      queue.push({ id: nextId, path: nextPath, joins: nextJoins });
    }
  }

  return null;
}

export function expandFromTables(
  graph: DatabaseGraph,
  tableNames: string[],
  hops = 1,
): Table[] {
  const selected = new Map<string, Table>();

  for (const name of tableNames) {
    const table = findTableByName(graph, name);
    if (table) {
      selected.set(table.id, table);
    }
  }

  let frontier = [...selected.keys()];

  for (let i = 0; i < hops; i++) {
    const nextFrontier: string[] = [];

    for (const id of frontier) {
      const { schema, name } = parseTableId(id);
      for (const neighbor of getNeighbors(graph, schema, name)) {
        if (!selected.has(neighbor.table.id)) {
          selected.set(neighbor.table.id, neighbor.table);
          nextFrontier.push(neighbor.table.id);
        }
      }
    }

    frontier = nextFrontier;
  }

  return [...selected.values()];
}

export function formatRelationshipTree(
  graph: DatabaseGraph,
  schema: string,
  tableName: string,
  depth = 2,
): string {
  const root = findTable(graph, schema, tableName);
  if (!root) {
    return `Table not found: ${schema}.${tableName}`;
  }

  const lines: string[] = [];
  const visited = new Set<string>();

  function walk(table: Table, prefix: string, isLast: boolean, remainingDepth: number) {
    const connector = prefix.length === 0 ? "" : isLast ? "└── " : "├── ";
    lines.push(`${prefix}${connector}${table.name}`);

    if (remainingDepth <= 0 || visited.has(table.id)) {
      return;
    }
    visited.add(table.id);

    const childPrefix = prefix + (prefix.length === 0 ? "" : isLast ? "    " : "│   ");
    const neighbors = getNeighbors(graph, table.schema, table.name);

    neighbors.forEach((neighbor, index) => {
      walk(neighbor.table, childPrefix, index === neighbors.length - 1, remainingDepth - 1);
    });
  }

  walk(root, "", true, depth);
  return lines.join("\n");
}
