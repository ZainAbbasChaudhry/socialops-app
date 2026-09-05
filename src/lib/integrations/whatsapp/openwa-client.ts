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
function coerceStatus(raw: unknown): SessionStatus {
  const value = String(raw ?? "").toUpperCase()
  if (value === "WORKING" || value === "CONNECTED" || value === "AUTHENTICATED") return "connected"
  if (value === "SCAN_QR_CODE" || value === "QR" || value === "PAIRING") return "qr"
  if (value === "STARTING" || value === "CONNECTING" || value === "INITIALIZING") return "connecting"
  if (value === "FAILED" || value === "ERROR") return "error"
  return "disconnected"
}

function coerceState(data: Record<string, unknown>): SessionState {
  const me = data.me as Record<string, unknown> | undefined
  const number =
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
    body: { to: to.replace(/[^\d]/g, ""), text: body },
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
    body: { to: to.replace(/[^\d]/g, ""), ...media },
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
