import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/guard"
import { apiError } from "@/lib/api/errors"
import {
  resolveGatewayContext,
  statusForGatewayFailure,
  gatewayFailureBody,
} from "@/lib/integrations/whatsapp/gateway-context"
import { downloadMessageMedia } from "@/lib/integrations/whatsapp/openwa-client"

/**
 * Serves one message's media - a photo, a video, a voice note, a PDF - to the
 * browser.
 *
 * It proxies rather than redirecting. A redirect to the gateway would mean
 * either exposing the gateway to the public internet or handing the browser
 * an API key, and both are worse than one extra hop. Going through here also
 * means the workspace check and the feature gate apply to media exactly as
 * they apply to everything else: one workspace cannot fetch another's photos
 * by guessing a message id.
 *
 * Media is fetched on demand, never stored by EasyLife. WhatsApp's own copy
 * stays the only copy.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const chatId = url.searchParams.get("chatId")
    const messageId = url.searchParams.get("messageId")
    if (!chatId || !messageId) {
      return NextResponse.json({ error: "Which message?" }, { status: 400 })
    }

    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const media = await downloadMessageMedia(resolved.ctx.config, resolved.ctx.sessionId, chatId, messageId)
    if (!media.ok) {
      return NextResponse.json(gatewayFailureBody(media), { status: statusForGatewayFailure(media) })
    }

    const bytes = Buffer.from(media.data.base64, "base64")
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": media.data.mimeType,
        "Content-Length": String(bytes.length),
        // A message's media never changes, so it is worth caching - but only
        // in the viewer's own browser. `private` keeps it out of any shared
        // cache, because this is somebody's WhatsApp.
        "Cache-Control": "private, max-age=3600",
        ...(media.data.filename
          ? { "Content-Disposition": `inline; filename="${media.data.filename.replace(/"/g, "")}"` }
          : {}),
      },
    })
  } catch (error) {
    return apiError(error, "Failed to load that media")
  }
}
