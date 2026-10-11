import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { listQuickReplies, createQuickReply } from "@/lib/integrations/whatsapp/repository"
import { apiError } from "@/lib/api/errors"

/** Saved WhatsApp reply templates ("canned responses"), shared by the whole
 * workspace. Not conversation-scoped - these are picked from a single list
 * in the reply box of whichever conversation is open. */
export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const quickReplies = await listQuickReplies(auth.ctx.workspaceId)
    return NextResponse.json({
      quickReplies: quickReplies.map((q) => ({
        id: q.id,
        shortcut: q.shortcut,
        title: q.title,
        body: q.body,
      })),
    })
  } catch (error) {
    return apiError(error, "Failed to load quick replies")
  }
}

const createSchema = z.object({
  shortcut: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/i, "Use only letters, numbers, and hyphens."),
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(4096),
})

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin", "manager", "sales"])
    if (roleCheck) return roleCheck

    const body = createSchema.parse(await request.json())
    // Stored and typed with the shortcut as-is, but always matched
    // case-insensitively against what the agent types in the reply box.
    const created = await createQuickReply(auth.ctx.workspaceId, auth.ctx.userId, body.shortcut, body.title, body.body)
    if (!created) {
      return NextResponse.json({ error: `A quick reply with the shortcut "${body.shortcut}" already exists.` }, { status: 409 })
    }

    return NextResponse.json(
      { quickReply: { id: created.id, shortcut: created.shortcut, title: created.title, body: created.body } },
      { status: 201 }
    )
  } catch (error) {
    return apiError(error, "Failed to create quick reply")
  }
}
