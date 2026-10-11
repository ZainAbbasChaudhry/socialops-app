import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { updateQuickReply, deleteQuickReply } from "@/lib/integrations/whatsapp/repository"
import { apiError } from "@/lib/api/errors"

const patchSchema = z
  .object({
    shortcut: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9-]+$/i, "Use only letters, numbers, and hyphens."),
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(4096),
  })
  .partial()

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin", "manager", "sales"])
    if (roleCheck) return roleCheck

    const { id } = await ctx.params
    const patch = patchSchema.parse(await request.json())
    const updated = await updateQuickReply(auth.ctx.workspaceId, id, patch)
    if (!updated) return NextResponse.json({ error: "Quick reply not found" }, { status: 404 })

    return NextResponse.json({
      quickReply: { id: updated.id, shortcut: updated.shortcut, title: updated.title, body: updated.body },
    })
  } catch (error) {
    return apiError(error, "Failed to update quick reply")
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin", "manager", "sales"])
    if (roleCheck) return roleCheck

    const { id } = await ctx.params
    const deleted = await deleteQuickReply(auth.ctx.workspaceId, id)
    if (!deleted) return NextResponse.json({ error: "Quick reply not found" }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, "Failed to delete quick reply")
  }
}
