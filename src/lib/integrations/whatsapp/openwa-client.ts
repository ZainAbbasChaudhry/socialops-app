import type { TestConnectionResult } from "../service"
import {
  checkRouteAllowed,
  type WorkspaceFeatureState,
} from "./feature-access"

/**
 * Adapter for the self-hosted EasyLife WhatsApp gateway.
 *
 * The gateway is an OpenWA instance (MIT licence - see feature-catalog.ts for
 * the attribution note) that EasyLife runs as an internal service. Nothing
 * about it is customer-facing: clients see EasyLife's own screens, and this
 * file is the only place in the app that knows the gateway's wire format.
 *
 * Why a gateway at all: a paired WhatsApp session is a socket that must stay
 * open between requests and hold credentials in memory. The dashboard runs on
 * cPanel under Passenger, where handlers are request-scoped and the process
 * can be recycled at any moment. That is a property of the runtime, not
 * something a code change fixes - so the session lives in the gateway and the
 * dashboard talks to it over HTTPS.
 *
 * Every call routes through `request`, which consults the workspace's feature
 * entitlements BEFORE going out. A capability an EasyLife admin has switched
 * off is unreachable here, not merely hidden in the UI.
 */

/** Gateway calls are on a nearby host; slower than this means it is wedged,
 * and waiting longer only holds a Passenger worker hostage. Media conversion
 * legitimately takes longer, so it gets its own ceiling. */
const DEFAULT_TIMEOUT_MS = 15_000
const LONG_TIMEOUT_MS = 60_000

export interface GatewayConfig {
  baseUrl: string
  apiKey: string
  /** The workspace's entitlements. Required - there is deliberately no way to
   * construct a client that skips the gate. */
  features: WorkspaceFeatureState
}

export type GatewayResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorMessage: string; status?: number; blocked?: boolean }

function normalizeBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api`
}

/** Session ids reach the URL path, so only the shape EasyLife derives is
 * accepted - a traversal-shaped id can never address another endpoint. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** Catalogue route template, e.g. "POST /sessions/{id}/messages/send-text".
   * This is what the gate matches on - NOT the concrete path - so a feature
   * covers a route regardless of which session it is called for. */
  route: string
  /** Concrete path with ids substituted, relative to /api. */
  path: string
  body?: unknown
  timeoutMs?: number
}

async function request<T>(config: GatewayConfig, options: RequestOptions): Promise<GatewayResult<T>> {
  const gate = checkRouteAllowed(config.features, options.route)
  if (!gate.allowed) {
    // Refused before any network call: the capability genuinely does not
    // exist for this workspace.
    return { ok: false, errorMessage: gate.reason, blocked: true }
  }

  const url = `${normalizeBaseUrl(config.baseUrl)}${options.path}`

  try {
    const res = await fetch(url, {
      method: options.method,
      headers: {
        // Sent as a header, never a query parameter - query strings land in
        // access logs.
        "X-API-Key": config.apiKey,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (!res.ok) {
      const message =
        (typeof json?.message === "string" && json.message) ||
        (typeof json?.error === "string" && json.error) ||
        `WhatsApp gateway returned ${res.status}`
      return { ok: false, errorMessage: message, status: res.status }
    }

    return { ok: true, data: (json ?? {}) as T }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, errorMessage: "The WhatsApp gateway timed out." }
    }
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : "Couldn't reach the WhatsApp gateway.",
    }
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type SessionStatus = "disconnected" | "connecting" | "qr" | "connected" | "error"

export interface SessionState {
  status: SessionStatus
  connectedNumber: string | null
  lastError: string | null
}

/** The gateway reports a richer set of states than EasyLife's screens need;
 * they collapse to the five the connection card actually renders. */
/**
 * Maps the gateway's session state onto the five states EasyLife shows.
 *
 * The first group of names in each line is OpenWA's own enum
 * (`SessionStatus` in its session entity): created, initializing, qr_ready,
 * authenticating, ready, disconnected, action_required, failed. The rest are
 * names used by other gateways and older versions, kept because they cost
 * nothing and a gateway upgrade that renames one should not silently break
 * the connect screen.
 *
 * Anything unrecognised falls to "disconnected" - the safe answer, because
 * showing "connected" for a state we do not understand would be a lie. That
 * default is also how `qr_ready` used to be reported: the QR was sitting
 * ready on the gateway while EasyLife said "Not connected" and never fetched
 * it, since it only asks for a QR when it believes one is waiting.
 */
function coerceStatus(raw: unknown): SessionStatus {
  const value = String(raw ?? "").toUpperCase()
  if (value === "READY" || value === "WORKING" || value === "CONNECTED" || value === "AUTHENTICATED") return "connected"
  if (value === "QR_READY" || value === "SCAN_QR_CODE" || value === "QR" || value === "PAIRING") return "qr"
  if (
    value === "INITIALIZING" ||
    value === "AUTHENTICATING" ||
    value === "CREATED" ||
    value === "STARTING" ||
    value === "CONNECTING"
  ) {
    return "connecting"
  }
  // ACTION_REQUIRED means the gateway needs a human - a restriction, a
  // re-pair. That is a problem to surface, not a quiet "disconnected".
  if (value === "FAILED" || value === "ERROR" || value === "ACTION_REQUIRED") return "error"
  return "disconnected"
}

function coerceState(data: Record<string, unknown>): SessionState {
  const me = data.me as Record<string, unknown> | undefined
  // OpenWA reports the linked number as `phone`; other gateways use
  // `phoneNumber` or only expose it inside `me.id` as a JID.
  const number =
    (typeof data.phone === "string" && data.phone) ||
    (typeof data.phoneNumber === "string" && data.phoneNumber) ||
    (typeof me?.id === "string" ? me.id.split("@")[0].split(":")[0] : null)
  return {
    status: coerceStatus(data.status ?? data.state),
    connectedNumber: number && /^\d{5,}$/.test(number) ? number : null,
    lastError: typeof data.lastError === "string" ? data.lastError : null,
  }
}

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId)
}

/** Ensures a gateway session exists for this workspace, returning its id.
 * The gateway keys sessions by its own identifier, so EasyLife stores the
 * mapping rather than assuming the two are the same. */
export async function ensureGatewaySession(
  config: GatewayConfig,
  name: string
): Promise<GatewayResult<{ sessionId: string }>> {
  const listed = await request<{ sessions?: { id: string; name?: string }[] } | { id: string; name?: string }[]>(
    config,
    { method: "GET", route: "GET /sessions", path: "/sessions" }
  )
  if (listed.ok) {
    const rows = Array.isArray(listed.data) ? listed.data : (listed.data.sessions ?? [])
    const existing = rows.find((s) => s.name === name)
    if (existing?.id) return { ok: true, data: { sessionId: existing.id } }
  }

  const created = await request<{ id?: string; sessionId?: string }>(config, {
    method: "POST",
    route: "POST /sessions",
    path: "/sessions",
    body: { name },
  })
  if (!created.ok) return created
  const id = created.data.id ?? created.data.sessionId
  if (!id) return { ok: false, errorMessage: "The gateway created a session but returned no id." }
  return { ok: true, data: { sessionId: id } }
}

export async function startSession(config: GatewayConfig, sessionId: string): Promise<GatewayResult<SessionState>> {
  const result = await request<Record<string, unknown>>(config, {
    method: "POST",
    route: "POST /sessions/{id}/start",
    path: `/sessions/${encodeSegment(sessionId)}/start`,
    body: {},
  })
  if (!result.ok) return result
  return { ok: true, data: coerceState(result.data) }
}

export async function getSessionState(config: GatewayConfig, sessionId: string): Promise<GatewayResult<SessionState>> {
  const result = await request<Record<string, unknown>>(config, {
    method: "GET",
    route: "GET /sessions/{id}",
    path: `/sessions/${encodeSegment(sessionId)}`,
  })
  if (!result.ok) return result
  return { ok: true, data: coerceState(result.data) }
}

/** The pairing QR. Returned as a data URL so it can be rendered directly and
 * never has to be stored. */
export async function getQrCode(config: GatewayConfig, sessionId: string): Promise<GatewayResult<{ qr: string | null }>> {
  const result = await request<Record<string, unknown>>(config, {
    method: "GET",
    route: "GET /sessions/{id}/qr",
    path: `/sessions/${encodeSegment(sessionId)}/qr`,
  })
  if (!result.ok) return result
  const raw = result.data.qr ?? result.data.qrCode ?? result.data.data
  if (typeof raw !== "string") return { ok: true, data: { qr: null } }
  return { ok: true, data: { qr: raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}` } }
}

