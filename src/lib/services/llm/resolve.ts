import { getConnection } from "@/lib/integrations/repository"
import { resolveCredentialValue } from "@/lib/integrations/credential-resolution"
import type { ProviderId } from "@/lib/integrations/providers"
import { LLM_PROVIDERS, type LlmConfig, type LlmProviderId, type LlmTier } from "./types"

/**
 * Works out which model a workspace should use for a given job.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not fall back to another workspace's credentials. A provider
 *    the workspace has not activated is simply not used.
 *  - It does not silently use a cheap model where a capable one was meant.
 *    The tier is chosen by the caller and honoured; if a workspace has only
 *    configured a basic model, complex work falls back to it rather than
 *    failing, but that is a documented downgrade, not an accident.
 *
 * The "No Fake Live Mode" rule from `resolveActiveApiKey` applies here too:
 * a key sitting in the config table is not used until the workspace has
 * actually activated that provider.
 */

/** Every AI provider in preference order. First activated one wins when the
 * workspace has not named a preference for the tier. */
const AI_PROVIDERS: LlmProviderId[] = ["gemini", "openai", "anthropic", "groq", "openrouter", "ollama"]

async function configFor(workspaceId: string, provider: LlmProviderId): Promise<LlmConfig | null> {
  const row = await getConnection(workspaceId, provider as ProviderId)
  // Only an activated provider is used - a saved key alone is not consent
  // to spend it.
  if (row?.mode !== "live") return null

  const { value: apiKey } = resolveCredentialValue(row, "apiKey", provider as ProviderId)
  const { value: baseUrl } = resolveCredentialValue(row, "baseUrl", provider as ProviderId)
  const { value: model } = resolveCredentialValue(row, "model", provider as ProviderId)

  const spec = LLM_PROVIDERS[provider]
  if (spec.needsKey && !apiKey) return null
  if (provider === "ollama" && !baseUrl) return null

  return { provider, apiKey: apiKey ?? null, baseUrl: baseUrl ?? null, model: model ?? null }
}

/**
 * The model to use for this workspace and this kind of work.
 *
 * `basic` work - classifying a message, tagging, routing - is happy on a
 * small or self-hosted model, so a workspace running one gets it used and
 * pays nothing. `complex` work - writing to a customer in the client's own
 * name, quoting prices - prefers a capable hosted model, because that is
 * where a weak model does visible damage.
 */
export async function resolveLlm(workspaceId: string, tier: LlmTier = "complex"): Promise<LlmConfig | null> {
  const available: LlmConfig[] = []
  let chosen: LlmConfig | null = null

  for (const provider of AI_PROVIDERS) {
    const config = await configFor(workspaceId, provider)
    if (!config) continue
    available.push(config)
    // The provider the workspace actually picked. Connecting an AI in
    // Integrations is meant to make it the model the whole CRM runs on -
    // the WhatsApp bot, qualification, summaries, the inbox helper - so a
    // deliberate choice beats this file's own preference order, for both
    // tiers. Anything else would mean a client connects a model and then
    // watches EasyLife keep using a different one.
    const row = await getConnection(workspaceId, provider as ProviderId)
    if (row?.config?.aiDefault === true) chosen = config
  }

  if (chosen) return chosen

  if (available.length === 0) {
    // Nothing activated for this workspace: fall back to whatever the
    // platform has configured, exactly as the Gemini path always did.
    const { value: platformKey } = resolveCredentialValue(null, "apiKey", "gemini")
    return platformKey ? { provider: "gemini", apiKey: platformKey } : null
  }

  if (tier === "basic") {
    // Cheapest capable option first: a model the client is already running
    // costs nothing per call.
    const cheap = available.find((c) => c.provider === "ollama") ?? available.find((c) => c.provider === "groq")
    if (cheap) return cheap
  }

  // For customer-facing work, prefer a hosted model and leave the
  // self-hosted one as the last resort rather than the first.
  const hosted = available.find((c) => c.provider !== "ollama")
  return hosted ?? available[0]
}

/** Which AI providers this workspace has actually activated - for the
 * Integrations screen to show what the app is really running on. */
export async function listActiveLlmProviders(workspaceId: string): Promise<LlmProviderId[]> {
  const active: LlmProviderId[] = []
  for (const provider of AI_PROVIDERS) {
    if (await configFor(workspaceId, provider)) active.push(provider)
  }
  return active
}
