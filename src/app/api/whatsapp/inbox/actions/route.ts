import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { apiError } from "@/lib/api/errors"
import {
  resolveGatewayContext,
  statusForGatewayFailure,
  gatewayFailureBody,
} from "@/lib/integrations/whatsapp/gateway-context"
import {
  forwardMessage,
  starMessage,
  reactToMessage,
  replyToMessage,
  markChatRead,
  convertToVoiceNote,
  sendMediaMessage,
  setChatFlag,
  type MediaKind,
} from "@/lib/integrations/whatsapp/openwa-client"

/**
 * The things people do to a message once it exists: forward it, star it,
 * react to it, quote it in a reply - plus sending media and voice notes, and
 * marking a chat read.
 *
 * One route with an `action`, for the same reason the inbox is one route:
 * every one of these needs the same authenticated workspace, the same gateway
 * resolution and the same entitlement read, and splitting them into six files
 * would mean six places for those three things to drift apart.
 *
 * Each action is separately catalogued, so an EasyLife admin can grant
 * replying without granting forwarding.
 */

/** Base64 payloads travel in the request body, so this bounds what one
 * request can carry before anything is decoded. WhatsApp's own ceiling is
 * lower for most types; this is the outer wall, not the policy. */
const MAX_MEDIA_BASE64 = 24 * 1024 * 1024

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("forward"),
    chatId: z.string().trim().min(3).max(128),
    messageId: z.string().trim().min(1).max(128),
    toChatId: z.string().trim().min(3).max(128),
  }),
  z.object({
    action: z.literal("star"),
    chatId: z.string().trim().min(3).max(128),
    messageId: z.string().trim().min(1).max(128),
    starred: z.boolean(),
  }),
  z.object({
    action: z.literal("react"),
    chatId: z.string().trim().min(3).max(128),
    messageId: z.string().trim().min(1).max(128),
    /** "" removes a reaction - that is WhatsApp's own convention. */
    emoji: z.string().max(16),
  }),
  z.object({
    action: z.literal("reply"),
    chatId: z.string().trim().min(3).max(128),
    messageId: z.string().trim().min(1).max(128),
    text: z.string().trim().min(1).max(4096),
  }),
  z.object({
    action: z.literal("read"),
    chatId: z.string().trim().min(3).max(128),
  }),
  z.object({
    action: z.literal("chat-flag"),
    chatId: z.string().trim().min(3).max(128),
    flag: z.enum(["archive", "pin", "mute"]),
    on: z.boolean(),
  }),
  z.object({
    action: z.literal("send-media"),
    chatId: z.string().trim().min(3).max(128),
    kind: z.enum(["image", "video", "audio", "document", "sticker"]),
    base64: z.string().min(1).max(MAX_MEDIA_BASE64),
    mimeType: z.string().trim().min(3).max(128),
    filename: z.string().trim().max(255).optional(),
    caption: z.string().trim().max(1024).optional(),
    /** True for a recording that should appear as a mic bubble rather than
     * an audio file. The gateway converts it to Ogg/Opus first. */
    voiceNote: z.boolean().optional(),
  }),
])

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const body = schema.parse(await request.json())
    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    const { config, sessionId } = resolved.ctx

    switch (body.action) {
      case "forward": {
        const result = await forwardMessage(config, sessionId, body.chatId, body.messageId, body.toChatId)
        if (!result.ok) return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
        return NextResponse.json({ ok: true })
      }

      case "star": {
        const result = await starMessage(config, sessionId, body.chatId, body.messageId, body.starred)
        if (!result.ok) return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
        return NextResponse.json({ ok: true, starred: body.starred })
      }

      case "react": {
        const result = await reactToMessage(config, sessionId, body.chatId, body.messageId, body.emoji)
        if (!result.ok) return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
        return NextResponse.json({ ok: true })
      }

      case "reply": {
        const result = await replyToMessage(config, sessionId, body.chatId, body.messageId, body.text)
        if (!result.ok) {
          return NextResponse.json({ error: result.errorMessage ?? "The reply was not sent." }, { status: 502 })
        }
        return NextResponse.json({ ok: true, externalMessageId: result.externalMessageId })
      }

      case "read": {
        const result = await markChatRead(config, sessionId, body.chatId)
        if (!result.ok) return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
        return NextResponse.json({ ok: true })
      }

      case "chat-flag": {
        const result = await setChatFlag(config, sessionId, body.chatId, body.flag, body.on)
        if (!result.ok) return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
        return NextResponse.json({ ok: true, flag: body.flag, on: body.on })
      }

      case "send-media": {
        let base64 = body.base64
        let mimeType = body.mimeType

        // A recording sent as-is arrives as an audio attachment with a
        // download button, not the mic bubble people expect - and on some
        // clients it will not play at all. The gateway has ffmpeg; EasyLife
        // does not, so the conversion happens there.
        if (body.voiceNote) {
          const converted = await convertToVoiceNote(config, sessionId, base64, mimeType)
          if (!converted.ok) {
            return NextResponse.json(gatewayFailureBody(converted), { status: statusForGatewayFailure(converted) })
          }
          base64 = converted.data.base64
          mimeType = converted.data.mimeType
        }

        const result = await sendMediaMessage(config, sessionId, body.kind as MediaKind, body.chatId, {
          base64,
          mimetype: mimeType,
          filename: body.filename,
          caption: body.caption,
        })
        if (!result.ok) {
          return NextResponse.json({ error: result.errorMessage ?? "The file was not sent." }, { status: 502 })
        }
        return NextResponse.json({ ok: true, externalMessageId: result.externalMessageId })
      }
    }
  } catch (error) {
    return apiError(error, "That action failed")
  }
}
