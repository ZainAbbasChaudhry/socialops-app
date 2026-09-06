import { generateWithGemini, generateChatWithGemini } from "@/lib/services/gemini-client"
import { LLM_PROVIDERS, type LlmChatTurn, type LlmConfig, type LlmFailureCode, type LlmResult } from "./types"

/**
 * The one function the rest of EasyLife calls to talk to a language model.
 *
 * Everything above this file is provider-blind. Swapping a workspace from
 * Gemini to a self-hosted model is a configuration change in Integrations,
 * not a code change - the qualification bot, the assistant, the inbox
 * helper and the connection test all keep working untouched.
 *
 * There are only two adapters behind it, not six:
 *
 *  - Anthropic, which has its own request shape.
 *  - Everything else that speaks OpenAI's `/chat/completions` - OpenAI
 *    itself, Groq, OpenRouter, and every self-hosted runner worth using
 *    (Ollama, vLLM, LM Studio). That compatibility is the entire reason
 *    "bring your own model" is a base URL rather than a new adapter each
 *    time.
 *
 * Gemini keeps its existing dedicated client: it is neither of those shapes,
 * it is already proven in production here, and rewriting a working provider
 * to prove a point is how working things break.
 */

const TIMEOUT_MS = 30_000

function fail(code: LlmFailureCode, reason: string): LlmResult {
  return { ok: false, code, reason }
}

/** Classifies a non-2xx response from HTTP status and the provider's own
 * error text only - never the key, the prompt, or the customer's message. */
function classify(status: number, message: string): LlmFailureCode {
  const lower = message.toLowerCase()
  if (status === 401 || status === 403) return "invalid_key"
  if (lower.includes("api key") && (lower.includes("invalid") || lower.includes("incorrect"))) return "invalid_key"
  if (status === 404 || lower.includes("model") || lower.includes("does not exist")) return "model_error"
  if (status === 429) {
    if (lower.includes("credit") || lower.includes("balance") || lower.includes("insufficient")) return "quota_exhausted"
    if (lower.includes("billing")) return "billing_required"
    return "rate_limited"
  }
  if (status === 402) return "billing_required"
  return "provider_error"
}

function endpointFor(config: LlmConfig): string {
  const base = (config.baseUrl || LLM_PROVIDERS[config.provider].defaultBaseUrl).replace(/\/+$/, "")
  return config.provider === "anthropic" ? `${base}/messages` : `${base}/chat/completions`
}

function modelFor(config: LlmConfig): string {
  return config.model || LLM_PROVIDERS[config.provider].defaultModel
}

/** Reads the assistant text out of either response shape, tolerating a
 * provider that answers 200 with nothing usable in it. */
function extractText(provider: string, json: unknown): string | null {
  if (!json || typeof json !== "object") return null
  const data = json as Record<string, unknown>

  if (provider === "anthropic") {
    const content = data.content
    if (!Array.isArray(content)) return null
    const parts = content
      .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : null))
      .filter((t): t is string => typeof t === "string")
    return parts.join("").trim() || null
  }

  const choices = data.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as Record<string, unknown>)?.message
  const text = message && typeof message === "object" ? (message as Record<string, unknown>).content : null
  return typeof text === "string" && text.trim() ? text.trim() : null
}

async function callProvider(config: LlmConfig, turns: LlmChatTurn[], system: string | undefined): Promise<LlmResult> {
  const spec = LLM_PROVIDERS[config.provider]
  if (spec.needsKey && !config.apiKey) {
    return fail("not_configured", `No API key is configured for ${spec.label}.`)
  }
  if (config.provider === "ollama" && !config.baseUrl) {
    return fail("not_configured", "A self-hosted model needs its server URL.")
  }

  const anthropic = config.provider === "anthropic"
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (config.apiKey) {
    if (anthropic) {
      headers["x-api-key"] = config.apiKey
      headers["anthropic-version"] = "2023-06-01"
    } else {
      headers.Authorization = `Bearer ${config.apiKey}`
    }
  }

  const body = anthropic
    ? {
        model: modelFor(config),
        max_tokens: 2048,
        ...(system ? { system } : {}),
        messages: turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
      }
    : {
        model: modelFor(config),
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
        ],
      }

  try {
    const res = await fetch(endpointFor(config), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (!res.ok) {
      const error = json?.error
      const message =
        (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string"
          ? ((error as Record<string, unknown>).message as string)
          : typeof json?.message === "string"
            ? (json.message as string)
            : "") || `${spec.label} returned ${res.status}`
      return fail(classify(res.status, message), message)
    }

    const text = extractText(config.provider, json)
    if (!text) {
      // A 200 with nothing usable is a failure, not an empty answer: sending
      // a customer a blank message would be worse than falling back.
      return fail("provider_error", `${spec.label} answered with no usable text.`)
    }
    return { ok: true, text }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return fail("network_error", `${spec.label} timed out.`)
    }
    // A self-hosted model that is simply not running is the single most
    // likely failure here, and it deserves a message that says so.
    const reason =
      config.provider === "ollama"
        ? "Could not reach your self-hosted model. Check that it is running and the URL is right."
        : `Could not reach ${spec.label}.`
    return fail("network_error", reason)
  }
}

/** Single-prompt generation. */
export async function generateWithLLM(
  prompt: string,
  systemInstruction: string | undefined,
  config: LlmConfig | null
): Promise<LlmResult> {
  if (!config) return fail("not_configured", "No AI model is configured for this workspace.")
  if (config.provider === "gemini") {
    return generateWithGemini(prompt, systemInstruction, config.apiKey)
  }
  return callProvider(config, [{ role: "user", text: prompt }], systemInstruction)
}

/** Multi-turn generation, for a genuine conversation rather than one shot. */
export async function generateChatWithLLM(
  turns: LlmChatTurn[],
  systemInstruction: string | undefined,
  config: LlmConfig | null
): Promise<LlmResult> {
  if (!config) return fail("not_configured", "No AI model is configured for this workspace.")
  if (turns.length === 0) return fail("provider_error", "There is nothing to send to the model.")
  if (config.provider === "gemini") {
    return generateChatWithGemini(turns, systemInstruction, config.apiKey)
  }
  return callProvider(config, turns, systemInstruction)
}

export type { LlmConfig, LlmChatTurn, LlmResult, LlmFailureCode }
