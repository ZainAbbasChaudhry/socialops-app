import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { requireClientMode } from "@/lib/auth/dashboard-mode-guard"
import { getConversationById, listMessages, insertOutboundMessage, updateConversation } from "@/lib/integrations/whatsapp/repository"
import { computeSessionWindow } from "@/lib/integrations/whatsapp/session-window"
import { sendWhatsAppTextMessage } from "@/lib/integrations/whatsapp/cloud-api"
import { resolveActiveConnection, resolveCredentialValue } from "@/lib/integrations/credential-resolution"
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
        media: m.mediaStorageKey
          ? {
              url: `/api/whatsapp/conversations/${id}/messages/${m.id}/media`,
              mimeType: m.mediaMimeType,
              filename: m.mediaFilename,
              sizeBytes: m.mediaSizeBytes,
            }
          : null,
      })),
    })
  } catch (error) {
    return apiError(error, "Failed to load messages")
  }
}

const sendSchema = z.object({ body: z.string().trim().min(1).max(4096) })

/** Lets a team member reply to a real WhatsApp conversation from the
 * dashboard - a genuine send through the Cloud API, not a demo simulation.
 * Marking the conversation "human" reflects that a person just took over
 * from the bot, same transition the chatbot pipeline makes on escalation. */
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

    // The Cloud API only accepts free-form text within 24h of the
    // customer's last message - sending outside that window fails on
    // Meta's side with an opaque error. Catching it here, before the call,
    // gives the agent an actionable message instead of a silent failure.
    const sessionWindow = computeSessionWindow(conversation.lastInboundMessageAt)
    if (!sessionWindow.open) {
      return NextResponse.json(
        {
          error:
            "The 24-hour window for this conversation has closed. You can only send a pre-approved template message until the customer messages again.",
          sessionWindow,
        },
        { status: 409 }
      )
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

    const result = await sendWhatsAppTextMessage(phoneNumberId, accessToken, conversation.contactPhone, body.body)
    const message = await insertOutboundMessage(
      auth.ctx.workspaceId,
      id,
      body.body,
      "agent",
      result.externalMessageId ?? null,
      result.ok ? "sent" : "failed"
    )
    // Sending anything manually supersedes whatever the bot had drafted -
    // clear it so a stale suggestion never lingers in the UI.
    const now = new Date()
    await updateConversation(auth.ctx.workspaceId, id, {
      status: "human",
      lastMessageAt: now,
      pendingAiReply: null,
      ...(result.ok ? { lastOutboundMessageAt: now } : {}),
      // First-ever successful reply in this conversation - the other half
      // of the response-time sample alongside firstInboundMessageAt (set
      // when the customer's first message came in). See
      // migrations/0020_conversation_first_response.sql.
      ...(result.ok && !conversation.firstResponseAt ? { firstResponseAt: now } : {}),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.errorMessage ?? "WhatsApp send failed", message }, { status: 502 })
    }

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    return apiError(error, "Failed to send message")
  }
}
