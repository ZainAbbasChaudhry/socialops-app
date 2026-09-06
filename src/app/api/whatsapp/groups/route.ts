import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { apiError } from "@/lib/api/errors"
import {
  resolveGatewayContext,
  statusForGatewayFailure,
  gatewayFailureBody,
} from "@/lib/integrations/whatsapp/gateway-context"
import {
  listGroups,
  createGroup,
  getGroupInviteCode,
  leaveGroup,
} from "@/lib/integrations/whatsapp/openwa-client"
import { getWorkspaceFeatures, hasFeature } from "@/lib/integrations/whatsapp/feature-access"

/** WhatsApp groups the connected number belongs to. */

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    const { config, sessionId } = resolved.ctx

    // Invite links are fetched one group at a time, on demand - a link is a
    // standing invitation to a group, so it is never included in the list
    // where it would be logged and screenshotted by accident.
    const inviteFor = new URL(request.url).searchParams.get("invite")
    if (inviteFor) {
      const invite = await getGroupInviteCode(config, sessionId, inviteFor)
      if (!invite.ok) {
        return NextResponse.json(gatewayFailureBody(invite), { status: statusForGatewayFailure(invite) })
      }
      return NextResponse.json({ groupId: inviteFor, inviteUrl: invite.data.inviteUrl })
    }

    const groups = await listGroups(config, sessionId)
    if (!groups.ok) {
      return NextResponse.json(gatewayFailureBody(groups), { status: statusForGatewayFailure(groups) })
    }

    const features = await getWorkspaceFeatures(auth.ctx.workspaceId)
    return NextResponse.json({
      groups: groups.data,
      can: {
        create: hasFeature(features, "group.create"),
        invite: hasFeature(features, "group.invite-links"),
        leave: hasFeature(features, "group.leave"),
      },
    })
  } catch (error) {
    return apiError(error, "Failed to load WhatsApp groups")
  }
}

const createSchema = z.object({
  subject: z.string().trim().min(1).max(100),
  participants: z.array(z.string().trim().min(5).max(32)).min(1).max(256),
})

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden

    const body = createSchema.parse(await request.json())
    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const created = await createGroup(resolved.ctx.config, resolved.ctx.sessionId, body.subject, body.participants)
    if (!created.ok) {
      return NextResponse.json(gatewayFailureBody(created), { status: statusForGatewayFailure(created) })
    }
    // The gateway created it; whether WhatsApp returned an id is reported as
    // it is rather than assumed.
    return NextResponse.json({ ok: true, groupId: created.data.groupId })
  } catch (error) {
    return apiError(error, "Failed to create the group")
  }
}

const leaveSchema = z.object({ groupId: z.string().trim().min(1).max(128) })

/** Leaving is destructive - the number loses the group and its history - so it
 * is admin-only and gated by its own capability. */
export async function DELETE(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden

    const body = leaveSchema.parse(await request.json())
    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const result = await leaveGroup(resolved.ctx.config, resolved.ctx.sessionId, body.groupId)
    if (!result.ok) {
      return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, "Failed to leave the group")
  }
}
