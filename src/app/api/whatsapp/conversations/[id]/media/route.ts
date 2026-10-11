import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { requireClientMode } from "@/lib/auth/dashboard-mode-guard"
import { getConversationById, insertOutboundMediaMessage, updateConversation } from "@/lib/integrations/whatsapp/repository"
import { computeSessionWindow } from "@/lib/integrations/whatsapp/session-window"
import { uploadWhatsAppMedia, sendWhatsAppMediaMessage } from "@/lib/integrations/whatsapp/cloud-api"
import { validateWhatsAppMedia, storeWhatsAppMedia, MAX_WHATSAPP_UPLOAD_BYTES } from "@/lib/integrations/whatsapp/media"
import { resolveActiveConnection, resolveCredentialValue } from "@/lib/integrations/credential-resolution"
import { apiError } from "@/lib/api/errors"

/** Sends a real attachment (image/video/audio/document) to the customer
 * through the Cloud API - mirrors the plain-text /messages route, but a
 * multipart upload instead of JSON since there's a file involved. The
 * uploaded bytes are kept in this app's own storage (not just left on
 * Meta's side) so the thread can display them indefinitely - Meta's own
 * copy and CDN URL are not guaranteed to stay retrievable. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin", "manager", "sales"])
    if (roleCheck) return roleCheck
    const modeCheck = await requireClientMode()
    if (modeCheck) return modeCheck

    const { id } = await ctx.params
    const conversation = await getConversationById(auth.ctx.workspaceId, id)
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

    const sessionWindow = computeSessionWindow(conversation.lastInboundMessageAt)
    if (!sessionWindow.open) {
      return NextResponse.json(
        {
          error: "The 24-hour window for this conversation has closed. You can only send a pre-approved template message until the customer messages again.",
          sessionWindow,
        },
        { status: 409 }
      )
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_WHATSAPP_UPLOAD_BYTES + 10_000) {
      return NextResponse.json({ error: "File is too large." }, { status: 413 })
    }

    const form = await request.formData()
    const file = form.get("file")
    const caption = form.get("caption")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 })
    }
    const captionText = typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 1024) : null

    const buffer = Buffer.from(await file.arrayBuffer())
    const validation = validateWhatsAppMedia(file.type, buffer.byteLength)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { live, row } = await resolveActiveConnection(auth.ctx.workspaceId, "whatsapp")
    if (!live) {
      return NextResponse.json({ error: "WhatsApp is not connected and activated for this workspace. Configure it in Integrations." }, { status: 400 })
    }
    const { value: phoneNumberId } = resolveCredentialValue(row, "phoneNumberId", "whatsapp")
    const { value: accessToken } = resolveCredentialValue(row, "accessToken", "whatsapp")
    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: "WhatsApp credentials are incomplete for this workspace." }, { status: 400 })
    }

    const stored = await storeWhatsAppMedia(auth.ctx.workspaceId, buffer, validation.extension)
    const originalFilename = validation.category === "document" ? file.name : null

    const upload = await uploadWhatsAppMedia(phoneNumberId, accessToken, buffer, file.type, file.name)
    if (!upload.ok || !upload.mediaId) {
      const message = await insertOutboundMediaMessage(
        auth.ctx.workspaceId,
        id,
        validation.category,
        captionText,
        "agent",
        null,
        "failed",
        { storageKey: stored.storageKey, mimeType: file.type, filename: originalFilename, sizeBytes: stored.sizeBytes }
      )
      return NextResponse.json({ error: upload.errorMessage ?? "Upload to WhatsApp failed", message }, { status: 502 })
    }

    const sendResult = await sendWhatsAppMediaMessage(phoneNumberId, accessToken, conversation.contactPhone, validation.category, upload.mediaId, {
      caption: captionText ?? undefined,
      filename: originalFilename ?? undefined,
    })

    const message = await insertOutboundMediaMessage(
      auth.ctx.workspaceId,
      id,
      validation.category,
      captionText,
      "agent",
      sendResult.externalMessageId ?? null,
      sendResult.ok ? "sent" : "failed",
      { storageKey: stored.storageKey, mimeType: file.type, filename: originalFilename, sizeBytes: stored.sizeBytes }
    )

    const now = new Date()
    await updateConversation(auth.ctx.workspaceId, id, {
      status: "human",
      lastMessageAt: now,
      pendingAiReply: null,
      ...(sendResult.ok ? { lastOutboundMessageAt: now } : {}),
      ...(sendResult.ok && !conversation.firstResponseAt ? { firstResponseAt: now } : {}),
    })

    if (!sendResult.ok) {
      return NextResponse.json({ error: sendResult.errorMessage ?? "WhatsApp send failed", message }, { status: 502 })
    }

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    return apiError(error, "Failed to send attachment")
  }
}
