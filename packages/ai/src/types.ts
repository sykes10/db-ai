export type AiPrivacyMode = "local-only" | "schema-sharing" | "full-ai";

export type AiProviderName = "openai" | "anthropic" | "ollama";

export interface AiConfig {
  provider: AiProviderName;
  model: string;
  privacyMode: AiPrivacyMode;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
}

export type AgentIntent =
  | "query"
  | "schema_explanation"
  | "data_discovery"
  | "query_explanation"
  | "unknown";

export type AgentConfidence = "high" | "medium" | "low";

export interface AgentResponse {
  intent: AgentIntent;
  sql: string | null;
  explanation: string;
  tables_used: string[];
  confidence: AgentConfidence;
  warnings: string[];
}

export interface TableSummary {
  id: string;
  schema: string;
  name: string;
  kind: string;
  columnSummary: string;
  primaryKey: string[];
  foreignKeysOut: string[];
  foreignKeysIn: string[];
}

export interface ContextPacket {
  question: string;
  database: string;
  privacyMode: AiPrivacyMode;
  totalTables: number;
  selectedTables: TableSummary[];
  joinPaths: string[];
  sampleData?: Record<string, Record<string, unknown>[]>;
  promptText: string;
}

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  name: AiProviderName;
  complete(messages: Message[]): Promise<string>;
}

export interface AskOptions {
  privacyMode?: AiPrivacyMode;
  sampleRowLimit?: number;
  sampleFetcher?: SampleDataFetcher;
}

export interface SampleDataFetcher {
  sampleTable(schema: string, table: string, limit: number): Promise<Record<string, unknown>[]>;
}