/**
 * The link-by-phone-number alternative to scanning: the gateway returns an
 * 8-character code the client types into WhatsApp on the phone. Useful when
 * setting a client up remotely, where pointing a camera at a screen isn't
 * possible.
 */
export async function requestPairingCode(
  config: GatewayConfig,
  sessionId: string,
  phoneNumber: string
): Promise<GatewayResult<{ pairingCode: string }>> {
  const digits = phoneNumber.replace(/[^\d]/g, "")
  if (digits.length < 8) {
    return { ok: false, errorMessage: "Enter the full number including country code." }
  }

  const result = await request<Record<string, unknown>>(config, {
    method: "POST",
    route: "POST /sessions/{id}/pairing-code",
    path: `/sessions/${encodeSegment(sessionId)}/pairing-code`,
    body: { phoneNumber: digits },
  })
  if (!result.ok) return result

  const code = result.data.pairingCode ?? result.data.code
  if (typeof code !== "string" || !code) {
    return { ok: false, errorMessage: "The gateway didn't return a pairing code." }
  }
  return { ok: true, data: { pairingCode: code } }
}

export async function stopSession(config: GatewayConfig, sessionId: string): Promise<GatewayResult<unknown>> {
  return request(config, {
    method: "POST",
    route: "POST /sessions/{id}/stop",
    path: `/sessions/${encodeSegment(sessionId)}/stop`,
    body: {},
  })
}

/** A real unlink: clears the pairing on the gateway, so reconnecting needs a
 * fresh scan. EasyLife's conversation history is untouched. */
