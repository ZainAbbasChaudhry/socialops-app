import { PROVIDER_REGISTRY, type ProviderId, type IntegrationMode, type IntegrationStatus } from "./providers"
import { encryptSecret, maskSecret } from "./crypto"
import {
  getConnection,
  listConnections,
  upsertConnection,
  deleteConnection,
  recordTestResult,
  recordAuditEvent,
} from "./repository"
import { resolveCredentialValue } from "./credential-resolution"
import { evaluateProviderReadiness, computeReadiness, type ProviderReadiness } from "./readiness"
import { connectViewFor, type ConnectView } from "./connect"
import { disconnectSocialAccountsByProvider } from "@/lib/platform/social-accounts"

export { resolveCredentialValue }

/** Safe, client-facing view of a provider's connection state — never a raw
 * secret, only presence + a masked tail where that's safe to show. */
export interface ProviderConnectionView {
  provider: ProviderId
  name: string
  category: string
  description: string
  mode: IntegrationMode
  status: IntegrationStatus
  displayName: string | null
  config: Record<string, unknown>
  credentialFields: {
    key: string
    label: string
    secret: boolean
    required: boolean
    configured: boolean
    maskedValue: string | null
    source: "workspace" | "environment" | "none"
  }[]
  usingEnvFallback: boolean
  lastTestedAt: string | null
  lastSuccessAt: string | null
  lastErrorMessage: string | null
  updatedAt: string | null
  readiness: ProviderReadiness
  /** How this one is connected, whether it is working, and what the single
   * button on its card should say. */
  connect: ConnectView
}

export async function getProviderView(workspaceId: string, provider: ProviderId): Promise<ProviderConnectionView> {
  const def = PROVIDER_REGISTRY[provider]
  const row = await getConnection(workspaceId, provider)

  const credentialFields = def.credentialFields.map((field) => {
    const resolved = resolveCredentialValue(row, field.key, provider)
    return {
      key: field.key,
      label: field.label,
      secret: field.secret,
      required: field.required,
      configured: resolved.value !== null,
      maskedValue: resolved.value && field.secret ? maskSecret(resolved.value) : resolved.value && !field.secret ? resolved.value : null,
      source: resolved.source,
    }
  })

  const usingEnvFallback = credentialFields.some((f) => f.source === "environment")
  const readiness = await evaluateProviderReadiness(workspaceId, provider)

  return {
    provider,
    name: def.name,
    category: def.category,
    description: def.description,
    mode: (row?.mode as IntegrationMode) ?? "disabled",
    status: (row?.status as IntegrationStatus) ?? (usingEnvFallback ? "configured" : "not_configured"),
    displayName: row?.displayName ?? null,
    config: row?.config ?? {},
    credentialFields,
    usingEnvFallback,
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
    lastErrorMessage: row?.lastErrorMessage ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    readiness,
    connect: connectViewFor(row, provider),
  }
}

export async function listProviderViews(workspaceId: string): Promise<ProviderConnectionView[]> {
  const rows = await listConnections(workspaceId)
  const rowsByProvider = new Map(rows.map((r) => [r.provider, r]))

  return (Object.keys(PROVIDER_REGISTRY) as ProviderId[]).map((provider) => {
    const def = PROVIDER_REGISTRY[provider]
    const row = rowsByProvider.get(provider) ?? null
    const credentialFields = def.credentialFields.map((field) => {
      const resolved = resolveCredentialValue(row, field.key, provider)
      return {
        key: field.key,
        label: field.label,
        secret: field.secret,
        required: field.required,
        configured: resolved.value !== null,
        maskedValue: resolved.value && field.secret ? maskSecret(resolved.value) : resolved.value && !field.secret ? resolved.value : null,
        source: resolved.source,
      }
    })
    const usingEnvFallback = credentialFields.some((f) => f.source === "environment")

    return {
      provider,
      name: def.name,
      category: def.category,
      description: def.description,
      mode: (row?.mode as IntegrationMode) ?? "disabled",
      status: (row?.status as IntegrationStatus) ?? (usingEnvFallback ? "configured" : "not_configured"),
      displayName: row?.displayName ?? null,
      config: row?.config ?? {},
      credentialFields,
      usingEnvFallback,
      lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastErrorMessage: row?.lastErrorMessage ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      readiness: computeReadiness(row, provider),
      connect: connectViewFor(row, provider),
    }
  })
}

export interface SaveConnectionInput {
  workspaceId: string
  provider: ProviderId
  actorUserId: string
  mode?: IntegrationMode
  displayName?: string
  /** Raw plaintext field values keyed by field key — secret fields get
   * encrypted here before ever touching the repository/DB layer; empty
   * strings are ignored (never overwrite a saved secret with blank). */
  fields: Record<string, string>
}

