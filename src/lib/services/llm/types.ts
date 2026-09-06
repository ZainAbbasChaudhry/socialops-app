/**
 * One shape every language model in EasyLife answers in.
 *
 * The point of this file is that nothing above it should know or care which
 * provider is behind a workspace's AI. A client running a free self-hosted
 * model and a client paying for a frontier model get the same contract, so
 * the qualification bot, the assistant and the inbox helper are written once.
 *
 * Two rules carried over from the original Gemini client, because both
 * turned out to matter:
 *
 *  - It never throws. Every failure - no key, network gone, quota spent,
 *    empty completion - resolves to `{ ok: false }` with a classified code,
 *    so a caller can fall back to a deterministic template instead of
 *    leaving a customer with no reply at all.
 *  - The reason is derived only from HTTP status and the provider's own
 *    error text. Never the key, never the prompt, never the customer's
 *    message - those must not reach a log.
 */

export type LlmFailureCode =
  | "not_configured" // no provider activated, or no key for the one that is
  | "invalid_key" // key present but rejected
  | "quota_exhausted" // credits or prepaid balance gone
  | "rate_limited" // ordinary short-term throttling
  | "billing_required" // billing never enabled
  | "model_error" // the model id was rejected
  | "network_error" // no response at all - timeout, DNS, unreachable host
  | "provider_error" // safe catch-all

export type LlmResult = { ok: true; text: string } | { ok: false; code: LlmFailureCode; reason: string }

export interface LlmChatTurn {
  /** "model" rather than "assistant" - the name the rest of EasyLife already
   * uses. Adapters translate it to whatever their provider expects. */
  role: "user" | "model"
  text: string
}

/**
 * Which model a workspace actually uses, resolved before any call.
 *
 * `baseUrl` is what makes a self-hosted model possible: Ollama, vLLM, LM
 * Studio and most hosted providers all speak the OpenAI chat-completions
 * shape, so pointing this at a private server is the whole of the
 * "bring your own model" story.
 */
export interface LlmConfig {
  provider: LlmProviderId
  apiKey: string | null
  /** Overrides the provider's default endpoint. Required for self-hosted. */
  baseUrl?: string | null
  /** Overrides the provider's default model id. */
  model?: string | null
}

export type LlmProviderId = "gemini" | "openai" | "anthropic" | "groq" | "openrouter" | "ollama"

/**
 * How capable a model needs to be for a given job.
 *
 * This is the "basic vs complex" split, made explicit so it can be acted on
 * rather than guessed. A small self-hosted model is genuinely fine for the
 * `basic` work - deciding what a message is about, tagging, routing - and
 * genuinely not fine for the `complex` work, where it is talking to a
 * customer about prices in the client's own name.
 */
export type LlmTier = "basic" | "complex"

/** What each provider is called on screen, and what it defaults to. */
export const LLM_PROVIDERS: Record<
  LlmProviderId,
  { label: string; defaultModel: string; defaultBaseUrl: string; needsKey: boolean; note?: string }
> = {
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-3.6-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    needsKey: true,
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
  },
  anthropic: {
    label: "Anthropic Claude",
    defaultModel: "claude-sonnet-4-6",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    needsKey: true,
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    note: "Has a free tier with a daily limit. Fast, and strong enough for customer replies.",
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    note: "One key, many models - including free ones.",
  },
  ollama: {
    label: "Self-hosted (Ollama / vLLM / LM Studio)",
    defaultModel: "llama3.2",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    needsKey: false,
    note: "Runs on your own server. Needs 8GB+ RAM and a process that stays up - it cannot run on cPanel hosting.",
  },
}
