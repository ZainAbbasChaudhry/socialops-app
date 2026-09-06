import { createHash } from "node:crypto"
import { sendWhatsAppTextMessage } from "./cloud-api"
import { sendTextMessage as sendGatewayText, type GatewayConfig } from "./openwa-client"
import { getWorkspaceFeatures } from "./feature-access"
import { getWhatsAppAccountById } from "./repository"
import { resolveCredentialValue } from "@/lib/integrations/credential-resolution"
import { getConnection } from "@/lib/integrations/repository"

/**
 * Provider-agnostic WhatsApp send layer.
 *
 * There are now two transports - the official Meta Cloud API and the
 * self-hosted OpenWA (Baileys NOWEB) gateway - but only one inbound
 * pipeline, one qualification bot, one CRM sync and one automation engine.
 * Everything above this file talks to `WhatsAppTransport` and stays
 * transport-blind; everything below it is provider-specific.
 *
 * Transports are resolved from the database by account id rather than being
 * handed around as a bundle of credentials. That is deliberate:
 *  - Credentials are read at the moment of sending, so a rotated token or a
 *    re-paired session takes effect immediately instead of being pinned to
 *    whatever was decrypted when the webhook first arrived.
 *  - Nothing has to carry an access token through the automation engine's
 *    event context (and therefore nowhere near anything that gets recorded
 *    to `automation_runs`).
 */

export type WhatsAppProvider = "cloud-api" | "openwa"

export interface WhatsAppSendResult {
  ok: boolean
  externalMessageId?: string
  errorMessage?: string
}

export interface WhatsAppTransport {
  provider: WhatsAppProvider
  sendText(to: string, body: string): Promise<WhatsAppSendResult>
}

/** The minimum an automation or pipeline step needs to reply into a
 * conversation. No secrets - `accountId` is resolved to real credentials
 * only inside `resolveTransportForAccount`. */
export interface WhatsAppReplyContext {
  toNumber: string
  accountId: string
  conversationId?: string
}

export type ResolveTransportResult =
  | { ok: true; transport: WhatsAppTransport }
  | { ok: false; errorMessage: string }

/**
 * Session ids are derived here and only here, from the workspace's UUID -
 * never read from a request body, a query string, or any other
 * browser-controlled input. A workspace therefore cannot address another
 * workspace's WhatsApp session by guessing or forging an id.
 *
 * The workspace UUID is hashed rather than used directly so that the id
 * living in the gateway's on-disk session folder names (and in its logs)
 * isn't a database primary key. The mapping is deterministic, so the same
 * workspace always resolves to the same session across restarts and
 * redeploys.
 */
export function deriveSessionId(workspaceId: string): string {
  // Hyphen, not underscore: OpenWA validates session names against
  // /^[a-zA-Z0-9-]+$/ and rejects anything else with a bare 400. The
  // underscore this used to produce meant EVERY session creation failed
  // against a real gateway - invisible until one was actually running,
  // because a stub will accept any name you give it.
  //
  // "ws-" + 32 hex = 35 characters, inside OpenWA's 3-50 range.
  return `ws-${createHash("sha256").update(`easylife:whatsapp:${workspaceId}`).digest("hex").slice(0, 32)}`
}

/** The NAME EasyLife gives a workspace's session on the gateway. The gateway
 * assigns its own id, which is what `whatsapp_accounts.session_id` stores and
 * what inbound webhooks carry; this deterministic name is how EasyLife finds
 * (or creates) that session again without keeping a second mapping. */
export const deriveSessionName = deriveSessionId

/** Reads the workspace's OpenWA gateway configuration. Returns null when
 * the workspace has not activated the provider - callers must treat that
 * as "not available", never as a reason to fall back to another
 * workspace's gateway. */
export async function resolveOpenWaConfig(workspaceId: string): Promise<GatewayConfig | null> {
  const row = await getConnection(workspaceId, "openwa")
  const { value: baseUrl } = resolveCredentialValue(row, "baseUrl", "openwa")
  const { value: apiKey } = resolveCredentialValue(row, "apiKey", "openwa")
  if (!baseUrl || !apiKey) return null
  // Entitlements are part of the config, so there is no way to construct a
  // gateway client that bypasses the feature gate.
  const features = await getWorkspaceFeatures(workspaceId)
  return { baseUrl, apiKey, features }
}

function cloudApiTransport(phoneNumberId: string, accessToken: string): WhatsAppTransport {
  return {
    provider: "cloud-api",
    sendText: (to, body) => sendWhatsAppTextMessage(phoneNumberId, accessToken, to, body),
  }
}

function openWaTransport(config: GatewayConfig, sessionId: string): WhatsAppTransport {
  return {
    provider: "openwa",
    sendText: (to, body) => sendGatewayText(config, sessionId, to, body),
  }
}

/**
 * Resolves the transport for one stored WhatsApp account, scoped to the
 * workspace that owns it. A mismatched workspace/account pair resolves to
 * an error rather than a working transport, so an account id leaking into
 * the wrong workspace's request can never send on its behalf.
 */
export async function resolveTransportForAccount(
  workspaceId: string,
  accountId: string
): Promise<ResolveTransportResult> {
  const account = await getWhatsAppAccountById(workspaceId, accountId)
  if (!account) return { ok: false, errorMessage: "WhatsApp account not found for this workspace." }

  if (account.provider === "openwa") {
    if (!account.sessionId) return { ok: false, errorMessage: "This OpenWA account has no session." }
    const config = await resolveOpenWaConfig(workspaceId)
    if (!config) return { ok: false, errorMessage: "OpenWA gateway isn't configured for this workspace." }
    return { ok: true, transport: openWaTransport(config, account.sessionId) }
  }

  if (!account.phoneNumberId) {
    return { ok: false, errorMessage: "This WhatsApp Cloud API account has no phone number id." }
  }
  const row = await getConnection(workspaceId, "whatsapp")
  const { value: accessToken } = resolveCredentialValue(row, "accessToken", "whatsapp")
  if (!accessToken) return { ok: false, errorMessage: "No WhatsApp Cloud API access token is configured." }

  return { ok: true, transport: cloudApiTransport(account.phoneNumberId, accessToken) }
}

export { cloudApiTransport, openWaTransport }
