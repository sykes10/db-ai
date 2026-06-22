import type { AiConfig, AiProviderName, LLMProvider, Message } from "../types.js";

export interface CreateProviderOptions {
  provider?: AiProviderName;
  model?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
}

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  ollama: "gemma3",
};

export function resolveAiConfig(overrides: CreateProviderOptions = {}): AiConfig {
  const provider = (overrides.provider ??
    process.env.DB_AI_LLM ??
    "openai") as AiProviderName;

  if (provider !== "openai" && provider !== "anthropic" && provider !== "ollama") {
    throw new Error(`Unsupported provider: ${provider}. Use openai, anthropic, or ollama.`);
  }

  const model = overrides.model ?? process.env.DB_AI_MODEL ?? DEFAULT_MODELS[provider];

  return {
    provider,
    model,
    privacyMode: (process.env.DB_AI_PRIVACY_MODE as AiConfig["privacyMode"]) ?? "schema-sharing",
    openaiApiKey: overrides.openaiApiKey ?? process.env.OPENAI_API_KEY,
    anthropicApiKey: overrides.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
    ollamaBaseUrl: overrides.ollamaBaseUrl ?? process.env.DB_AI_OLLAMA_BASE_URL,
  };
}

/** Ollama runs locally, so its calls never leave the machine. */
export function isLocalProvider(provider: AiProviderName): boolean {
  return provider === "ollama";
}

export async function createLLMProvider(
  options: CreateProviderOptions = {},
): Promise<LLMProvider> {
  const config = resolveAiConfig(options);
  const { provider, model } = config;

  if (provider === "ollama") {
    const { createOllamaProvider } = await import("./ollama.js");
    return createOllamaProvider(model, config.ollamaBaseUrl);
  }

  if (provider === "openai") {
    if (!config.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is required when DB_AI_LLM=openai");
    }
    const { createOpenAIProvider } = await import("./openai.js");
    return createOpenAIProvider(config.openaiApiKey, model);
  }

  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when DB_AI_LLM=anthropic");
  }
  const { createAnthropicProvider } = await import("./anthropic.js");
  return createAnthropicProvider(config.anthropicApiKey, model);
}

export function assertPrivacyModeAllowsExternal(
  privacyMode: AiConfig["privacyMode"],
  provider?: AiProviderName,
): void {
  if (provider && isLocalProvider(provider)) {
    return;
  }
  if (privacyMode === "local-only") {
    throw new Error(
      "Privacy mode is local-only. External LLM calls are disabled. Use a local provider (DB_AI_LLM=ollama) or set DB_AI_PRIVACY_MODE=schema-sharing.",
    );
  }
}
