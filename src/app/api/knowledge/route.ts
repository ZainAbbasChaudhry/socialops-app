import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { apiError } from "@/lib/api/errors"
import {
  KNOWLEDGE_KINDS,
  deleteKnowledgeEntry,
  listKnowledgeEntries,
  saveKnowledgeEntry,
} from "@/lib/knowledge/repository"

/**
 * The company's own answers - what the WhatsApp bot quotes when a customer
 * asks what something costs.
 *
 * READ is open to any member: the team should be able to see what the bot is
 * telling their customers. WRITE is owner/admin only, because an entry here
 * is a price the business is committing to in public.
 */

export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const entries = await listKnowledgeEntries(auth.ctx.workspaceId)
    return NextResponse.json({
      entries,
      kinds: KNOWLEDGE_KINDS,
      canEdit: auth.ctx.role === "owner" || auth.ctx.role === "admin",
    })
  } catch (error) {
    return apiError(error, "Failed to load the knowledge base")
  }
}

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(KNOWLEDGE_KINDS),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  price: z.string().trim().max(120).optional().nullable(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
})

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin"])
    if (roleCheck) return roleCheck

    const input = saveSchema.parse(await request.json())
    const entry = await saveKnowledgeEntry(auth.ctx.workspaceId, auth.ctx.userId, input)
    if (!entry) {
      // Either the title/body were empty after trimming, or the id belonged
      // to another workspace - both answer the same way rather than letting
      // a caller tell one from the other.
      return NextResponse.json({ error: "That entry could not be saved." }, { status: 400 })
    }
    return NextResponse.json({ entry })
  } catch (error) {
    return apiError(error, "Failed to save the entry")
  }
}

const deleteSchema = z.object({ id: z.string().uuid() })

export async function DELETE(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin"])
    if (roleCheck) return roleCheck

    const { id } = deleteSchema.parse(await request.json())
    const removed = await deleteKnowledgeEntry(auth.ctx.workspaceId, id)
    if (!removed) return NextResponse.json({ error: "That entry no longer exists." }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, "Failed to delete the entry")
  }
}
