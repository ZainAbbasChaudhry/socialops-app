import type { TestConnectionResult } from "../service"

/**
 * HTTP client for the OpenWA gateway - the persistent WhatsApp service that
 * runs Baileys' NOWEB engine (see `deploy/openwa/`). This app never talks to
 * WhatsApp itself: WhatsApp's socket protocol needs a long-lived process
 * holding paired session credentials, which a request-scoped Next.js route
 * on cPanel/Passenger cannot be. The gateway owns that process; this file
 * is only an HTTP caller.
 *
 * Deliberately NOT here: puppeteer, chromium, whatsapp-web.js, or any
 * browser automation. The gateway speaks Baileys' WebSocket protocol
 * directly - that is what "NOWEB" means.
 *
 * Every function returns a discriminated result rather than throwing, so a
 * gateway that is down or restarting degrades into a visible error state
 * instead of a 500 in the dashboard.
 */

/** Wall-clock ceiling for any single gateway call. The gateway is expected
 * to be on the same private network / a nearby host; a request slower than
 * this means it is wedged, and waiting longer only holds a Passenger worker
 * hostage. */
const GATEWAY_TIMEOUT_MS = 15_000

export type OpenWaSessionStatus = "disconnected" | "connecting" | "qr" | "connected" | "error"

export interface OpenWaConfig {
  baseUrl: string
  apiKey: string
}

export interface OpenWaSessionState {
  status: OpenWaSessionStatus
  /** Data-URL PNG of the pairing QR, present only while status === 'qr'. */
  qr: string | null
  /** The E.164 number of the paired phone, once the gateway knows it. */
  connectedNumber: string | null
  lastError: string | null
}

type GatewayResult<T> = { ok: true; data: T } | { ok: false; errorMessage: string }

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

/** Never interpolate a session id into a URL unescaped - session ids are
 * server-derived today, but a path-traversal-shaped id must not be able to
 * reach a different gateway endpoint if that ever changes. */
function sessionPath(baseUrl: string, sessionId: string, suffix = ""): string {
  return `${normalizeBaseUrl(baseUrl)}/sessions/${encodeURIComponent(sessionId)}${suffix}`
}

async function gatewayFetch<T>(
  config: OpenWaConfig,
  url: string,
  init: RequestInit = {}
): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        // Shared secret between this app and the gateway. Sent as a header,
        // never a query parameter - query strings land in access logs.
        "X-Api-Key": config.apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    })

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (!res.ok) {
      const message = typeof json?.error === "string" ? json.error : `OpenWA gateway returned ${res.status}`
      return { ok: false, errorMessage: message }
    }

    return { ok: true, data: (json ?? {}) as T }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, errorMessage: "OpenWA gateway timed out." }
    }
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Couldn't reach the OpenWA gateway." }
  }
}

function coerceStatus(value: unknown): OpenWaSessionStatus {
  return value === "connecting" || value === "qr" || value === "connected" || value === "error"
    ? value
    : "disconnected"
}

function coerceState(data: Record<string, unknown>): OpenWaSessionState {
  return {
    status: coerceStatus(data.status),
    qr: typeof data.qr === "string" ? data.qr : null,
    connectedNumber: typeof data.connectedNumber === "string" ? data.connectedNumber : null,
    lastError: typeof data.lastError === "string" ? data.lastError : null,
  }
}

/**
 * Asks the gateway to bring a session up. Idempotent by contract: calling
 * it on an already-connected session returns that session's current state
 * rather than tearing the pairing down and forcing a re-scan.
 */
export async function startSession(config: OpenWaConfig, sessionId: string): Promise<GatewayResult<OpenWaSessionState>> {
  const result = await gatewayFetch<Record<string, unknown>>(config, sessionPath(config.baseUrl, sessionId, "/start"), {
    method: "POST",
    body: JSON.stringify({}),
  })
  if (!result.ok) return result
  return { ok: true, data: coerceState(result.data) }
}

/** Current session state, including the pairing QR while one is pending. */
export async function getSessionState(config: OpenWaConfig, sessionId: string): Promise<GatewayResult<OpenWaSessionState>> {
  const result = await gatewayFetch<Record<string, unknown>>(config, sessionPath(config.baseUrl, sessionId), {
    method: "GET",
  })
  if (!result.ok) return result
  return { ok: true, data: coerceState(result.data) }
}

/**
 * Ends the session and clears its stored credentials on the gateway. This
 * is a real logout, not a pause - reconnecting afterwards requires scanning
 * a new QR code, which is why the dashboard confirms before calling it.
 */
export async function logoutSession(config: OpenWaConfig, sessionId: string): Promise<GatewayResult<{ status: string }>> {
  return gatewayFetch<{ status: string }>(config, sessionPath(config.baseUrl, sessionId, "/logout"), {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export interface OpenWaSendResult {
  ok: boolean
  externalMessageId?: string
  errorMessage?: string
}

/**
 * Sends a plain text message through a connected session.
 *
 * `ok: true` means the gateway accepted the message AND returned the id
 * WhatsApp assigned to it - i.e. it reached WhatsApp's servers. It is never
 * synthesized locally: a send with no id back is reported as a failure, so
 * the dashboard can never show "sent" for a message the provider did not
 * actually accept.
 */
export async function sendOpenWaTextMessage(
  config: OpenWaConfig,
  sessionId: string,
  to: string,
  body: string
): Promise<OpenWaSendResult> {
  const result = await gatewayFetch<Record<string, unknown>>(config, sessionPath(config.baseUrl, sessionId, "/messages"), {
    method: "POST",
    body: JSON.stringify({ to, text: body }),
  })

  if (!result.ok) return { ok: false, errorMessage: result.errorMessage }

  const externalMessageId = typeof result.data.id === "string" ? result.data.id : undefined
  if (!externalMessageId) {
    return { ok: false, errorMessage: "OpenWA gateway accepted the request but returned no message id." }
  }
  return { ok: true, externalMessageId }
}

/**
 * Read-only "Test Connection" probe. Hits the gateway's health endpoint,
 * which validates the API key without touching a WhatsApp session, so
 * testing costs nothing and cannot disturb a live pairing.
 */
export async function testOpenWaGateway(config: OpenWaConfig): Promise<TestConnectionResult> {
  const result = await gatewayFetch<Record<string, unknown>>(config, `${normalizeBaseUrl(config.baseUrl)}/health`, {
    method: "GET",
  })

  if (!result.ok) {
    const unauthorized = /401|403|unauthor/i.test(result.errorMessage)
    return {
      ok: false,
      status: unauthorized ? "expired" : "error",
      message: unauthorized ? "The OpenWA gateway rejected this API key." : result.errorMessage,
    }
  }

  const engine = typeof result.data.engine === "string" ? result.data.engine : "unknown engine"
  return { ok: true, status: "connected", message: `OpenWA gateway reachable (${engine}). Pair a phone to start sending.` }
}
