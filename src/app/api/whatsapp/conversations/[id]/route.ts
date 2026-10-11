import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import {
  getConversationById,
  setConversationResolutionStatus,
  setConversationAiMode,
  updateConversation,
} from "@/lib/integrations/whatsapp/repository"
import { apiError } from "@/lib/api/errors"

const patchSchema = z
  .object({
    resolutionStatus: z.enum(["open", "pending", "resolved", "snoozed"]).optional(),
    // Required when resolutionStatus is "snoozed", ignored otherwise - the
    // schema can't express that conditional cleanly, so it's checked below.
    snoozedUntil: z.string().datetime().optional(),
    // Standing AI behavior for this conversation - independent of
    // resolutionStatus above. See migrations/0015_conversation_ai_mode.sql.
    aiMode: z.enum(["auto", "suggest", "off"]).optional(),
    // Lets the agent discard a drafted-but-unsent suggestion without
    // switching modes or sending anything.
    discardPendingAiReply: z.boolean().optional(),
  })
  .refine((b) => b.resolutionStatus !== undefined || b.aiMode !== undefined || b.discardPendingAiReply, {
    message: "Nothing to update.",
  })

/** Updates a conversation's resolution workflow state (Open/Pending/
 * Resolved/Snoozed) and/or its AI reply mode (Auto/Suggest/Off) - two
 * independent axes, both handled here since the UI edits them from the same
 * conversation header. Never touches the bot/human `status` field. See
 * migrations/0012_conversation_resolution_status.sql and
 * migrations/0015_conversation_ai_mode.sql. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin", "manager", "sales"])
    if (roleCheck) return roleCheck

    const { id } = await ctx.params
    const conversation = await getConversationById(auth.ctx.workspaceId, id)
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

    const body = patchSchema.parse(await request.json())
    if (body.resolutionStatus === "snoozed" && !body.snoozedUntil) {
      return NextResponse.json({ error: "snoozedUntil is required when snoozing a conversation." }, { status: 400 })
    }

    let updated = conversation
    if (body.resolutionStatus) {
      const result = await setConversationResolutionStatus(
        auth.ctx.workspaceId,
        id,
        body.resolutionStatus,
        body.snoozedUntil ? new Date(body.snoozedUntil) : null
      )
      if (!result) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
      updated = result
    }
    if (body.aiMode) {
      const result = await setConversationAiMode(auth.ctx.workspaceId, id, body.aiMode)
      if (!result) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
      updated = result
    } else if (body.discardPendingAiReply) {
      const result = await updateConversation(auth.ctx.workspaceId, id, { pendingAiReply: null })
      if (!result) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
      updated = result
    }

    return NextResponse.json({
      conversation: {
        id: updated.id,
        resolutionStatus: updated.resolutionStatus,
        snoozedUntil: updated.snoozedUntil ? updated.snoozedUntil.toISOString() : null,
        aiMode: updated.aiMode,
        pendingAiReply: updated.pendingAiReply,
      },
    })
  } catch (error) {
    return apiError(error, "Failed to update conversation")
  }
}
