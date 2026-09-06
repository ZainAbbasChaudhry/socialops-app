import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { apiError } from "@/lib/api/errors"
import { recordAuditEvent } from "@/lib/integrations/repository"
import {
  resolveGatewayContext,
  statusForGatewayFailure,
  gatewayFailureBody,
} from "@/lib/integrations/whatsapp/gateway-context"
import {
  sendBulkMessages,
  getBatchStatus,
  cancelBatch,
} from "@/lib/integrations/whatsapp/openwa-client"

/**
 * Bulk campaigns.
 *
 * This is the highest-consequence capability in the product: one request can
 * message thousands of people from the client's own number, and WhatsApp bans
 * numbers for exactly this when it is done carelessly. So it is off by default
 * in the catalogue, admin-only here, capped, deduplicated, and every launch is
 * written to the audit trail with who did it and how many recipients - never
 * the message body, which can contain personal data.
 *
 * Progress numbers come from the gateway alone. Nothing on this route counts a
 * message as delivered.
 */

/** A ceiling EasyLife enforces regardless of what the gateway would accept.
 * A single request that tries to message more than this is far more likely to
 * be a mistake (a pasted spreadsheet column) than an intention. */
const MAX_RECIPIENTS = 500

const startSchema = z.object({
  recipients: z.array(z.string().trim().min(5).max(32)).min(1).max(MAX_RECIPIENTS),
  text: z.string().trim().min(1).max(4096),
})

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden

    const body = startSchema.parse(await request.json())

    // The same person pasted twice is one recipient, not two messages.
    const recipients = [...new Set(body.recipients.map((r) => r.replace(/[^\d]/g, "")).filter((r) => r.length >= 5))]
    if (recipients.length === 0) {
      return NextResponse.json({ error: "No valid phone numbers in that list." }, { status: 400 })
    }

    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const started = await sendBulkMessages(resolved.ctx.config, resolved.ctx.sessionId, recipients, body.text)
    if (!started.ok) {
      return NextResponse.json(gatewayFailureBody(started), { status: statusForGatewayFailure(started) })
    }

    // Recorded only after the gateway accepted it, and without the message
    // body - the trail answers "who sent a campaign to how many", not "what
    // did it say about whom".
    await recordAuditEvent(auth.ctx.workspaceId, "openwa", "campaign_started", auth.ctx.userId, {
      recipientCount: recipients.length,
      duplicatesRemoved: body.recipients.length - recipients.length,
      batchId: started.data.batchId,
    })

    return NextResponse.json({
      ok: true,
      batchId: started.data.batchId,
      recipientCount: recipients.length,
      duplicatesRemoved: body.recipients.length - recipients.length,
    })
  } catch (error) {
    return apiError(error, "Failed to start the campaign")
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const batchId = new URL(request.url).searchParams.get("batchId")
    if (!batchId) return NextResponse.json({ error: "Which campaign?" }, { status: 400 })

    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const status = await getBatchStatus(resolved.ctx.config, resolved.ctx.sessionId, batchId)
    if (!status.ok) {
      return NextResponse.json(gatewayFailureBody(status), { status: statusForGatewayFailure(status) })
    }
    return NextResponse.json({ batch: status.data })
  } catch (error) {
    return apiError(error, "Failed to read the campaign status")
  }
}

const cancelSchema = z.object({ batchId: z.string().trim().min(1).max(128) })

export async function DELETE(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden

    const body = cancelSchema.parse(await request.json())
    const resolved = await resolveGatewayContext(auth.ctx.workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const result = await cancelBatch(resolved.ctx.config, resolved.ctx.sessionId, body.batchId)
    if (!result.ok) {
      return NextResponse.json(gatewayFailureBody(result), { status: statusForGatewayFailure(result) })
    }
    // Messages already handed to WhatsApp cannot be recalled - the UI says so
    // rather than implying a cancel undoes the campaign.
    await recordAuditEvent(auth.ctx.workspaceId, "openwa", "campaign_cancelled", auth.ctx.userId, {
      batchId: body.batchId,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, "Failed to cancel the campaign")
  }
}
