import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { addConversationNote, listConversationNotes } from "@/lib/integrations/whatsapp/repository"
import { apiError } from "@/lib/api/errors"

/** Internal, agent-only notes on a conversation - never sent to the
 * customer, never touches the Cloud API. Separate endpoint from
 * /messages on purpose so the two can never be confused client-side. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const { id } = await ctx.params
    const notes = await listConversationNotes(auth.ctx.workspaceId, id)
    return NextResponse.json({
      notes: notes.map((n) => ({ id: n.id, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString() })),
    })
  } catch (error) {
    return apiError(error, "Failed to load notes")
  }
}

const createNoteSchema = z.object({ body: z.string().trim().min(1).max(4000) })

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin", "manager", "sales"])
    if (roleCheck) return roleCheck

    const { id } = await ctx.params
    const body = createNoteSchema.parse(await request.json())

    const note = await addConversationNote(auth.ctx.workspaceId, id, auth.ctx.userId, body.body)
    if (!note) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

    return NextResponse.json(
      { note: { id: note.id, body: note.body, authorName: note.authorName, createdAt: note.createdAt.toISOString() } },
      { status: 201 }
    )
  } catch (error) {
    return apiError(error, "Failed to add note")
  }
}