export async function logoutSession(config: GatewayConfig, sessionId: string): Promise<GatewayResult<unknown>> {
  return request(config, {
    method: "POST",
    route: "POST /sessions/{id}/logout",
    path: `/sessions/${encodeSegment(sessionId)}/logout`,
    body: {},
  })
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface SendResult {
  ok: boolean
  externalMessageId?: string
  errorMessage?: string
}

function extractMessageId(data: Record<string, unknown>): string | undefined {
  const direct = data.id ?? data.messageId
  if (typeof direct === "string") return direct
  const key = data.key as Record<string, unknown> | undefined
  return typeof key?.id === "string" ? key.id : undefined
}

/**
 * WhatsApp addresses a chat by JID - `<number>@c.us` for a person,
 * `<id>@g.us` for a group - and OpenWA's send endpoints take that JID as
 * `chatId`. EasyLife stores plain digits, because a JID is a protocol detail
 * that has no business being the phone number a salesperson reads in the CRM.
 *
 * This is the one place the two representations meet. A value that is already
 * a JID passes through untouched (so group sends work); digits become a
 * personal JID.
 */
function toChatId(recipient: string): string {
  const trimmed = recipient.trim()
  if (trimmed.includes("@")) return trimmed
  return `${trimmed.replace(/\D/g, "")}@c.us`
}

/** The inverse: the digits EasyLife stores and displays. */
export function phoneFromChatId(chatId: string): string {
  return chatId.split("@")[0].split(":")[0].replace(/\D/g, "")
}

/**
 * Sends a text message.
 *
 * `ok: true` means WhatsApp assigned the message an id - it reached WhatsApp's
 * servers. The id is never synthesized locally: a send that comes back without
 * one is reported as a failure, so EasyLife can never display "sent" for a
 * message the provider did not accept.
 */
export async function sendTextMessage(
  config: GatewayConfig,
  sessionId: string,
  to: string,
  body: string
): Promise<SendResult> {
  const result = await request<Record<string, unknown>>(config, {
    method: "POST",
    route: "POST /sessions/{id}/messages/send-text",
    path: `/sessions/${encodeSegment(sessionId)}/messages/send-text`,
    // OpenWA's field is `chatId` and it wants a full JID. Sending `to` with
    // bare digits - which is what this did - was rejected outright, so every
    // bot reply was recorded as failed while the message itself never left.
    body: { chatId: toChatId(to), text: body },
  })

  if (!result.ok) return { ok: false, errorMessage: result.errorMessage }

  const id = extractMessageId(result.data)
  if (!id) {
    return { ok: false, errorMessage: "The gateway accepted the request but WhatsApp returned no message id." }
  }
  return { ok: true, externalMessageId: id }
}

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker"

const MEDIA_ROUTES: Record<MediaKind, { route: string; segment: string; feature: string }> = {
  image: { route: "POST /sessions/{id}/messages/send-image", segment: "send-image", feature: "media.images" },
  video: { route: "POST /sessions/{id}/messages/send-video", segment: "send-video", feature: "media.video" },
  audio: { route: "POST /sessions/{id}/messages/send-audio", segment: "send-audio", feature: "media.audio" },
  document: { route: "POST /sessions/{id}/messages/send-document", segment: "send-document", feature: "media.documents" },
  sticker: { route: "POST /sessions/{id}/messages/send-sticker", segment: "send-sticker", feature: "media.stickers" },
}

export async function sendMediaMessage(
  config: GatewayConfig,
  sessionId: string,
  kind: MediaKind,
  to: string,
  media: { url?: string; base64?: string; filename?: string; caption?: string }
): Promise<SendResult> {
  const spec = MEDIA_ROUTES[kind]
  const result = await request<Record<string, unknown>>(config, {
    method: "POST",
    route: spec.route,
    path: `/sessions/${encodeSegment(sessionId)}/messages/${spec.segment}`,
    body: { chatId: toChatId(to), ...media },
    // Media uploads legitimately take longer than a text send.
    timeoutMs: LONG_TIMEOUT_MS,
  })

  if (!result.ok) return { ok: false, errorMessage: result.errorMessage }
  const id = extractMessageId(result.data)
  if (!id) return { ok: false, errorMessage: "The gateway accepted the media but WhatsApp returned no message id." }
  return { ok: true, externalMessageId: id }
}

/** Typing indicator, so an AI reply arrives at a human pace rather than
 * instantly. Best-effort: a failure here must never block the actual reply. */
export async function sendTypingIndicator(
  config: GatewayConfig,
  sessionId: string,
  chatId: string,
  typing: boolean
): Promise<void> {
  await request(config, {
    method: "POST",
    route: "POST /sessions/{id}/chats/typing",
    path: `/sessions/${encodeSegment(sessionId)}/chats/typing`,
    body: { chatId, typing },
  }).catch(() => undefined)
}

/** Confirms a number is reachable on WhatsApp before spending a message on
 * it - keeps campaign lists clean and avoids first-contact sends that go
 * nowhere. */
export async function checkNumberOnWhatsApp(
  config: GatewayConfig,
  sessionId: string,
  number: string
): Promise<GatewayResult<{ exists: boolean }>> {
  const digits = number.replace(/[^\d]/g, "")
  const result = await request<Record<string, unknown>>(config, {
    method: "GET",
    route: "GET /sessions/{id}/contacts/check/{number}",
    path: `/sessions/${encodeSegment(sessionId)}/contacts/check/${encodeSegment(digits)}`,
  })
  if (!result.ok) return result
  return { ok: true, data: { exists: result.data.exists === true || result.data.numberExists === true } }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Read-only connection test. Hits the gateway's health endpoint, which
 * validates the API key without touching any WhatsApp session - so testing is
 * free, safe to repeat, and cannot disturb a live pairing.
 */
export async function testGateway(config: GatewayConfig): Promise<TestConnectionResult> {
  const result = await request<Record<string, unknown>>(config, {
    method: "GET",
    route: "GET /health",
    path: "/health",
  })

  if (!result.ok) {
    const unauthorized = result.status === 401 || result.status === 403
    return {
      ok: false,
      status: unauthorized ? "expired" : "error",
      message: unauthorized ? "The WhatsApp gateway rejected this API key." : result.errorMessage,
    }
  }

  return {
    ok: true,
    status: "connected",
    message: "WhatsApp gateway reachable. Connect a number to start messaging.",
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * The gateway returns WhatsApp's own contact/group/label shapes, which differ
 * between engines and versions. Everything below normalises to a small,
 * stable EasyLife shape and treats every field as optional - a gateway that
 * renames a field degrades to a missing name, never to a crash or, worse, a
 * screen that silently shows the wrong contact.
 */

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function pick(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const found = str(row[key])
    if (found) return found
  }
  return null
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "contacts", "groups", "labels", "chats", "results"]) {
      const nested = (data as Record<string, unknown>)[key]
      if (Array.isArray(nested)) return nested.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    }
  }
  return []
}

