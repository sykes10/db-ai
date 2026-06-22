import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertPrivacyModeAllowsExternal, isLocalProvider, resolveAiConfig } from "./factory.js";

const ENV_KEYS = [
  "DB_AI_LLM",
  "DB_AI_MODEL",
  "DB_AI_PRIVACY_MODE",
  "DB_AI_OLLAMA_BASE_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

describe("resolveAiConfig (ollama)", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults the model to gemma3 when provider is ollama", () => {
    const config = resolveAiConfig({ provider: "ollama" });
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("gemma3");
  });

  it("reads provider, model, and base url from env", () => {
    process.env.DB_AI_LLM = "ollama";
    process.env.DB_AI_MODEL = "gemma4:latest";
    process.env.DB_AI_OLLAMA_BASE_URL = "http://example.local:11434/v1";

    const config = resolveAiConfig();
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("gemma4:latest");
    expect(config.ollamaBaseUrl).toBe("http://example.local:11434/v1");
  });

  it("lets explicit overrides win over env", () => {
    process.env.DB_AI_MODEL = "gemma3:4b";
    const config = resolveAiConfig({ provider: "ollama", model: "gemma4:latest" });
    expect(config.model).toBe("gemma4:latest");
  });

  it("rejects unknown providers", () => {
    expect(() => resolveAiConfig({ provider: "mistral" as never })).toThrow(/Unsupported provider/);
  });
});

describe("local provider privacy handling", () => {
  it("treats ollama as a local provider", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("openai")).toBe(false);
    expect(isLocalProvider("anthropic")).toBe(false);
  });

  it("allows ollama under local-only mode", () => {
    expect(() => assertPrivacyModeAllowsExternal("local-only", "ollama")).not.toThrow();
  });

  it("blocks cloud providers under local-only mode", () => {
    expect(() => assertPrivacyModeAllowsExternal("local-only", "openai")).toThrow(/local-only/);
    expect(() => assertPrivacyModeAllowsExternal("local-only")).toThrow(/local-only/);
  });

  it("allows any provider under schema-sharing mode", () => {
    expect(() => assertPrivacyModeAllowsExternal("schema-sharing", "openai")).not.toThrow();
  });
});
