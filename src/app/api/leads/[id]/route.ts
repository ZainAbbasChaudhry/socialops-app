import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { getLead, updateLead, deleteLead } from "@/lib/leads/repository"
import { apiError } from "@/lib/api/errors"

const updateLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    whatsappNumber: z.string().trim().max(50).nullable(),
    email: z.string().email().nullable(),
    company: z.string().trim().max(200).nullable(),
    city: z.string().trim().max(200).nullable(),
    businessType: z.string().trim().max(200).nullable(),
    location: z.string().trim().max(200).nullable(),
    serviceInterested: z.string().trim().max(200).nullable(),
    requirement: z.string().trim().max(2000).nullable(),
    painPoint: z.string().trim().max(2000).nullable(),
    budget: z.string().trim().max(100).nullable(),
    timeline: z.string().trim().max(100).nullable(),
    leadScore: z.number().int().min(0).max(100),
    stage: z.string().trim().max(50),
    status: z.string().trim().max(50),
    callPermission: z.enum(["yes", "no", "unknown"]),
    callStatus: z.string().trim().max(50).nullable(),
    meetingStatus: z.string().trim().max(50).nullable(),
    assignedToUserId: z.string().uuid().nullable(),
    priority: z.enum(["low", "medium", "high"]).nullable(),
    nextFollowUpAt: z.string().datetime().nullable(),
    notes: z.string().trim().max(5000),
    tags: z.array(z.string().trim().max(50)).max(20),
  })
  .partial()

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const { id } = await ctx.params
    const lead = await getLead(auth.ctx.workspaceId, id)
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 })

    return NextResponse.json({ lead })
  } catch (error) {
    return apiError(error, "Failed to load lead")
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const { id } = await ctx.params
    const patch = updateLeadSchema.parse(await request.json())

    const lead = await updateLead(auth.ctx.workspaceId, id, auth.ctx.userId, patch)
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 })

    return NextResponse.json({ lead })
  } catch (error) {
    return apiError(error, "Failed to update lead")
  }
}

/** Permanently deletes a lead - owner/admin only, same bar as removing a
 * team member, since there's no undo. Linked WhatsApp conversations, calls,
 * comments and meetings are kept but detached (see deleteLead). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin"])
    if (roleCheck) return roleCheck

    const { id } = await ctx.params
    const deleted = await deleteLead(auth.ctx.workspaceId, id)
    if (!deleted) return NextResponse.json({ error: "Lead not found" }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, "Failed to delete lead")
  }
}
