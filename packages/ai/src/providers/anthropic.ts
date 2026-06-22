import type { LLMProvider, Message } from "../types.js";

export function createAnthropicProvider(apiKey: string, model: string): LLMProvider {
  return {
    name: "anthropic",
    async complete(messages: Message[]): Promise<string> {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const conversation = messages.filter((m) => m.role !== "system");

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages: conversation.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Anthropic returned an empty response");
      }
      return textBlock.text;
    },
  };
}
