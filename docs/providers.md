# LLM Providers & Privacy

db-ai talks to language models through a single abstraction, so the provider is a configuration choice — not a code change. This doc covers the three built-in providers, the privacy modes that govern what data leaves your machine, and how to add a provider.

## The provider interface

Every provider implements one method ([types.ts](../packages/ai/src/types.ts)):

```ts
interface LLMProvider {
  name: AiProviderName; // "openai" | "anthropic" | "ollama"
  complete(messages: Message[]): Promise<string>; // returns the raw model text
}
```

The agent always sends two messages — a system prompt (rules + the required JSON schema) and the assembled context prompt — and expects a JSON object back. Selection and configuration happen in [`factory.ts`](../packages/ai/src/providers/factory.ts) via `resolveAiConfig` + `createLLMProvider`.

## Built-in providers

| Provider  | `DB_AI_LLM` | Default model              | Auth                | Notes                                            |
| --------- | ----------- | -------------------------- | ------------------- | ------------------------------------------------ |
| OpenAI    | `openai`    | `gpt-4o`                   | `OPENAI_API_KEY`    | Chat Completions, `response_format: json_object` |
| Anthropic | `anthropic` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` | Messages API, system prompt passed separately    |
| Ollama    | `ollama`    | `gemma3`                   | none                | Local; uses the OpenAI-compatible `/v1` endpoint |

Configuration precedence for every setting: **explicit CLI flag → environment variable → built-in default**. So `--provider`/`--model` override `.env`, which overrides the defaults above.

### OpenAI

```ini
DB_AI_LLM=openai
DB_AI_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

### Anthropic

```ini
DB_AI_LLM=anthropic
DB_AI_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

### Ollama (local)

[Ollama](https://ollama.com) runs models on your own machine and exposes an OpenAI-compatible API, so db-ai reuses the OpenAI SDK pointed at it (no API key required).

```bash
# install a model
ollama pull gemma3        # also: gemma2, llama3, mistral, qwen2.5, ...
ollama list               # see what's installed
```

```ini
DB_AI_LLM=ollama
DB_AI_MODEL=gemma3
DB_AI_OLLAMA_BASE_URL=http://localhost:11434/v1   # default; override for remote hosts
DB_AI_PRIVACY_MODE=local-only                      # fully offline
```

`DB_AI_MODEL` must match an installed tag **exactly** (e.g. `gemma3:4b`, not `gemma3`, unless `gemma3` is pulled). Check readiness with:

```bash
pnpm cli llm-health
# Provider: ollama
# Model:    gemma3
# Server:   http://localhost:11434/v1
# Reachable: yes (2 model(s) installed)
# Ready: gemma3 is installed.
```

`llm-health` pings the server, lists installed models, and confirms your configured model is present — exiting non-zero with a `ollama pull` hint if not. For cloud providers it reports whether the API key is set.

---

## Privacy modes

`DB_AI_PRIVACY_MODE` (or `--mode`) controls what is included in the prompt and whether external calls are allowed. The gate lives in `assertPrivacyModeAllowsExternal` and runs **before** any context is built.

| Mode                         | Schema in prompt       | Sample row data       | Cloud provider calls | Use when                                   |
| ---------------------------- | ---------------------- | --------------------- | -------------------- | ------------------------------------------ |
| `local-only`                 | only via a local model | never                 | **blocked**          | Sensitive schemas; air-gapped/offline work |
| `schema-sharing` _(default)_ | yes                    | never                 | allowed              | You'll share structure but no data         |
| `full-ai`                    | yes                    | sampled rows (opt-in) | allowed              | You want the model to see example values   |

Notes:

- **Ollama is treated as local.** `assertPrivacyModeAllowsExternal` lets Ollama through even in `local-only`, because the request never leaves the host. `local-only` + Ollama = neither schema nor data ever transmitted externally.
- **`local-only` + a cloud provider** throws, with a message pointing you to either switch to Ollama or relax the mode.
- **`full-ai`** is the only mode that reads actual rows. `buildContext` samples up to 3 rows from the first 5 selected tables, and only when a `sampleFetcher` is supplied (the CLI supplies one solely in `full-ai`).

---

## Adding a new provider

Four steps — for example, a hypothetical Gemini provider:

1. **Type** — add the name to `AiProviderName` in [`types.ts`](../packages/ai/src/types.ts):
   ```ts
   export type AiProviderName = "openai" | "anthropic" | "ollama" | "gemini";
   ```
2. **Implementation** — create `packages/ai/src/providers/gemini.ts` exporting a factory that returns an `LLMProvider`. The `complete` method receives `Message[]` (`system` / `user` / `assistant` roles) and must return the raw response text. Request JSON output if the provider supports it.
3. **Wire it up** — in [`factory.ts`](../packages/ai/src/providers/factory.ts): add a default model to `DEFAULT_MODELS`, validate the name in `resolveAiConfig`, and branch to your factory in `createLLMProvider` (dynamic `import()` so the SDK only loads when used). If the provider runs locally, add it to `isLocalProvider`.
4. **CLI** — allow the value in `parseProvider` ([`prompt.ts`](../packages/cli/src/prompt.ts)) and update the `--provider` help text.

The parser (`parseAgentResponse`) and the rest of the pipeline are provider-agnostic, so nothing else needs to change.

> Tip: any provider exposing an OpenAI-compatible endpoint (vLLM, LM Studio, OpenRouter, Azure OpenAI) can often reuse the OpenAI SDK with a custom `baseURL` — exactly how the Ollama provider works.
