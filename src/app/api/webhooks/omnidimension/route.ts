import { NextResponse } from "next/server"
import { recordWebhookEvent, markWebhookEventProcessed } from "@/lib/integrations/webhook-events"
import { applyCallWebhookResult } from "@/lib/platform/calls"
import { createActivity } from "@/lib/leads/repository"
import { createNotification } from "@/lib/platform/notifications"
import { dispatchAutomationEvent } from "@/lib/automations/engine"
import type { CallStatus, CallSummary, CallTranscriptLine } from "@/types"

/**
 * OmniDimension Post-Call webhook - one shared URL for every workspace's
 * agent, same multi-tenancy pattern as the WhatsApp webhook: the incoming
 * payload identifies which of OUR calls it belongs to (via provider_call_id,
 * unique per provider), and the workspace is resolved from there, never
 * trusted directly from the request.
 *
 * Payload shape per https://docs.omnidim.io/docs/integrations/zapier-make-n8n:
 * { call_id, bot_id, bot_name, phone_number, call_date, user_email,
 *   call_report: { summary, sentiment, extracted_variables, full_conversation, interactions } }
 *
 * Signature verification: OmniDimension's documented Post-Call webhook
 * delivery does not include a signing secret or HMAC header (unlike Meta's
 * WhatsApp webhooks) - this is a real limitation of the provider, not a gap
 * in this implementation. The mitigation available without one: the
 * provider_call_id an attacker would need to guess is an opaque integer
 * assigned by OmniDimension only after a real dispatch, and a webhook for a
 * call_id with no matching row (never dispatched, or already resolved) is
 * rejected outright rather than silently accepted.
 */

interface OmniDimensionInteraction {
  sequence?: number
  user_query?: string
  bot_response?: string
  time?: string
}

interface OmniDimensionWebhookBody {
  call_id?: number | string
  bot_id?: number | string
  call_report?: {
    summary?: string
    sentiment?: string
    extracted_variables?: Record<string, unknown>
    interactions?: OmniDimensionInteraction[]
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  let parsed: OmniDimensionWebhookBody
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const providerCallId = parsed.call_id !== undefined ? String(parsed.call_id) : null
  if (!providerCallId) {
    return NextResponse.json({ error: "Missing call_id" }, { status: 400 })
  }

  const report = parsed.call_report ?? {}
  const transcript: CallTranscriptLine[] = (report.interactions ?? []).flatMap((line, index) => {
    const lines: CallTranscriptLine[] = []
    if (line.user_query) {
      lines.push({ id: `omnidim_${providerCallId}_${index}_lead`, speaker: "lead", text: line.user_query, timestamp: line.time ?? new Date().toISOString() })
    }
    if (line.bot_response) {
      lines.push({ id: `omnidim_${providerCallId}_${index}_agent`, speaker: "agent", text: line.bot_response, timestamp: line.time ?? new Date().toISOString() })
    }
    return lines
  })

  // OmniDimension's summary is a single free-text paragraph, not our
  // structured CallSummary shape. recommendedNextAction is what the Call
  // Agent recent-calls list actually renders, so the raw summary lands
  // there rather than in a field nothing displays.
  const summary: CallSummary | undefined = report.summary ? { recommendedNextAction: report.summary } : undefined

  // OmniDimension's Post-Call delivery only fires once a call has actually
  // concluded, and the documented payload has no separate no-answer/busy
  // outcome field - every delivered webhook is treated as completed.
  const result = await applyCallWebhookResult({
    provider: "omnidimension",
    providerCallId,
    status: "completed" as CallStatus,
    transcript: transcript.length > 0 ? transcript : undefined,
    summary,
    sentiment: report.sentiment,
    extractedVariables: report.extracted_variables,
  })

  if (!result) {
    // No matching call row - either a replayed webhook for a call we've
    // already processed and since removed, or a call_id we never
    // dispatched. Either way, never trust it further; 200 so the provider
    // doesn't treat this as a delivery failure and keep retrying forever.
    return NextResponse.json({ ok: true, matched: false })
  }

  const event = await recordWebhookEvent({
    provider: "omnidimension",
    workspaceId: result.workspaceId,
    externalEventId: providerCallId,
    eventType: "call_completed",
    payloadSummary: { callId: result.id, sentiment: report.sentiment },
  })

  // A null event means this call_id was already delivered and processed.
  // Returning here is the whole point of the dedupe: applyCallWebhookResult
  // above is an idempotent overwrite, but the side effects below are NOT -
  // they append. Previously only markWebhookEventProcessed was guarded, so
  // every provider retry (and this endpoint carries no signature, so anyone
  // can retry it) appended another "call completed" activity to the lead and
  // another notification to the workspace. Ten redeliveries meant ten of
  // each for one call. Same shape the WhatsApp webhook already uses.
  if (!event) {
    return NextResponse.json({ ok: true, duplicate: true })
  }
  await markWebhookEventProcessed(event.id)

  if (result.leadId) {
    await createActivity(result.workspaceId, result.leadId, null, "call-completed", report.summary ?? "Call completed.")
  }
  await createNotification({
    workspaceId: result.workspaceId,
    type: "call-completed",
    title: "Call completed",
    description: report.summary ?? "An OmniDimension call has finished - review the transcript and summary.",
  })

  await dispatchAutomationEvent("call-completed", {
    workspaceId: result.workspaceId,
    leadId: result.leadId ?? undefined,
    sentiment: report.sentiment,
    dedupeKey: providerCallId,
  })

  return NextResponse.json({ ok: true, matched: true })
}
