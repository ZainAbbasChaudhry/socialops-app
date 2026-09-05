import { PROVIDER_REGISTRY, type ProviderId } from "./providers"
import { getConnection, type IntegrationConnectionRow } from "./repository"
import { resolveCredentialValue } from "./credential-resolution"

/**
 * Provider readiness evaluator. Live mode must be genuinely impossible
 * unless every required condition is actually satisfied - this is the one
 * place that decides "ready for live," so nothing downstream needs to
 * re-derive that logic.
 */
export interface ProviderReadiness {
  provider: ProviderId
  configured: boolean
  credentialsComplete: boolean
  oauthComplete: boolean
  webhookComplete: boolean
  testPassed: boolean
  readyForLive: boolean
  missing: string[]
}

export async function evaluateProviderReadiness(workspaceId: string, provider: ProviderId): Promise<ProviderReadiness> {
  const row = await getConnection(workspaceId, provider)
  return computeReadiness(row, provider)
}

/** Pure variant for callers that already have the connection row (e.g. a
 * list view iterating every provider) - avoids an N+1 refetch per provider. */
export function computeReadiness(row: IntegrationConnectionRow | null, provider: ProviderId): ProviderReadiness {
  const def = PROVIDER_REGISTRY[provider]
  const missing: string[] = []

  const requiredFields = def.credentialFields.filter((f) => f.required)
  const credentialsComplete = requiredFields.every((f) => {
    const ok = resolveCredentialValue(row, f.key, provider).value !== null
    if (!ok) missing.push(f.label)
    return ok
  })

  let oauthComplete = true
  if (def.requiresOAuth) {
    oauthComplete = resolveCredentialValue(row, "accessToken", provider).value !== null
    if (!oauthComplete) missing.push("OAuth authorization (Connect Account)")
  }

  // No dedicated "webhook verified" flag is tracked separately - webhook
  // completeness is folded into the connection ever having tested/operated
  // successfully, since that is the only genuine evidence available.
  let webhookComplete = true
  if (def.requiresWebhook) {
    // `row?.lastSuccessAt` is `undefined` (not null) when there is no
    // connection row at all, and `undefined !== null` is true - which made
    // an entirely unconfigured provider display "Webhook verified ✓".
    // Coalescing to null first restores the intended meaning: verified only
    // once this connection has actually succeeded at least once.
    webhookComplete = row?.status === "connected" || (row?.lastSuccessAt ?? null) !== null
    if (!webhookComplete) missing.push("Webhook verification")
  }

  const testPassed = row?.lastSuccessAt !== null && row?.lastSuccessAt !== undefined
  if (!testPassed) missing.push("Successful Test Connection")

  const readyForLive = credentialsComplete && oauthComplete && webhookComplete && testPassed

  return {
    provider,
    configured: credentialsComplete,
    credentialsComplete,
    oauthComplete,
    webhookComplete,
    testPassed,
    readyForLive,
    missing,
  }
}
