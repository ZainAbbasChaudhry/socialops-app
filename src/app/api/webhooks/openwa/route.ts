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
import { phoneFromChatId } from "@/lib/integrations/whatsapp/openwa-client"
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

/**
 * OpenWA wraps every delivery as
 * `{ event, timestamp, sessionId, idempotencyKey, deliveryId, data }` and
 * names its events `message.received`, `session.status`, and so on - the
 * message itself lives in `data`, not in a `message` field.
 *
 * This was written against a stub that spoke a flatter shape, so real
 * deliveries were acknowledged and silently discarded: the gateway recorded
 * a successful delivery, EasyLife recorded nothing, and nothing anywhere
 * said the two disagreed. Both shapes are accepted now - the flat one costs
 * nothing to keep and other gateways use it - but OpenWA's is what real
 * traffic looks like.
 */
interface OpenWaMessagePayload {
  id?: string
  from?: string
  pushName?: string | null
  type?: string
  /** OpenWA calls the text `body`; the flatter shape calls it `text`. */
  body?: string | null
  text?: string | null
  fromMe?: boolean
  isGroup?: boolean
  isStatusBroadcast?: boolean
  timestamp?: number
}

interface OpenWaWebhookBody {
  event?: string
  sessionId?: string
  /** OpenWA's envelope. */
  data?: OpenWaMessagePayload & {
    status?: string
    phone?: string | null
    connectedNumber?: string | null
    error?: string | null
  }
  /** The flatter shape. */
  message?: OpenWaMessagePayload
  session?: {
    status?: string
    connectedNumber?: string | null
    error?: string | null
  }
}

/** True for the message-delivery events, under either naming. */
function isMessageEvent(event: string | undefined): boolean {
  return event === "message.received" || event === "message"
}

function isSessionEvent(event: string | undefined): boolean {
  return event === "session.status" || event === "session.status.changed" || event === "session.state"
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
  if (isSessionEvent(parsed.event)) {
    const sessionPayload = parsed.session ?? parsed.data
    const status = normalizeStatus(sessionPayload?.status)
    if (status) {
      await updateAccountConnection(account.workspaceId, account.id, {
        connectionStatus: status,
        connectedNumber:
          sessionPayload?.connectedNumber ?? (sessionPayload as { phone?: string | null })?.phone ?? account.connectedNumber,
        displayPhoneNumber:
          sessionPayload?.connectedNumber ?? (sessionPayload as { phone?: string | null })?.phone ?? account.displayPhoneNumber,
        lastError: status === "error" ? (sessionPayload?.error ?? "Gateway reported an error") : null,
        ...(status === "connected" ? { lastConnectedAt: new Date() } : {}),
        ...(status === "disconnected" ? { lastDisconnectedAt: new Date() } : {}),
      })
    }
    return NextResponse.json({ ok: true })
  }

  const message = parsed.data ?? parsed.message
  if (!isMessageEvent(parsed.event) || !message?.id || !message.from) {
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

  // Status/story broadcasts are not a conversation with anyone - turning one
  // into a lead would put every contact's story into the CRM.
  if (message.isStatusBroadcast) {
    return NextResponse.json({ ok: true })
  }

  // Nor is a group. A group message would create a "lead" whose phone number
  // is a group id, which no salesperson can ever call back.
  if (message.isGroup) {
    return NextResponse.json({ ok: true })
  }

  // WhatsApp addresses senders by JID (`923001234567@c.us`). The CRM stores
  // the phone number a person can actually read and dial; the JID is rebuilt
  // at send time. Storing it raw put "923446242066@c.us" in the lead's phone
  // field.
  const fromPhone = phoneFromChatId(message.from)
  if (!fromPhone) {
    return NextResponse.json({ ok: true })
  }

  const event = await recordWebhookEvent({
    provider: "openwa",
    workspaceId: account.workspaceId,
    externalEventId: message.id,
    eventType: message.type ?? "text",
    payloadSummary: { from: fromPhone, type: message.type ?? "text" },
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
      from: fromPhone,
      contactName: message.pushName ?? null,
      externalMessageId: message.id,
      messageType: message.type ?? "text",
      body: (message.type ?? "text") === "text" ? (message.body ?? message.text ?? null) : null,
      rawMetadata: { from: fromPhone, chatId: message.from, type: message.type ?? "text", timestamp: message.timestamp ?? null },
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
