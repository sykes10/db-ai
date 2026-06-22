import type { DatabaseGraph } from "@db-ai/core";
import type {
  AiPrivacyMode,
  ContextPacket,
  SampleDataFetcher,
} from "../types.js";
import { buildJoinPathDescriptions, retrieveRelevantTables } from "./retrieval.js";
import { formatSampleData, formatTableSummary, summarizeTable } from "./summary.js";

export interface BuildContextOptions {
  privacyMode?: AiPrivacyMode;
  maxTables?: number;
  sampleRowLimit?: number;
  sampleFetcher?: SampleDataFetcher;
}

export async function buildContext(
  graph: DatabaseGraph,
  question: string,
  options: BuildContextOptions = {},
): Promise<ContextPacket> {
  const {
    privacyMode = "schema-sharing",
    maxTables = 8,
    sampleRowLimit = 3,
    sampleFetcher,
  } = options;

  const tables = retrieveRelevantTables(graph, question, { maxTables });
  const selectedTables = tables.map((t) => summarizeTable(graph, t));
  const joinPaths = buildJoinPathDescriptions(graph, tables);

  const tableSections = selectedTables.map(formatTableSummary).join("\n\n");
  const joinSection =
    joinPaths.length > 0
      ? `\n\n## Join paths between selected tables\n${joinPaths.map((p) => `- ${p}`).join("\n")}`
      : "";

  let sampleData: Record<string, Record<string, unknown>[]> | undefined;
  let sampleSection = "";

  if (privacyMode === "full-ai" && sampleFetcher) {
    sampleData = {};
    const sampleLines: string[] = [];

    for (const table of tables.slice(0, 5)) {
      const rows = await sampleFetcher.sampleTable(table.schema, table.name, sampleRowLimit);
      sampleData[table.name] = rows;
      sampleLines.push(formatSampleData(table.name, rows));
    }

    sampleSection = `\n\n## Sample data (opt-in)\n${sampleLines.join("\n\n")}`;
  }

  const promptText = [
    `Database: ${graph.database} (PostgreSQL)`,
    `Total tables: ${graph.tables.length}. Showing ${selectedTables.length} relevant tables.`,
    "",
    "## Relevant schema",
    tableSections,
    joinSection,
    sampleSection,
    "",
    "## User question",
    question,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    question,
    database: graph.database,
    privacyMode,
    totalTables: graph.tables.length,
    selectedTables,
    joinPaths,
    sampleData,
    promptText,
  };
}
