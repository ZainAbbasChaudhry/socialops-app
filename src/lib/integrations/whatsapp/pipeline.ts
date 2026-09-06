import type { LeadStage, LeadIntentStatus } from "@/types"
import { LEAD_STAGE_ORDER } from "@/lib/lead-status"
import { findLeadByWhatsAppNumber, getLead, createLead, updateLead, createActivity } from "@/lib/leads/repository"
import { bandForScore } from "@/lib/leads/scoring"
import {
  ensureConversation,
  updateConversation,
  insertInboundMessageIfNew,
  insertOutboundMessage,
  listMessages,
} from "./repository"
import type { WhatsAppTransport } from "./transport"
import { runQualificationTurn, scoreQualification, type KnownQualification, type ConversationTurn } from "./gemini-qualification"
import { listActiveKnowledgeEntries } from "@/lib/knowledge/repository"
import { resolveLlm } from "@/lib/services/llm/resolve"
import { findAvailableSlots, describeSlot } from "@/lib/meetings/availability"
import { bookMeeting } from "@/lib/integrations/google-calendar/booking"
import { dispatchAutomationEvent } from "@/lib/automations/engine"

/** The bot's own ladder - the only stages it is allowed to move a lead
 * into. Ranking is done against the canonical LEAD_STAGE_ORDER, never
 * against this subset: an `indexOf` miss on the subset used to return -1
 * for `won`, `lost`, `human-followup`, `meeting-booked`, `call-scheduled`
 * and `called`, and the "never move backwards" guard then treated -1 as
 * "earlier than anything" and reset the lead. A won deal replying "thanks,
 * when do we start?" was silently dragged back to `interested`. */
const BOT_STAGES: LeadStage[] = ["whatsapp-started", "qualifying", "interested", "qualified", "ready-for-sales"]

/**
 * What the bot remembers about arranging a call, kept beside the
 * qualification facts rather than inside them: an ISO timestamp is not a
 * thing to show the model as "known so far", and mixing the two once meant
 * the transcript summary was half machine-readable.
 */
interface BookingState {
  /** Times put to the customer, in the order they were offered. */
  offeredSlots?: string[]
  /** The business's calendar timezone, so a slot offered on Monday still
   * reads as Monday when the customer replies from another country. */
  timezone?: string
  /** Set only once Google has actually accepted the event. */
  meetingId?: string
  bookedFor?: string
}

type BotState = KnownQualification & { booking?: BookingState }

/** Stages the bot must never touch: a human (or a closed deal) owns the
 * lead from here on. */
const BOT_HANDS_OFF_STAGES: LeadStage[] = ["won", "lost", "human-followup", "meeting-booked", "call-scheduled", "called"]

/** Statuses a human sets deliberately. bandForScore only ever returns
 * cold/warm/interested/qualified, so writing its result unconditionally
 * used to erase these - a lead marked `not-interested` was pulled back to
 * `warm` simply by messaging again, and a `spam` lead re-entered the
 * funnel. */
const HUMAN_OWNED_STATUSES: LeadIntentStatus[] = ["not-interested", "existing-customer", "support", "spam", "human-review"]

function nextStage(currentStage: LeadStage, score: number, escalate: boolean): LeadStage {
  // A stage the bot doesn't own is never changed by the bot, in either
  // direction. This is the guard that protects won/lost and human handoff.
  if (BOT_HANDS_OFF_STAGES.includes(currentStage)) return currentStage

  let target: LeadStage
  if (escalate) {
    target = "human-followup"
  } else if (score >= 71) {
    target = "qualified"
  } else if (score >= 51) {
    target = "interested"
  } else if (score >= 31) {
    target = "qualifying"
  } else {
    target = "whatsapp-started"
  }

  if (target === "human-followup") return target

  // Rank against the canonical order so an unexpected current stage can
  // never be mistaken for "before the beginning".
  const currentIndex = LEAD_STAGE_ORDER.indexOf(currentStage)
  const targetIndex = LEAD_STAGE_ORDER.indexOf(target)
  if (currentIndex === -1) return BOT_STAGES.includes(target) ? target : currentStage
  return targetIndex > currentIndex ? target : currentStage
}

