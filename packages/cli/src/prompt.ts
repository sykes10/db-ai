import type { AiPrivacyMode, AiProviderName } from "@db-ai/ai";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function confirmExecution(message: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

export function parsePrivacyMode(value?: string): AiPrivacyMode {
  const mode = value ?? process.env.DB_AI_PRIVACY_MODE ?? "schema-sharing";
  if (mode === "local-only" || mode === "schema-sharing" || mode === "full-ai") {
    return mode;
  }
  throw new Error(`Invalid privacy mode: ${mode}`);
}

export function parseProvider(value?: string): AiProviderName | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "openai" || value === "anthropic" || value === "ollama") {
    return value;
  }
  throw new Error(`Invalid provider: ${value}`);
}
