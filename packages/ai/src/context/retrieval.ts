import {
  type DatabaseGraph,
  type Table,
  expandFromTables,
  findJoinPath,
  tableId,
} from "@db-ai/core";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "and",
  "but",
  "or",
  "if",
  "while",
  "show",
  "find",
  "list",
  "get",
  "give",
  "tell",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "me",
  "my",
  "many",
  "much",
  "last",
  "first",
  "top",
  "per",
]);

/** Partition child tables like payment_p2022_01 when payment exists. */
export function isPartitionChild(table: Table, graph: DatabaseGraph): boolean {
  const match = table.name.match(/^(.+)_p\d{4}_\d{2}$/);
  if (!match?.[1]) {
    return false;
  }
  const parent = match[1];
  return (
    graph.tables.some((t) => t.name === parent && t.schema === table.schema && t.kind !== "view") ||
    graph.tables.some((t) => t.name === parent && t.schema === table.schema)
  );
}

const SYNONYMS: Record<string, string[]> = {
  spent: ["payment", "amount"],
  spend: ["payment", "amount"],
  spending: ["payment", "amount"],
  paid: ["payment", "amount"],
  revenue: ["payment", "amount"],
  inactive: ["active", "activebool"],
  movies: ["film"],
  movie: ["film"],
  users: ["customer"],
  user: ["customer"],
};

export function tokenizeQuestion(question: string): string[] {
  const base = question
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  const expanded = new Set(base);
  for (const token of base) {
    for (const synonym of SYNONYMS[token] ?? []) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

function matchesToken(name: string, token: string): boolean {
  if (name === token || name.includes(token) || token.includes(name)) {
    return true;
  }
  if (name.endsWith("s") && name.slice(0, -1) === token) {
    return true;
  }
  if (token.endsWith("s") && token.slice(0, -1) === name) {
    return true;
  }
  return false;
}

export function scoreTable(table: Table, tokens: string[]): number {
  let score = 0;
  const tableName = table.name.toLowerCase();
  const tableTokens = tableName.split("_");

  for (const token of tokens) {
    if (matchesToken(tableName, token)) {
      score += 10;
    }
    if (tableTokens.some((part) => matchesToken(part, token))) {
      score += 6;
    }
    for (const column of table.columns) {
      const col = column.name.toLowerCase();
      if (matchesToken(col, token)) {
        score += 4;
      }
    }
  }

  return score;
}

export interface RetrieveOptions {
  maxTables?: number;
  expansionHops?: number;
}

export function retrieveRelevantTables(
  graph: DatabaseGraph,
  question: string,
  options: RetrieveOptions = {},
): Table[] {
  const { maxTables = 8, expansionHops = 1 } = options;
  const tokens = tokenizeQuestion(question);

  const candidates = graph.tables.filter((t) => !isPartitionChild(t, graph));

  const scored = candidates
    .map((table) => ({ table, score: scoreTable(table, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const seedNames = scored
    .slice(0, Math.max(3, Math.min(maxTables, scored.length)))
    .map((s) => s.table.name);

  if (seedNames.length === 0) {
    // No keyword hits — return core entity tables (non-view, most connected)
    const connectionCount = new Map<string, number>();
    for (const fk of graph.foreignKeys) {
      connectionCount.set(
        tableId(fk.fromSchema, fk.fromTable),
        (connectionCount.get(tableId(fk.fromSchema, fk.fromTable)) ?? 0) + 1,
      );
      connectionCount.set(
        tableId(fk.toSchema, fk.toTable),
        (connectionCount.get(tableId(fk.toSchema, fk.toTable)) ?? 0) + 1,
      );
    }

    return candidates
      .filter((t) => t.kind === "table")
      .sort((a, b) => (connectionCount.get(b.id) ?? 0) - (connectionCount.get(a.id) ?? 0))
      .slice(0, maxTables);
  }

  const expanded = expandFromTables(graph, seedNames, expansionHops);
  const expandedFiltered = expanded.filter((t) => !isPartitionChild(t, graph));

  const expandedScored = expandedFiltered
    .map((table) => ({ table, score: scoreTable(table, tokens) }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const result: Table[] = [];

  for (const entry of expandedScored) {
    if (seen.has(entry.table.id)) {
      continue;
    }
    seen.add(entry.table.id);
    result.push(entry.table);
    if (result.length >= maxTables) {
      break;
    }
  }

  return result;
}

export function buildJoinPathDescriptions(graph: DatabaseGraph, tables: Table[]): string[] {
  const paths: string[] = [];
  const tableList = tables.slice(0, 6);

  for (let i = 0; i < tableList.length; i++) {
    for (let j = i + 1; j < tableList.length; j++) {
      const a = tableList[i]!;
      const b = tableList[j]!;
      const path = findJoinPath(graph, a.schema, a.name, b.schema, b.name);
      if (path && path.joins.length > 0) {
        const joins = path.joins
          .map((j) => `${j.fromTable}.${j.fromColumn} → ${j.toTable}.${j.toColumn}`)
          .join(", ");
        paths.push(
          `${a.name} ↔ ${b.name}: ${path.tables.map((t) => t.split(".")[1]).join(" → ")} (${joins})`,
        );
      }
    }
  }

  return paths;
}
