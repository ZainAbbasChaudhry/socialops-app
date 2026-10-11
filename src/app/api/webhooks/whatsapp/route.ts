import { createHmac, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { decryptSecret } from "@/lib/integrations/crypto"
import {
  findWhatsAppContextByWaba,
  findWhatsAppContextByVerifyToken,
  applyMessageStatusUpdate,
} from "@/lib/integrations/whatsapp/repository"
import { processInboundMessage } from "@/lib/integrations/whatsapp/pipeline"
import { recordWebhookEvent, markWebhookEventProcessed, markWebhookEventFailed } from "@/lib/integrations/webhook-events"

/**
 * Official Meta WhatsApp Cloud API webhook. Two responsibilities:
 *  - GET: the one-time verification handshake Meta performs when the
 *    webhook URL is registered in the App Dashboard.
 *  - POST: real inbound deliveries (messages and status updates).
 *
 * This app doesn't yet know which workspace a delivery belongs to when it
 * arrives (there's one webhook URL, potentially many workspaces). The WABA
 * ID inside the payload is used to look up which workspace's WhatsApp
 * connection it might belong to — but that's just a routing hint from
 * untrusted input. The request is only trusted once its HMAC-SHA256
 * signature (X-Hub-Signature-256), computed with THAT workspace's own
 * stored Meta App secret, matches.
 */

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get("hub.mode")
  const token = url.searchParams.get("hub.verify_token")
  const challenge = url.searchParams.get("hub.challenge")

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Invalid verification request" }, { status: 403 })
  }

  const matched = await findWhatsAppContextByVerifyToken(token, decryptSecret)
  if (!matched) {
    return NextResponse.json({ error: "Verification failed" }, { status: 403 })
  }

  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } })
}

interface WhatsAppWebhookMessage {
  from: string
  id: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type?: string; caption?: string }
  video?: { id: string; mime_type?: string; caption?: string }
  document?: { id: string; mime_type?: string; caption?: string; filename?: string }
  audio?: { id: string; mime_type?: string }
  sticker?: { id: string; mime_type?: string }
}

interface WhatsAppWebhookStatus {
  id: string
  status: "sent" | "delivered" | "read" | "failed"
  timestamp?: string
  recipient_id?: string
}

interface WhatsAppWebhookValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string }
  contacts?: { profile?: { name?: string }; wa_id?: string }[]
  messages?: WhatsAppWebhookMessage[]
  statuses?: WhatsAppWebhookStatus[]
}

interface WhatsAppWebhookEntry {
  id?: string
  changes?: { value?: WhatsAppWebhookValue; field?: string }[]
}

interface WhatsAppWebhookBody {
  object?: string
  entry?: WhatsAppWebhookEntry[]
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  let parsed: WhatsAppWebhookBody
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const wabaId = parsed.entry?.[0]?.id
  if (!wabaId) {
    return NextResponse.json({ error: "Missing account identifier" }, { status: 400 })
  }

  const context = await findWhatsAppContextByWaba(wabaId)
  if (!context || !context.appSecretEncrypted || !context.accessTokenEncrypted) {
    // Never reveal whether this is "unknown account" vs "misconfigured."
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const appSecret = decryptSecret(context.appSecretEncrypted)
  const accessToken = decryptSecret(context.accessTokenEncrypted)
  if (!appSecret || !accessToken) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const signatureHeader = request.headers.get("x-hub-signature-256")
  if (!signatureHeader?.startsWith("sha256=")) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 })
  }
  const expectedSignature = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")
  const providedSignature = signatureHeader.slice("sha256=".length)

  const expectedBuf = Buffer.from(expectedSignature, "hex")
  const providedBuf = Buffer.from(providedSignature, "hex")
  const signatureValid =
    expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)

  if (!signatureValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  // Trusted from here on. Process every text message and every
  // delivery/read-receipt status update in every entry/change.
  for (const entry of parsed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value

      // Delivery/read receipts for messages WE sent - no `messages` array on
      // these callbacks, so this runs independently of the block below.
      for (const status of value?.statuses ?? []) {
        try {
          await applyMessageStatusUpdate(context.workspaceId, status.id, status.status)
        } catch (error) {
          console.error("WhatsApp status update processing failed:", error instanceof Error ? error.message : error)
        }
      }

      const phoneNumberId = value?.metadata?.phone_number_id
      if (!value?.messages || !phoneNumberId) continue

      for (const message of value.messages) {
        const contactName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null

        const event = await recordWebhookEvent({
          provider: "whatsapp",
          workspaceId: context.workspaceId,
          externalEventId: message.id,
          eventType: message.type,
          payloadSummary: { from: message.from, type: message.type },
        })
        if (!event) continue // already recorded - the message pipeline's own dedupe would also catch this, this is belt-and-braces

        try {
          await processInboundMessage({
            workspaceId: context.workspaceId,
            integrationConnectionId: null,
            wabaId,
            phoneNumberId,
            displayPhoneNumber: value.metadata?.display_phone_number ?? null,
            accessToken,
            from: message.from,
            contactName,
            externalMessageId: message.id,
            messageType: message.type,
            body:
              message.type === "text"
                ? (message.text?.body ?? null)
                : (message.image?.caption ?? message.video?.caption ?? message.document?.caption ?? null),
            rawMetadata: message as unknown as Record<string, unknown>,
          })
          await markWebhookEventProcessed(event.id)
        } catch (error) {
          // Never let one bad message fail the whole webhook delivery (Meta
          // retries on non-2xx) - log server-side and continue.
          console.error("WhatsApp inbound message processing failed:", error instanceof Error ? error.message : error)
          await markWebhookEventFailed(event.id, "processing_error")
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}