export async function saveConnection(input: SaveConnectionInput): Promise<ProviderConnectionView> {
  const def = PROVIDER_REGISTRY[input.provider]
  const config: Record<string, unknown> = {}
  const secretDataEncrypted: Record<string, string> = {}

  for (const field of def.credentialFields) {
    const value = input.fields[field.key]
    if (!value) continue
    if (field.secret) {
      secretDataEncrypted[field.key] = encryptSecret(value).blob
    } else {
      config[field.key] = value
    }
  }

  const hasFieldChanges = Object.keys(config).length > 0 || Object.keys(secretDataEncrypted).length > 0

  const existing = await getConnection(input.workspaceId, input.provider)
  const isFirstSave = !existing

  await upsertConnection({
    workspaceId: input.workspaceId,
    provider: input.provider,
    mode: input.mode,
    status: "configured",
    displayName: input.displayName,
    config,
    secretDataEncrypted,
    resetTestState: hasFieldChanges,
  })

  await recordAuditEvent(
    input.workspaceId,
    input.provider,
    isFirstSave ? "integration_configured" : "integration_updated",
    input.actorUserId,
    { fieldsUpdated: Object.keys(input.fields).filter((k) => input.fields[k]) }
  )

  return getProviderView(input.workspaceId, input.provider)
}

export interface StoreOAuthTokensInput {
  workspaceId: string
  provider: ProviderId
  actorUserId: string | null
  accessToken: string
  refreshToken?: string
  expiresInSeconds?: number
}

/** Stores tokens obtained from a completed OAuth exchange. Deliberately
 * separate from saveConnection: tokens are server-obtained, not user-typed
 * form fields, so they bypass the credentialFields whitelist and are keyed
 * under their own encrypted slots. A successful token exchange is genuine
 * evidence of a real connection, so this is the one path allowed to set
 * status "connected" directly rather than the generic post-save
 * "configured" state. */
export async function storeOAuthTokens(input: StoreOAuthTokensInput): Promise<ProviderConnectionView> {
  const secretDataEncrypted: Record<string, string> = {
    accessToken: encryptSecret(input.accessToken).blob,
  }
  if (input.refreshToken) {
    secretDataEncrypted.refreshToken = encryptSecret(input.refreshToken).blob
  }

  const config: Record<string, unknown> = {}
  if (input.expiresInSeconds) {
    config.tokenExpiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
  }

  await upsertConnection({
    workspaceId: input.workspaceId,
    provider: input.provider,
    mode: "live",
    status: "connected",
    config,
    secretDataEncrypted,
  })

  await recordTestResult(input.workspaceId, input.provider, { ok: true, status: "connected" })
  await recordAuditEvent(input.workspaceId, input.provider, "connection_test_succeeded", input.actorUserId, {
    step: "oauth_token_exchange",
  })

  return getProviderView(input.workspaceId, input.provider)
}

/**
 * Records that a connection has stopped working and needs the client to
 * sign in again.
 *
 * The point is that the dashboard should notice before the client does. A
 * refresh that has genuinely run out of road used to leave the connection
 * still showing as connected while quietly failing every call behind it -
 * the worst of both worlds, because nothing looked wrong. Marking it
 * expired is what turns the card amber and puts a Reconnect button on it.
 *
 * `mode` is deliberately left alone: the workspace still WANTS this
 * provider live, and reconnecting should restore it without them having to
 * remember to switch it back on.
 */
export async function markConnectionExpired(workspaceId: string, provider: ProviderId, reason: string): Promise<void> {
  await recordTestResult(workspaceId, provider, {
    ok: false,
    status: "expired",
    errorCode: "token_expired",
    // The reason reaches the client's screen, so it is the provider's own
    // message or ours - never a token and never a stack trace.
    errorMessage: reason,
  })
}

/** Providers whose social_accounts rows should be marked disconnected
 * alongside the integration itself - includes "instagram" on a facebook
 * disable/removal since Instagram publishing rides on the Facebook
 * connection rather than having its own. */
function dependentSocialAccountProviders(provider: ProviderId): string[] {
  return provider === "facebook" ? ["facebook", "instagram"] : [provider]
}

export async function disableConnection(workspaceId: string, provider: ProviderId, actorUserId: string): Promise<void> {
  await upsertConnection({ workspaceId, provider, mode: "disabled", status: "disabled" })
  await recordAuditEvent(workspaceId, provider, "integration_disabled", actorUserId)
  for (const p of dependentSocialAccountProviders(provider)) {
    await disconnectSocialAccountsByProvider(workspaceId, p)
  }
}

export async function removeConnection(workspaceId: string, provider: ProviderId, actorUserId: string): Promise<void> {
  await deleteConnection(workspaceId, provider)
  await recordAuditEvent(workspaceId, provider, "integration_deleted", actorUserId)
  for (const p of dependentSocialAccountProviders(provider)) {
    await disconnectSocialAccountsByProvider(workspaceId, p)
  }
}

export interface TestConnectionResult {
  ok: boolean
  status: IntegrationStatus
  message: string
}

export async function recordConnectionTest(
  workspaceId: string,
  provider: ProviderId,
  actorUserId: string,
  result: TestConnectionResult
): Promise<void> {
  await recordTestResult(workspaceId, provider, {
    ok: result.ok,
    status: result.status,
    errorCode: result.ok ? undefined : "test_failed",
    errorMessage: result.ok ? undefined : result.message,
  })
  await recordAuditEvent(
    workspaceId,
    provider,
    result.ok ? "connection_test_succeeded" : "connection_test_failed",
    actorUserId
  )
}
