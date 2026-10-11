import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/guard"
import { listConversationsForAnalytics } from "@/lib/integrations/whatsapp/repository"
import { computeWhatsAppAnalytics } from "@/lib/integrations/whatsapp/analytics"
import { listWorkspaceMembers } from "@/lib/platform/team"
import { apiError } from "@/lib/api/errors"

/** Aggregates for the WhatsApp dashboard's Reports tab: response time,
 * resolution counts, and a per-agent breakdown. Workspace-scoped via the
 * session, same as every other WhatsApp read endpoint. */
export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const [conversations, members] = await Promise.all([
      listConversationsForAnalytics(auth.ctx.workspaceId),
      listWorkspaceMembers(auth.ctx.workspaceId),
    ])

    const analytics = computeWhatsAppAnalytics(
      conversations,
      members.map((m) => ({ userId: m.userId, name: m.name }))
    )

    return NextResponse.json(analytics)
  } catch (error) {
    return apiError(error, "Failed to load WhatsApp analytics")
  }
}
