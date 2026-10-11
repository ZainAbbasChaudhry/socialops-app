import type { TestConnectionResult } from "../service"

/**
 * Official Meta WhatsApp Business Cloud API client. No WhatsApp Web
 * automation, no browser scraping, no unofficial library — this is the only
 * transport for real WhatsApp send/receive in this app.
 *
 * Graph API version pinned to one constant so bumping it later is a
 * one-line change rather than a search-and-replace.
 */
const GRAPH_API_VERSION = "v21.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface SendTextMessageResult {
  ok: boolean
  externalMessageId?: string
  errorMessage?: string
}

/** POST /{phone-number-id}/messages — sends a plain text message. */
export async function sendWhatsAppTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: string
): Promise<SendTextMessageResult> {
  try {
    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, errorMessage: json?.error?.message ?? `WhatsApp send failed (${res.status})` }
    }

    const externalMessageId = json?.messages?.[0]?.id as string | undefined
    return { ok: true, externalMessageId }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unknown WhatsApp send error" }
  }
}

export type WhatsAppMediaType = "image" | "video" | "audio" | "document" | "sticker"

export interface MediaMetaResult {
  ok: boolean
  url?: string
  mimeType?: string
  sizeBytes?: number
  errorMessage?: string
}

/** GET /{media-id} — resolves Meta's short-lived (~5 min) CDN download URL
 * for an inbound media attachment. The URL itself still requires the same
 * Bearer token to fetch - it is not a public link. */
export async function fetchWhatsAppMediaMeta(mediaId: string, accessToken: string): Promise<MediaMetaResult> {
  try {
    const res = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, errorMessage: json?.error?.message ?? `Media lookup failed (${res.status})` }
    return { ok: true, url: json?.url, mimeType: json?.mime_type, sizeBytes: json?.file_size }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unknown media lookup error" }
  }
}

/** Downloads the actual bytes from a URL returned by fetchWhatsAppMediaMeta
 * - that CDN URL only answers to the same access token used above. */
export async function downloadWhatsAppMedia(url: string, accessToken: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

export interface UploadMediaResult {
  ok: boolean
  mediaId?: string
  errorMessage?: string
}

/** POST /{phone-number-id}/media — uploads a file to Meta ahead of sending
 * it, returning a media id this app's own send call then references.
 * Required before sendWhatsAppMediaMessage; Meta doesn't accept raw bytes
 * inline on the /messages call itself. */
export async function uploadWhatsAppMedia(
  phoneNumberId: string,
  accessToken: string,
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<UploadMediaResult> {
  try {
    const form = new FormData()
    form.append("messaging_product", "whatsapp")
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename)

    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.id) {
      return { ok: false, errorMessage: json?.error?.message ?? `Media upload failed (${res.status})` }
    }
    return { ok: true, mediaId: json.id }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unknown media upload error" }
  }
}

/** POST /{phone-number-id}/messages — sends a media message that
 * references an id from uploadWhatsAppMedia. `filename` is only meaningful
 * (and only sent) for `document`, matching what Meta's API accepts. */
export async function sendWhatsAppMediaMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  type: WhatsAppMediaType,
  mediaId: string,
  options?: { caption?: string; filename?: string }
): Promise<SendTextMessageResult> {
  try {
    const mediaPayload: Record<string, unknown> = { id: mediaId }
    if (options?.caption && (type === "image" || type === "video" || type === "document")) mediaPayload.caption = options.caption
    if (options?.filename && type === "document") mediaPayload.filename = options.filename

    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ messaging_product: "whatsapp", to, type, [type]: mediaPayload }),
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, errorMessage: json?.error?.message ?? `WhatsApp media send failed (${res.status})` }

    const externalMessageId = json?.messages?.[0]?.id as string | undefined
    return { ok: true, externalMessageId }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unknown WhatsApp send error" }
  }
}

/** Lightweight, read-only GET used for "Test Connection" — never sends a
 * message, never incurs cost, just confirms the phone number ID + access
 * token are valid and the token has permission to read this number. */
export async function testWhatsAppCredentials(phoneNumberId: string, accessToken: string): Promise<TestConnectionResult> {
  try {
    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}?fields=verified_name,display_phone_number`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const code = json?.error?.code
      if (code === 190) return { ok: false, status: "expired", message: "Access token is invalid or expired." }
      return { ok: false, status: "error", message: json?.error?.message ?? `WhatsApp API returned ${res.status}` }
    }

    const name = json?.verified_name ?? json?.display_phone_number ?? "WhatsApp number"
    return { ok: true, status: "connected", message: `Connected to ${name}.` }
  } catch (error) {
    return { ok: false, status: "error", message: error instanceof Error ? error.message : "Couldn't reach the WhatsApp API." }
  }
}
