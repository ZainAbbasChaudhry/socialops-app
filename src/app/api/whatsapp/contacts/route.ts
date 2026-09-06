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
  listContacts,
  listBlockedContacts,
  setContactBlocked,
  checkNumberOnWhatsApp,
} from "@/lib/integrations/whatsapp/openwa-client"
import { getWorkspaceFeatures, hasFeature } from "@/lib/integrations/whatsapp/feature-access"

/**
 * The workspace's WhatsApp address book.
 *
 * Reads are workspace-scoped through `resolveGatewayContext`; the client never
 * names a session. Which parts answer at all is decided by the workspace's
 * entitlements, so a plan without "Contact directory" gets a 403 from the gate
 * rather than an empty list that looks like the phone has no contacts.
 */

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const { workspaceId } = auth.ctx

    const resolved = await resolveGatewayContext(workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    const { config, sessionId } = resolved.ctx

    // A single number check is a different capability from reading the whole
    // directory - campaign hygiene without handing over the address book.
    const number = new URL(request.url).searchParams.get("check")
    if (number) {
      const check = await checkNumberOnWhatsApp(config, sessionId, number)
      if (!check.ok) {
        return NextResponse.json(gatewayFailureBody(check), { status: statusForGatewayFailure(check) })
      }
      return NextResponse.json({ number, exists: check.data.exists })
    }

    const features = await getWorkspaceFeatures(workspaceId)
    const contacts = await listContacts(config, sessionId)
    if (!contacts.ok) {
      return NextResponse.json(gatewayFailureBody(contacts), { status: statusForGatewayFailure(contacts) })
    }

    // The blocked list is its own capability. When it isn't enabled the
    // contacts still load - the screen simply doesn't offer blocking.
    let blocked: string[] = []
    if (hasFeature(features, "contact.block")) {
      const blockedResult = await listBlockedContacts(config, sessionId)
      if (blockedResult.ok) blocked = blockedResult.data.map((c) => c.id)
    }

    const blockedSet = new Set(blocked)
    return NextResponse.json({
      contacts: contacts.data.map((c) => ({ ...c, isBlocked: c.isBlocked || blockedSet.has(c.id) })),
      can: {
        block: hasFeature(features, "contact.block"),
        check: hasFeature(features, "contact.check-number"),
      },
    })
  } catch (error) {
    return apiError(error, "Failed to load WhatsApp contacts")
  }
}

const patchSchema = z.object({
  contactId: z.string().trim().min(1).max(128),
  blocked: z.boolean(),
})

/** Block or unblock. Restricted to workspace administrators: blocking a number
 * silently stops every future message from a lead. */
export async function PATCH(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden

    const body = patchSchema.parse(await request.json())
    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const result = await setContactBlocked(resolved.ctx.config, resolved.ctx.sessionId, body.contactId, body.blocked)
    if (!result.ok) {
      return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
    }
    return NextResponse.json({ ok: true, contactId: body.contactId, blocked: body.blocked })
  } catch (error) {
    return apiError(error, "Failed to update the contact")
  }
}
