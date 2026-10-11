import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/guard"
import { getConversationById, getMessageInConversation } from "@/lib/integrations/whatsapp/repository"
import { readWhatsAppMedia } from "@/lib/integrations/whatsapp/media"
import { apiError } from "@/lib/api/errors"

/** Authenticated retrieval of a WhatsApp message's stored attachment -
 * scoped through the conversation (which is itself scoped to the
 * session's workspace), same visibility rule as /api/media/[id]/file: any
 * signed-in member of the owning workspace, no one else, and a wrong
 * conversation/message pairing 404s exactly like a missing one does. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const { id, messageId } = await ctx.params
    const conversation = await getConversationById(auth.ctx.workspaceId, id)
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const message = await getMessageInConversation(auth.ctx.workspaceId, id, messageId)
    if (!message || !message.mediaStorageKey) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const buffer = await readWhatsAppMedia(message.mediaStorageKey)
    if (!buffer) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const filename = message.mediaFilename ?? "attachment"
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": message.mediaMimeType ?? "application/octet-stream",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    return apiError(error, "Failed to load attachment")
  }
}