export interface WhatsAppContact {
  id: string
  name: string | null
  phone: string | null
  isBlocked: boolean
  isBusiness: boolean
}

function toContact(row: Record<string, unknown>): WhatsAppContact | null {
  const id = pick(row, "id", "jid", "contactId", "_serialized")
  if (!id) return null
  return {
    id,
    name: pick(row, "name", "pushname", "pushName", "notify", "verifiedName", "shortName"),
    phone: pick(row, "number", "phone", "phoneNumber") ?? (id.includes("@") ? id.split("@")[0] : null),
    isBlocked: row.isBlocked === true || row.blocked === true,
    isBusiness: row.isBusiness === true || row.isEnterprise === true,
  }
}

export async function listContacts(
  config: GatewayConfig,
  sessionId: string
): Promise<GatewayResult<WhatsAppContact[]>> {
  const result = await request<unknown>(config, {
    method: "GET",
    route: "GET /sessions/{id}/contacts",
    path: `/sessions/${encodeSegment(sessionId)}/contacts`,
    timeoutMs: LONG_TIMEOUT_MS,
  })
  if (!result.ok) return result
  return { ok: true, data: asRows(result.data).map(toContact).filter((c): c is WhatsAppContact => c !== null) }
}

export async function listBlockedContacts(
  config: GatewayConfig,
  sessionId: string
): Promise<GatewayResult<WhatsAppContact[]>> {
  const result = await request<unknown>(config, {
    method: "GET",
    route: "GET /sessions/{id}/contacts/blocked",
    path: `/sessions/${encodeSegment(sessionId)}/contacts/blocked`,
  })
  if (!result.ok) return result
  return { ok: true, data: asRows(result.data).map(toContact).filter((c): c is WhatsAppContact => c !== null) }
}

/** Block and unblock are separate catalogue routes on purpose, so an admin
 * can grant one without the other. */
