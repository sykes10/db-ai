import type { LLMProvider, Message } from "../types.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Ollama exposes an OpenAI-compatible API, so we reuse the OpenAI SDK pointed at
 * the local Ollama server. The API key is unused by Ollama but required by the SDK.
 */
export interface OllamaHealth {
  reachable: boolean;
  baseUrl: string;
  models: string[];
  /** True when the requested model tag is present on the server. */
  modelAvailable?: boolean;
  error?: string;
}

/** Strip the trailing OpenAI-compat `/v1` segment to reach Ollama's native API. */
function toNativeRoot(baseURL: string): string {
  return baseURL.replace(/\/v1\/?$/, "");
}

/**
 * Ping the Ollama server and list installed models. Used by the CLI health check.
 * Never throws — failures are reported via the returned object.
 */
export async function checkOllamaHealth(
  baseURL: string = DEFAULT_OLLAMA_BASE_URL,
  model?: string,
  timeoutMs = 4000,
): Promise<OllamaHealth> {
  const url = `${toNativeRoot(baseURL)}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { reachable: false, baseUrl: baseURL, models: [], error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { models?: { name?: string }[] };
    const models = (body.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string");
    return {
      reachable: true,
      baseUrl: baseURL,
      models,
      modelAvailable: model ? models.includes(model) : undefined,
    };
  } catch (err) {
    return {
      reachable: false,
      baseUrl: baseURL,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createOllamaProvider(
  model: string,
  baseURL: string = DEFAULT_OLLAMA_BASE_URL,
): LLMProvider {
  return {
    name: "ollama",
    async complete(messages: Message[]): Promise<string> {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: "ollama", baseURL });

      const response = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error(`Ollama (${model}) returned an empty response`);
      }
      return content;
    },
  };
}
