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
  listChats,
  listChatMessages,
  listStatusUpdates,
  sendTextMessage,
} from "@/lib/integrations/whatsapp/openwa-client"
import { getWorkspaceFeatures, hasFeature } from "@/lib/integrations/whatsapp/feature-access"

/**
 * The WhatsApp inbox: the chat list, one conversation's messages, status
 * updates, and sending a reply.
 *
 * This is the screen a client actually lives in, so it is deliberately a
 * single route with a `view` parameter rather than four: one authenticated
 * workspace lookup, one gateway resolution, one place the entitlements are
 * read. Every part answers only what the workspace is entitled to - a plan
 * without "See the chat list" gets a 403 naming the capability, never an
 * empty list that reads as "you have no chats".
 */

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const { workspaceId } = auth.ctx

    const url = new URL(request.url)
    const view = url.searchParams.get("view") ?? "chats"

    const resolved = await resolveGatewayContext(workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    const { config, sessionId } = resolved.ctx
    const features = await getWorkspaceFeatures(workspaceId)

    if (view === "messages") {
      const chatId = url.searchParams.get("chatId")
      if (!chatId) return NextResponse.json({ error: "Which conversation?" }, { status: 400 })
      const limit = Number(url.searchParams.get("limit") ?? 60)

      const messages = await listChatMessages(config, sessionId, chatId, Number.isFinite(limit) ? limit : 60)
      if (!messages.ok) {
        return NextResponse.json(gatewayFailureBody(messages), { status: statusForGatewayFailure(messages) })
      }
      return NextResponse.json({
        messages: messages.data,
        canSend: hasFeature(features, "message.send-text"),
      })
    }

    if (view === "status") {
      const statuses = await listStatusUpdates(config, sessionId)
      if (!statuses.ok) {
        return NextResponse.json(gatewayFailureBody(statuses), { status: statusForGatewayFailure(statuses) })
      }
      return NextResponse.json({ statuses: statuses.data })
    }

    const chats = await listChats(config, sessionId)
    if (!chats.ok) {
      return NextResponse.json(gatewayFailureBody(chats), { status: statusForGatewayFailure(chats) })
    }

    // Status broadcasts and newsletters arrive in the same list as real
    // conversations. They are not chats anyone replies in, and showing them
    // as such is how a client ends up "replying" into a void.
    const conversations = chats.data.filter((c) => c.kind === "individual" || c.kind === "group" || c.isGroup)

    return NextResponse.json({
      chats: conversations,
      can: {
        send: hasFeature(features, "message.send-text"),
        status: hasFeature(features, "business.status"),
        groups: hasFeature(features, "group.read"),
        contacts: hasFeature(features, "contact.list"),
      },
    })
  } catch (error) {
    return apiError(error, "Failed to load the WhatsApp inbox")
  }
}

const sendSchema = z.object({
  chatId: z.string().trim().min(3).max(128),
  text: z.string().trim().min(1).max(4096),
})

/** Sends a reply into a conversation. Any workspace member may reply - this
 * is the inbox, and answering a customer is the job. */
export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const body = sendSchema.parse(await request.json())
    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const result = await sendTextMessage(resolved.ctx.config, resolved.ctx.sessionId, body.chatId, body.text)
    if (!result.ok) {
      // Never reported as sent on this route's own authority: the id comes
      // from WhatsApp or the send is a failure.
      return NextResponse.json(
        { error: result.errorMessage ?? "The message was not sent." },
        { status: 502 }
      )
    }
    return NextResponse.json({ ok: true, externalMessageId: result.externalMessageId })
  } catch (error) {
    return apiError(error, "Failed to send the message")
  }
}
