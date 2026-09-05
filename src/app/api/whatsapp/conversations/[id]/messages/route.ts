import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { requireClientMode } from "@/lib/auth/dashboard-mode-guard"
import { getConversationById, listMessages, insertOutboundMessage, updateConversation } from "@/lib/integrations/whatsapp/repository"
import { resolveTransportForAccount } from "@/lib/integrations/whatsapp/transport"
import { apiError } from "@/lib/api/errors"

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const { id } = await ctx.params
    const conversation = await getConversationById(auth.ctx.workspaceId, id)
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

    const messages = await listMessages(auth.ctx.workspaceId, id, 100)
    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        sender: m.sender,
        messageType: m.messageType,
        body: m.body,
        providerStatus: m.providerStatus,
        createdAt: m.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    return apiError(error, "Failed to load messages")
  }
}

const sendSchema = z.object({ body: z.string().trim().min(1).max(4096) })

/** Lets a team member reply to a real WhatsApp conversation from the
 * dashboard - a genuine provider send, not a demo simulation.
 * Marking the conversation "human" reflects that a person just took over
 * from the bot, same transition the chatbot pipeline makes on escalation.
 *
 * The transport is resolved from the conversation's own account, so this
 * works on either provider. It previously called the Cloud API directly,
 * which meant an OpenWA workspace got "WhatsApp is not connected" here and
 * could not take a conversation over at all - and because that check
 * returned before the status update, the bot kept replying to a
 * conversation a human was trying to handle. */
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

    const body = sendSchema.parse(await request.json())

    const resolved = await resolveTransportForAccount(auth.ctx.workspaceId, conversation.whatsappAccountId)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.errorMessage }, { status: 400 })
    }

    const result = await resolved.transport.sendText(conversation.contactPhone, body.body)
    const message = await insertOutboundMessage(
      auth.ctx.workspaceId,
      id,
      body.body,
      "agent",
      result.externalMessageId ?? null,
      result.ok ? "sent" : "failed"
    )
    await updateConversation(auth.ctx.workspaceId, id, { status: "human", lastMessageAt: new Date() })

    if (!result.ok) {
      return NextResponse.json({ error: result.errorMessage ?? "WhatsApp send failed", message }, { status: 502 })
    }

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    return apiError(error, "Failed to send message")
  }
}
