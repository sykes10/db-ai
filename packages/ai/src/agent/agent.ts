import type { DatabaseGraph } from "@db-ai/core";
import { buildContext } from "../context/build.js";
import { buildAskPrompt, buildExplainQueryPrompt, SYSTEM_PROMPT } from "./prompts.js";
import { parseAgentResponse } from "./parse.js";
import {
  assertPrivacyModeAllowsExternal,
  createLLMProvider,
  resolveAiConfig,
  type CreateProviderOptions,
} from "../providers/factory.js";
import type {
  AgentResponse,
  AiPrivacyMode,
  AskOptions,
  LLMProvider,
  SampleDataFetcher,
} from "../types.js";

export interface AgentOptions extends CreateProviderOptions {
  provider?: CreateProviderOptions["provider"];
  llm?: LLMProvider;
}

async function runAgent(
  userPrompt: string,
  options: AgentOptions = {},
): Promise<AgentResponse> {
  const llm = options.llm ?? (await createLLMProvider(options));
  const raw = await llm.complete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);
  return parseAgentResponse(raw);
}

export async function askQuestion(
  graph: DatabaseGraph,
  question: string,
  options: AgentOptions & AskOptions = {},
): Promise<{ context: Awaited<ReturnType<typeof buildContext>>; response: AgentResponse }> {
  const privacyMode = options.privacyMode ?? "schema-sharing";
  assertPrivacyModeAllowsExternal(privacyMode, resolveAiConfig(options).provider);

  const context = await buildContext(graph, question, {
    privacyMode,
    sampleRowLimit: options.sampleRowLimit,
    sampleFetcher: options.sampleFetcher,
  });

  const response = await runAgent(buildAskPrompt(context.promptText), options);
  return { context, response };
}

export async function explainQuery(
  graph: DatabaseGraph,
  sql: string,
  options: AgentOptions & { privacyMode?: AiPrivacyMode; sampleFetcher?: SampleDataFetcher } = {},
): Promise<AgentResponse> {
  const privacyMode = options.privacyMode ?? "schema-sharing";
  assertPrivacyModeAllowsExternal(privacyMode, resolveAiConfig(options).provider);

  const context = await buildContext(graph, `Explain SQL: ${sql.slice(0, 120)}`, {
    privacyMode,
    sampleFetcher: options.sampleFetcher,
  });

  return runAgent(buildExplainQueryPrompt(sql, context.promptText), options);
}

export async function buildContextOnly(
  graph: DatabaseGraph,
  question: string,
  options: AskOptions & { sampleFetcher?: SampleDataFetcher } = {},
) {
  return buildContext(graph, question, {
    privacyMode: options.privacyMode ?? "schema-sharing",
    sampleRowLimit: options.sampleRowLimit,
    sampleFetcher: options.sampleFetcher,
  });
}