export async function setContactBlocked(
  config: GatewayConfig,
  sessionId: string,
  contactId: string,
  blocked: boolean
): Promise<GatewayResult<unknown>> {
  return request(config, {
    method: blocked ? "POST" : "DELETE",
    route: blocked
      ? "POST /sessions/{id}/contacts/{contactId}/block"
      : "DELETE /sessions/{id}/contacts/{contactId}/block",
    path: `/sessions/${encodeSegment(sessionId)}/contacts/${encodeSegment(contactId)}/block`,
  })
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface WhatsAppGroup {
  id: string
  subject: string | null
  description: string | null
  participantCount: number | null
  isAdmin: boolean
}

function toGroup(row: Record<string, unknown>): WhatsAppGroup | null {
  const id = pick(row, "id", "jid", "groupId", "_serialized")
  if (!id) return null
  const participants = row.participants
  return {
    id,
    subject: pick(row, "subject", "name", "title"),
    description: pick(row, "description", "desc"),
    participantCount: Array.isArray(participants)
      ? participants.length
      : typeof row.size === "number"
        ? row.size
        : null,
    isAdmin: row.isAdmin === true || row.iAmAdmin === true,
  }
}

export async function listGroups(config: GatewayConfig, sessionId: string): Promise<GatewayResult<WhatsAppGroup[]>> {
  const result = await request<unknown>(config, {
    method: "GET",
    route: "GET /sessions/{id}/groups",
    path: `/sessions/${encodeSegment(sessionId)}/groups`,
    timeoutMs: LONG_TIMEOUT_MS,
  })
  if (!result.ok) return result
  return { ok: true, data: asRows(result.data).map(toGroup).filter((g): g is WhatsAppGroup => g !== null) }
}

export async function createGroup(
  config: GatewayConfig,
  sessionId: string,
  subject: string,
  participants: string[]
): Promise<GatewayResult<{ groupId: string | null }>> {
  const result = await request<Record<string, unknown>>(config, {
    method: "POST",
    route: "POST /sessions/{id}/groups",
    path: `/sessions/${encodeSegment(sessionId)}/groups`,
    body: { subject, participants: participants.map((p) => p.replace(/[^\d]/g, "")) },
  })
  if (!result.ok) return result
  return { ok: true, data: { groupId: pick(result.data, "id", "groupId", "jid") } }
}

export async function getGroupInviteCode(
  config: GatewayConfig,
  sessionId: string,
  groupId: string
): Promise<GatewayResult<{ inviteUrl: string | null }>> {
  const result = await request<Record<string, unknown>>(config, {
    method: "GET",
    route: "GET /sessions/{id}/groups/{groupId}/invite-code",
    path: `/sessions/${encodeSegment(sessionId)}/groups/${encodeSegment(groupId)}/invite-code`,
  })
  if (!result.ok) return result
  const code = pick(result.data, "code", "inviteCode", "invite")
  const url = pick(result.data, "url", "inviteUrl", "link")
  return { ok: true, data: { inviteUrl: url ?? (code ? `https://chat.whatsapp.com/${code}` : null) } }
}

export async function leaveGroup(
  config: GatewayConfig,
  sessionId: string,
  groupId: string
): Promise<GatewayResult<unknown>> {
  return request(config, {
    method: "POST",
    route: "POST /sessions/{id}/groups/{groupId}/leave",
    path: `/sessions/${encodeSegment(sessionId)}/groups/${encodeSegment(groupId)}/leave`,
  })
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface WhatsAppLabel {
  id: string
  name: string | null
  colour: string | null
}

function toLabel(row: Record<string, unknown>): WhatsAppLabel | null {
  const id = pick(row, "id", "labelId")
  if (!id) return null
  return {
    id,
    name: pick(row, "name", "label", "title"),
    colour: pick(row, "colorHex", "color", "hexColor"),
  }
}

export async function listLabels(config: GatewayConfig, sessionId: string): Promise<GatewayResult<WhatsAppLabel[]>> {
  const result = await request<unknown>(config, {
    method: "GET",
    route: "GET /sessions/{id}/labels",
    path: `/sessions/${encodeSegment(sessionId)}/labels`,
  })
  if (!result.ok) return result
  return { ok: true, data: asRows(result.data).map(toLabel).filter((l): l is WhatsAppLabel => l !== null) }
}

export async function setChatLabel(
  config: GatewayConfig,
  sessionId: string,
  chatId: string,
  labelId: string,
  attach: boolean
): Promise<GatewayResult<unknown>> {
  if (attach) {
    return request(config, {
      method: "POST",
      route: "POST /sessions/{id}/labels/chat/{chatId}",
      path: `/sessions/${encodeSegment(sessionId)}/labels/chat/${encodeSegment(chatId)}`,
      body: { labelId },
    })
  }
  return request(config, {
    method: "DELETE",
    route: "DELETE /sessions/{id}/labels/chat/{chatId}/{labelId}",
    path: `/sessions/${encodeSegment(sessionId)}/labels/chat/${encodeSegment(chatId)}/${encodeSegment(labelId)}`,
  })
}

// ---------------------------------------------------------------------------
// Bulk campaigns
// ---------------------------------------------------------------------------

export interface BatchStatus {
  batchId: string
  state: string | null
  total: number | null
  sent: number | null
  failed: number | null
}

function toBatch(row: Record<string, unknown>, fallbackId: string): BatchStatus {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
  return {
    batchId: pick(row, "batchId", "id") ?? fallbackId,
    state: pick(row, "status", "state"),
    total: num(row.total) ?? num(row.count),
    sent: num(row.sent) ?? num(row.delivered) ?? num(row.succeeded),
    failed: num(row.failed) ?? num(row.errors),
  }
}

/**
 * Starts a bulk send.
 *
 * The gateway owns pacing and delivery; EasyLife's job is to hand it a clean
 * list and then report only what the gateway says came back. Nothing here
 * counts a message as sent - `getBatchStatus` does, from the gateway's own
 * numbers - because a campaign screen that inflates its own totals is worse
 * than one that shows nothing.
 */
export async function sendBulkMessages(
  config: GatewayConfig,
  sessionId: string,
  recipients: string[],
  text: string
): Promise<GatewayResult<{ batchId: string | null }>> {
  const result = await request<Record<string, unknown>>(config, {
    method: "POST",
    route: "POST /sessions/{id}/messages/send-bulk",
    path: `/sessions/${encodeSegment(sessionId)}/messages/send-bulk`,
    body: { recipients: recipients.map(toChatId), text },
    timeoutMs: LONG_TIMEOUT_MS,
  })
  if (!result.ok) return result
  return { ok: true, data: { batchId: pick(result.data, "batchId", "id", "jobId") } }
}

export async function getBatchStatus(
  config: GatewayConfig,
  sessionId: string,
  batchId: string
): Promise<GatewayResult<BatchStatus>> {
  const result = await request<Record<string, unknown>>(config, {
    method: "GET",
    route: "GET /sessions/{id}/messages/batch/{batchId}",
    path: `/sessions/${encodeSegment(sessionId)}/messages/batch/${encodeSegment(batchId)}`,
  })
  if (!result.ok) return result
  return { ok: true, data: toBatch(result.data, batchId) }
}

export async function cancelBatch(
  config: GatewayConfig,
  sessionId: string,
  batchId: string
): Promise<GatewayResult<unknown>> {
  return request(config, {
    method: "POST",
    route: "POST /sessions/{id}/messages/batch/{batchId}/cancel",
    path: `/sessions/${encodeSegment(sessionId)}/messages/batch/${encodeSegment(batchId)}/cancel`,
  })
}

// ---------------------------------------------------------------------------
// Chats and conversation history
// ---------------------------------------------------------------------------

/**
 * WhatsApp's own chat list, as the inbox screen shows it.
 *
 * `kind` matters: the gateway returns status broadcasts and newsletters in
 * the same list as real conversations, and they must not appear as chats
 * someone can reply in.
 */
export interface WhatsAppChat {
  id: string
  name: string | null
  isGroup: boolean
  kind: string
  unreadCount: number
  lastMessage: string | null
  /** Unix seconds, as WhatsApp reports it. */
  timestamp: number | null
  archived: boolean
  pinned: boolean
  muted: boolean
  favourite: boolean
}

function toChat(row: Record<string, unknown>): WhatsAppChat | null {
  const id = pick(row, "id", "chatId", "jid")
  if (!id) return null
  const count = typeof row.unreadCount === "number" ? row.unreadCount : 0
  return {
    id,
    name: pick(row, "name", "subject", "pushName", "notify"),
    isGroup: row.isGroup === true || id.endsWith("@g.us"),
    kind: pick(row, "kind", "type") ?? (id.endsWith("@g.us") ? "group" : "individual"),
    unreadCount: count > 0 ? count : 0,
    lastMessage: pick(row, "lastMessage", "lastMessageBody"),
    timestamp: typeof row.timestamp === "number" ? row.timestamp : null,
    archived: row.archived === true || row.isArchived === true,
    pinned: row.pinned === true || row.isPinned === true,
    muted: row.muted === true || row.isMuted === true,
    favourite: row.favourite === true || row.isFavourite === true || row.starred === true,
  }
}

export async function listChats(config: GatewayConfig, sessionId: string): Promise<GatewayResult<WhatsAppChat[]>> {
  const result = await request<unknown>(config, {
    method: "GET",
    route: "GET /sessions/{id}/chats",
    path: `/sessions/${encodeSegment(sessionId)}/chats`,
    timeoutMs: LONG_TIMEOUT_MS,
  })
  if (!result.ok) return result
  return { ok: true, data: asRows(result.data).map(toChat).filter((c): c is WhatsAppChat => c !== null) }
}

export interface WhatsAppChatMessage {
  id: string
  chatId: string
  body: string | null
  type: string
  /** "in" for the customer, "out" for the linked number. */
  direction: "in" | "out"
  timestamp: number | null
  status: string | null
  authorName: string | null
  hasMedia: boolean
}

function toChatMessage(row: Record<string, unknown>): WhatsAppChatMessage | null {
  const id = pick(row, "waMessageId", "id", "messageId")
  const chatId = pick(row, "chatId", "chat", "from")
  if (!id || !chatId) return null
  const dir = pick(row, "direction") ?? ""
  return {
    id,
    chatId,
    body: pick(row, "body", "text", "caption"),
    type: pick(row, "type") ?? "text",
    // The gateway says "incoming"/"outgoing"; `fromMe` is the fallback for
    // engines that only report that.
    direction: dir.startsWith("out") || row.fromMe === true ? "out" : "in",
    timestamp: typeof row.timestamp === "number" ? row.timestamp : null,
    status: pick(row, "status"),
    authorName: pick(row, "authorName", "pushName", "chatName"),
    hasMedia: Boolean(pick(row, "mediaPath", "mediaUrl", "mediaMimetype")),
  }
}

/**
 * One conversation's messages, newest last.
 *
 * The gateway keeps its own copy of the thread (it syncs history when a
 * number is linked), so this reads from there rather than from EasyLife's
 * `whatsapp_messages`, which only holds what arrived after linking.
 */
export async function listChatMessages(
  config: GatewayConfig,
  sessionId: string,
  chatId: string,
  limit = 50
): Promise<GatewayResult<WhatsAppChatMessage[]>> {
  const result = await request<unknown>(config, {
    method: "GET",
    route: "GET /sessions/{id}/messages",
    path: `/sessions/${encodeSegment(sessionId)}/messages?chatId=${encodeSegment(chatId)}&limit=${Math.min(200, Math.max(1, limit))}`,
    timeoutMs: LONG_TIMEOUT_MS,
  })
  if (!result.ok) return result
  const rows = asRows(
    result.data && typeof result.data === "object" && "messages" in (result.data as object)
      ? (result.data as { messages: unknown }).messages
      : result.data
  )
  const messages = rows.map(toChatMessage).filter((m): m is WhatsAppChatMessage => m !== null)
  // Oldest first, so the conversation reads top to bottom.
  return { ok: true, data: messages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)) }
}

