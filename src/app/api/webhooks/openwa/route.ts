import { createHmac, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { resolveCredentialValue } from "@/lib/integrations/credential-resolution"
import { getConnection } from "@/lib/integrations/repository"
import {
  findOpenWaAccountBySession,
  updateAccountConnection,
} from "@/lib/integrations/whatsapp/repository"
import { processInboundMessage } from "@/lib/integrations/whatsapp/pipeline"
import { openWaTransport, resolveOpenWaConfig } from "@/lib/integrations/whatsapp/transport"
import {
  recordWebhookEvent,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from "@/lib/integrations/webhook-events"

/**
 * Inbound webhook for the self-hosted OpenWA gateway (Baileys NOWEB).
 *
 * Trust model, deliberately identical in shape to the Meta webhook next
 * door: the session id inside the body is an *untrusted routing hint* used
 * only to find which workspace this delivery might belong to. Nothing is
 * acted on until the request's HMAC-SHA256 signature - computed with that
 * workspace's own stored gateway webhook secret - matches. A workspace can
 * therefore never receive, or reply to, another workspace's traffic even if
 * an attacker learns a session id.
 *
 * There is no GET verification handshake here: unlike Meta, the gateway is
 * a service EasyLife runs, and it authenticates to this endpoint by signing
 * every delivery rather than by completing a one-time challenge.
 */

/** A body this large is not a WhatsApp text message; refusing it early
 * keeps a malicious or malfunctioning gateway from making this route
 * allocate unbounded memory before the signature is even checked. */
const MAX_BODY_BYTES = 256 * 1024

type OpenWaEventType = "message" | "session.status"

interface OpenWaWebhookBody {
  event?: OpenWaEventType
  sessionId?: string
  message?: {
    id?: string
    from?: string
    pushName?: string | null
    type?: string
    text?: string | null
    /** Baileys sets this for messages the paired phone itself sent. Echoes
     * of our own outbound replies must never re-enter the pipeline. */
    fromMe?: boolean
    timestamp?: number
  }
  session?: {
    status?: string
    connectedNumber?: string | null
    error?: string | null
  }
}

function signatureValid(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), "hex")
  const provided = Buffer.from(header.slice("sha256=".length), "hex")
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

function normalizeStatus(value: unknown): "disconnected" | "connecting" | "qr" | "connected" | "error" | null {
  return value === "disconnected" || value === "connecting" || value === "qr" || value === "connected" || value === "error"
    ? value
    : null
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  let parsed: OpenWaWebhookBody
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const sessionId = parsed.sessionId
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session identifier" }, { status: 400 })
  }

  const account = await findOpenWaAccountBySession(sessionId)
  if (!account) {
    // Same posture as the Meta route: never distinguish "unknown session"
    // from "misconfigured workspace" to an unauthenticated caller.
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const connectionRow = await getConnection(account.workspaceId, "openwa")
  const { value: webhookSecret } = resolveCredentialValue(connectionRow, "webhookSecret", "openwa")
  if (!webhookSecret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (!signatureValid(rawBody, request.headers.get("x-openwa-signature"), webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  // ---- Trusted from here on. -------------------------------------------

  // Connection-state deliveries: the gateway is the only authority on
  // whether a phone is actually paired, so this is the one place
  // connection_status is allowed to become "connected".
  if (parsed.event === "session.status") {
    const status = normalizeStatus(parsed.session?.status)
    if (status) {
      await updateAccountConnection(account.workspaceId, account.id, {
        connectionStatus: status,
        connectedNumber: parsed.session?.connectedNumber ?? account.connectedNumber,
        displayPhoneNumber: parsed.session?.connectedNumber ?? account.displayPhoneNumber,
        lastError: status === "error" ? (parsed.session?.error ?? "Gateway reported an error") : null,
        ...(status === "connected" ? { lastConnectedAt: new Date() } : {}),
        ...(status === "disconnected" ? { lastDisconnectedAt: new Date() } : {}),
      })
    }
    return NextResponse.json({ ok: true })
  }

  const message = parsed.message
  if (parsed.event !== "message" || !message?.id || !message.from) {
    // Unknown or incomplete event types are acknowledged, not retried -
    // returning non-2xx would make the gateway redeliver something this
    // app will never understand.
    return NextResponse.json({ ok: true })
  }

  // The gateway echoes messages the paired phone sends itself, including
  // the bot's own replies. Processing those would loop the bot against
  // itself, so they are recorded as seen and dropped.
  if (message.fromMe) {
    return NextResponse.json({ ok: true })
  }

  const event = await recordWebhookEvent({
    provider: "openwa",
    workspaceId: account.workspaceId,
    externalEventId: message.id,
    eventType: message.type ?? "text",
    payloadSummary: { from: message.from, type: message.type ?? "text" },
  })
  if (!event) return NextResponse.json({ ok: true }) // already delivered

  const config = await resolveOpenWaConfig(account.workspaceId)
  if (!config || !account.sessionId) {
    await markWebhookEventFailed(event.id, "gateway_not_configured")
    return NextResponse.json({ ok: true })
  }

  try {
    await processInboundMessage({
      workspaceId: account.workspaceId,
      accountId: account.id,
      transport: openWaTransport(config, account.sessionId),
      from: message.from,
      contactName: message.pushName ?? null,
      externalMessageId: message.id,
      messageType: message.type ?? "text",
      body: (message.type ?? "text") === "text" ? (message.text ?? null) : null,
      rawMetadata: { from: message.from, type: message.type ?? "text", timestamp: message.timestamp ?? null },
    })
    await markWebhookEventProcessed(event.id)
  } catch (error) {
    // One bad message never fails the delivery - the gateway would just
    // redeliver it forever.
    console.error("[OpenWA] inbound processing failed:", error instanceof Error ? error.message : error)
    await markWebhookEventFailed(event.id, "processing_error")
  }

  return NextResponse.json({ ok: true })
}