export interface InboundTextMessage {
  workspaceId: string
  /** The already-resolved `whatsapp_accounts` row this delivery arrived on.
   * Each webhook route resolves its own account (the Cloud API route by
   * phone number id, the OpenWA route by session id) before calling in
   * here, so this pipeline never has to know which provider it is serving. */
  accountId: string
  /** How to reply. Cloud API or OpenWA - the pipeline cannot tell, and
   * deliberately has no way to find out. */
  transport: WhatsAppTransport
  from: string
  contactName: string | null
  externalMessageId: string
  messageType: string
  body: string | null
  rawMetadata: Record<string, unknown>
}

/** Full inbound flow: dedupe -> resolve conversation/lead -> (text only)
 * qualify via Gemini -> score -> sync CRM -> send + persist reply. Returns
 * `{ duplicate: true }` if this external message ID was already processed,
 * so the webhook route can always answer 200 without reprocessing. */
export async function processInboundMessage(msg: InboundTextMessage): Promise<{ duplicate: boolean; escalated?: boolean }> {
  const conversation = await ensureConversation(msg.workspaceId, msg.accountId, msg.from)
  // Carries no credentials: the automation engine re-resolves the transport
  // from `accountId` at send time, so nothing token-shaped travels through
  // the event context.
  const whatsappCtx = { toNumber: msg.from, accountId: msg.accountId, conversationId: conversation.id }

  const inserted = await insertInboundMessageIfNew(
    msg.workspaceId,
    conversation.id,
    msg.externalMessageId,
    msg.messageType,
    msg.body,
    msg.rawMetadata
  )
  if (!inserted) return { duplicate: true }

  // Resolve or create the CRM lead this conversation belongs to.
  let lead = conversation.leadId
    ? await getLead(msg.workspaceId, conversation.leadId)
    : await findLeadByWhatsAppNumber(msg.workspaceId, msg.from)

  if (!lead) {
    lead = await createLead({
      workspaceId: msg.workspaceId,
      actorUserId: null,
      name: msg.contactName ?? "WhatsApp Lead",
      whatsappNumber: msg.from,
      sourcePlatform: "whatsapp",
      stage: "whatsapp-started",
      status: "cold",
    })
    await createActivity(msg.workspaceId, lead.id, null, "whatsapp-started", "Started a WhatsApp conversation")
    await dispatchAutomationEvent("whatsapp-started", {
      workspaceId: msg.workspaceId,
      leadId: lead.id,
      whatsapp: whatsappCtx,
      dedupeKey: msg.externalMessageId,
    })
  }
  if (!conversation.leadId) {
    await updateConversation(msg.workspaceId, conversation.id, { leadId: lead.id })
  }
  const leadId = lead.id

  if (msg.body) {
    const snippet = msg.body.length > 140 ? `${msg.body.slice(0, 140)}…` : msg.body
    await createActivity(msg.workspaceId, leadId, null, "whatsapp-message", `Customer: ${snippet}`)
    await dispatchAutomationEvent("new-dm", {
      workspaceId: msg.workspaceId,
      leadId,
      messageBody: msg.body,
      whatsapp: whatsappCtx,
      dedupeKey: msg.externalMessageId,
    })
  }

  // Non-text messages and already-escalated conversations are stored but
  // don't run the bot — a human is expected to take it from here.
  if (msg.messageType !== "text" || !msg.body || conversation.status === "escalated" || conversation.status === "human") {
    await updateConversation(msg.workspaceId, conversation.id, { lastMessageAt: new Date() })
    return { duplicate: false }
  }

  const state = (conversation.botState ?? {}) as BotState
  const known = state as KnownQualification
  const booking = state.booking ?? {}
  const recentRows = await listMessages(msg.workspaceId, conversation.id, 12)
  const recentTurns: ConversationTurn[] = recentRows
    .filter((r) => r.body)
    .map((r) => ({ sender: r.direction === "inbound" ? "customer" : "bot", body: r.body as string }))

  // The customer-facing turn: whichever model this workspace has activated,
  // preferring a capable hosted one. This is the "complex" tier - it writes
  // in the client's own name to their customer. Alongside it, the client's
  // own answers, loaded per turn so an edit in the Knowledge Base screen
  // changes what the bot says on the very next message rather than after a
  // restart.
  const [llm, knowledge] = await Promise.all([
    resolveLlm(msg.workspaceId, "complex"),
    listActiveKnowledgeEntries(msg.workspaceId),
  ])
  // Times already put to this customer. Anything they accept has to come
  // from here, so the bot can never promise an hour the calendar has not
  // actually offered.
  const offeredIso = booking.meetingId ? [] : (booking.offeredSlots ?? [])
  const offeredLabels = offeredIso.map((iso) => describeSlot(iso, booking.timezone ?? "UTC"))

  const turn = await runQualificationTurn(known, recentTurns, msg.body, llm, knowledge, offeredLabels)
  const mergedKnown: KnownQualification = { ...known, ...turn.extracted }

  // ---- Meetings ---------------------------------------------------------
  //
  // Two steps, never merged: offer real times, then book the one accepted.
  // Both are driven by the calendar rather than by the model - the model
  // only ever picks a number out of a list this code produced, and the
  // confirmation sentence is written here, from what Google actually
  // returned, not by the model. That is what keeps "your meeting is booked"
  // from ever being a sentence nobody can back up.
  let replyText = turn.reply
  let nextBooking: BookingState = booking
  let bookingEscalation: string | null = null

  if (turn.chosenSlot && offeredIso[turn.chosenSlot - 1]) {
    const startIso = offeredIso[turn.chosenSlot - 1]
    const endIso = new Date(new Date(startIso).getTime() + 30 * 60_000).toISOString()
    const result = await bookMeeting({
      workspaceId: msg.workspaceId,
      leadId,
      title: `Call with ${mergedKnown.name ?? lead.name ?? "WhatsApp lead"}`,
      description: mergedKnown.requirement ?? mergedKnown.serviceInterested ?? "Booked from a WhatsApp conversation.",
      startTime: startIso,
      endTime: endIso,
      // Only a real email gets an invite. There is no point inventing one,
      // and Google rejects a malformed address for the whole event.
      attendeeEmails: lead.email ? [lead.email] : [],
      createdByUserId: null,
    })

    if (result.status === "booked") {
      const when = describeSlot(startIso, booking.timezone ?? "UTC")
      const meetLink = result.meeting?.meetLink
      replyText = `${replyText}\n\nBooked — ${when}.${meetLink ? ` Here is the link: ${meetLink}` : ""}`
      nextBooking = { meetingId: result.meeting?.id, bookedFor: startIso, timezone: booking.timezone }
      await createActivity(msg.workspaceId, leadId, null, "meeting-booked", `Meeting booked from WhatsApp for ${when}`)
    } else {
      // The calendar refused or could not be reached. The customer is told
      // the truth and a human is brought in - the one thing that must never
      // happen here is telling them it is booked.
      // Replaced, not appended. The model was told a time was being booked
      // and may well have written "Booked!" already - appending a correction
      // to a false claim leaves the false claim in the message.
      replyText = "I could not confirm that time just now — someone from our team will confirm with you shortly."
      bookingEscalation = result.errorMessage ?? "Calendar booking failed."
      nextBooking = { ...booking, offeredSlots: [] }
      await createActivity(
        msg.workspaceId,
        leadId,
        null,
        "qualification-updated",
        `Could not book the requested meeting: ${bookingEscalation}`
      )
    }
  } else if (turn.claimedSlot && !booking.meetingId) {
    // The model picked a slot we cannot honour - out of range, or none were
    // ever offered. Nothing is booked, and since its reply was written in
    // the belief that something was, the reply itself cannot be trusted and
    // is replaced rather than sent.
    replyText = "Let me confirm a time with the team and come straight back to you."
    bookingEscalation = "The assistant accepted a meeting time that was never offered."
    nextBooking = { ...booking, offeredSlots: [] }
  } else if (mergedKnown.wantsCall === true && !booking.meetingId && offeredIso.length === 0) {
    const availability = await findAvailableSlots(msg.workspaceId)
    if (availability.ok && availability.slots.length > 0) {
      const lines = availability.slots.map((iso, i) => `${i + 1}. ${describeSlot(iso, availability.timezone)}`)
      replyText = `${replyText}\n\nHere are the next free times — reply with the number that suits you:\n${lines.join("\n")}`
      nextBooking = { offeredSlots: availability.slots, timezone: availability.timezone }
    } else {
      // No calendar, or nothing free. The customer still gets a straight
      // answer, and a human picks it up rather than the thread going quiet.
      replyText = `${replyText}\n\nSomeone from our team will call you to fix a time.`
      bookingEscalation = availability.reason ?? "No calendar availability."
    }
  }

  const turnCount = recentRows.length + 1
  const scoreResult = scoreQualification(mergedKnown, turnCount, turn.escalate)
  const band = bandForScore(scoreResult.score)
  const currentStage: LeadStage = (lead.stage as LeadStage) ?? "whatsapp-started"
  // A confirmed booking is a fact about the lead, not a score: it moves the
  // stage directly, and "meeting-booked" is one of the stages the bot then
  // stops touching, so the following turns cannot walk it back.
  const bookedNow = nextBooking.meetingId !== undefined && booking.meetingId === undefined
  const targetStage: LeadStage = bookedNow ? "meeting-booked" : nextStage(currentStage, scoreResult.score, turn.escalate)

  await updateLead(msg.workspaceId, leadId, null, {
    name: mergedKnown.name,
    businessType: mergedKnown.businessType,
    location: mergedKnown.location,
    serviceInterested: mergedKnown.serviceInterested,
    requirement: mergedKnown.requirement,
    painPoint: mergedKnown.painPoint,
    budget: mergedKnown.budget,
    timeline: mergedKnown.timeline,
    leadScore: scoreResult.score,
    stage: targetStage,
    // Leave a human-set status alone; the score still updates underneath it.
    status: HUMAN_OWNED_STATUSES.includes(lead.status as LeadIntentStatus) ? undefined : band.status,
    callPermission: scoreResult.callPermission,
  })

  if (bookingEscalation) {
    await createActivity(msg.workspaceId, leadId, null, "qualification-updated", `Handing to a human: ${bookingEscalation}`)
  }

  if (turn.escalate && turn.escalationReason) {
    await createActivity(msg.workspaceId, leadId, null, "qualification-updated", `Escalated to human: ${turn.escalationReason}`)
  }

  // previousScore turns "lead score above N" into a threshold CROSSING in
  // the engine, instead of a level that re-matched on every message an
  // already-qualified lead sent - which queued a fresh real phone call each
  // time. See triggerValueMatches.
  await dispatchAutomationEvent("lead-score-above", {
    workspaceId: msg.workspaceId,
    leadId,
    score: scoreResult.score,
    previousScore: lead.score ?? 0,
    whatsapp: whatsappCtx,
    dedupeKey: msg.externalMessageId,
  })

  if (targetStage === "qualified" && currentStage !== "qualified") {
    await dispatchAutomationEvent("whatsapp-lead-qualified", {
      workspaceId: msg.workspaceId,
      leadId,
      whatsapp: whatsappCtx,
      dedupeKey: msg.externalMessageId,
    })
  }

  if (scoreResult.callPermission === "yes" && lead.callPermission !== "yes") {
    await dispatchAutomationEvent("call-permission-received", {
      workspaceId: msg.workspaceId,
      leadId,
      whatsapp: whatsappCtx,
      dedupeKey: msg.externalMessageId,
    })
  }

  const sendResult = await msg.transport.sendText(msg.from, replyText)
  await insertOutboundMessage(
    msg.workspaceId,
    conversation.id,
    replyText,
    "bot",
    sendResult.externalMessageId ?? null,
    sendResult.ok ? "sent" : "failed"
  )

  await updateConversation(msg.workspaceId, conversation.id, {
    botState: { ...mergedKnown, booking: nextBooking } as Record<string, unknown>,
    status: turn.escalate || bookingEscalation ? "escalated" : "bot",
    lastMessageAt: new Date(),
  })

  return { duplicate: false, escalated: turn.escalate }
}