export interface WhatsAppStatusUpdate {
  id: string
  contactName: string | null
  contactId: string | null
  type: string
  caption: string | null
  timestamp: number | null
}

export async function listStatusUpdates(
  config: GatewayConfig,
  sessionId: string
): Promise<GatewayResult<WhatsAppStatusUpdate[]>> {
  const result = await request<unknown>(config, {
    method: "GET",
    route: "GET /sessions/{id}/status",
    path: `/sessions/${encodeSegment(sessionId)}/status`,
    timeoutMs: LONG_TIMEOUT_MS,
  })
  if (!result.ok) return result
  const rows = asRows(
    result.data && typeof result.data === "object" && "statuses" in (result.data as object)
      ? (result.data as { statuses: unknown }).statuses
      : result.data
  )
  return {
    ok: true,
    data: rows
      .map((row): WhatsAppStatusUpdate | null => {
        const id = pick(row, "id")
        if (!id) return null
        const contact = (row.contact ?? {}) as Record<string, unknown>
        return {
          id,
          contactName: pick(contact, "name", "pushName"),
          contactId: pick(contact, "id"),
          type: pick(row, "type") ?? "text",
          caption: pick(row, "caption", "body"),
          timestamp: typeof row.timestamp === "number" ? row.timestamp : null,
        }
      })
      .filter((s): s is WhatsAppStatusUpdate => s !== null),
  }
}
