import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { resolveActiveConnection } from "@/lib/integrations/credential-resolution"
import { resolveCredentialValue } from "@/lib/integrations/service"
import { getGmailProfile, listEmailsWith, sendGmailMessage } from "@/lib/integrations/gmail/client"
import { getLead, createActivity } from "@/lib/leads/repository"
import { apiError } from "@/lib/api/errors"

/**
 * Email as part of the CRM record rather than as something that happened
 * in one person's inbox.
 *
 * GET returns the email history with a lead; POST sends one as the
 * business and logs it against that lead. Both are scoped to the
 * workspace's own connected mailbox, and both refuse rather than pretend
 * when Gmail is not connected - a message this endpoint reports as sent is
 * one Gmail confirmed.
 */

async function mailbox(workspaceId: string) {
  const { live, row } = await resolveActiveConnection(workspaceId, "gmail")
  if (!live) return { error: "Gmail isn't connected and activated for this workspace." as const }
  const { value: accessToken } = resolveCredentialValue(row, "accessToken", "gmail")
  if (!accessToken) return { error: "No Google access token on file - reconnect Gmail in Integrations." as const }
  return { accessToken }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const leadId = new URL(request.url).searchParams.get("leadId")
    if (!leadId) return NextResponse.json({ error: "Which lead?" }, { status: 400 })

    // Scoped by workspace: a lead id from another workspace resolves to
    // nothing, so this can never read another business's correspondence.
    const lead = await getLead(auth.ctx.workspaceId, leadId)
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 })
    if (!lead.email) return NextResponse.json({ messages: [], reason: "This lead has no email address on file." })

    const resolved = await mailbox(auth.ctx.workspaceId)
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })

    const profile = await getGmailProfile(resolved.accessToken)
    if (!profile.ok || !profile.emailAddress) {
      return NextResponse.json({ error: profile.error ?? "Could not read the connected mailbox." }, { status: 502 })
    }

    const result = await listEmailsWith(resolved.accessToken, lead.email, profile.emailAddress)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

    return NextResponse.json({ messages: result.messages ?? [], mailbox: profile.emailAddress })
  } catch (error) {
    return apiError(error, "Failed to load the email history")
  }
}

const sendSchema = z.object({
  leadId: z.string().uuid(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
})

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin", "manager", "sales"])
    if (roleCheck) return roleCheck

    const input = sendSchema.parse(await request.json())
    const lead = await getLead(auth.ctx.workspaceId, input.leadId)
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 })
    if (!lead.email) return NextResponse.json({ error: "This lead has no email address on file." }, { status: 400 })

    const resolved = await mailbox(auth.ctx.workspaceId)
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })

    const result = await sendGmailMessage(resolved.accessToken, {
      to: lead.email,
      subject: input.subject,
      body: input.body,
    })
    // Logged only after Gmail confirmed it, so the CRM never shows an
    // email that was never delivered to Google in the first place.
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

    await createActivity(
      auth.ctx.workspaceId,
      lead.id,
      auth.ctx.userId,
      "note-added",
      `Email sent: ${input.subject}`
    )

    return NextResponse.json({ ok: true, messageId: result.messageId })
  } catch (error) {
    return apiError(error, "Failed to send the email")
  }
}
