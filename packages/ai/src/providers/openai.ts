import type { LLMProvider, Message } from "../types.js";

export function createOpenAIProvider(apiKey: string, model: string): LLMProvider {
  return {
    name: "openai",
    async complete(messages: Message[]): Promise<string> {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey });

      const response = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("OpenAI returned an empty response");
      }
      return content;
    },
  };
}
