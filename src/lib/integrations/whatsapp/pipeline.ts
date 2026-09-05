import type { LeadStage } from "@/types"
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
import { resolveActiveApiKey } from "@/lib/integrations/credential-resolution"
import { dispatchAutomationEvent } from "@/lib/automations/engine"

const STAGE_ORDER: LeadStage[] = ["whatsapp-started", "qualifying", "interested", "qualified", "ready-for-sales"]

function nextStage(currentStage: LeadStage, score: number, escalate: boolean): LeadStage {
  let target: LeadStage
  if (escalate) {
    target = score >= 51 ? "ready-for-sales" : "human-followup"
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
  const currentIndex = STAGE_ORDER.indexOf(currentStage)
  const targetIndex = STAGE_ORDER.indexOf(target)
  if (currentIndex === -1 || targetIndex > currentIndex) return target
  return currentStage
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

  const known = (conversation.botState ?? {}) as KnownQualification
  const recentRows = await listMessages(msg.workspaceId, conversation.id, 12)
  const recentTurns: ConversationTurn[] = recentRows
    .filter((r) => r.body)
    .map((r) => ({ sender: r.direction === "inbound" ? "customer" : "bot", body: r.body as string }))

  const { value: geminiApiKey } = await resolveActiveApiKey(msg.workspaceId, "gemini")
  const turn = await runQualificationTurn(known, recentTurns, msg.body, geminiApiKey)
  const mergedKnown: KnownQualification = { ...known, ...turn.extracted }

  const turnCount = recentRows.length + 1
  const scoreResult = scoreQualification(mergedKnown, turnCount, turn.escalate)
  const band = bandForScore(scoreResult.score)
  const currentStage: LeadStage = (lead.stage as LeadStage) ?? "whatsapp-started"
  const targetStage = nextStage(currentStage, scoreResult.score, turn.escalate)

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
    status: band.status,
    callPermission: scoreResult.callPermission,
  })

  if (turn.escalate && turn.escalationReason) {
    await createActivity(msg.workspaceId, leadId, null, "qualification-updated", `Escalated to human: ${turn.escalationReason}`)
  }

  await dispatchAutomationEvent("lead-score-above", {
    workspaceId: msg.workspaceId,
    leadId,
    score: scoreResult.score,
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

  const sendResult = await msg.transport.sendText(msg.from, turn.reply)
  await insertOutboundMessage(
    msg.workspaceId,
    conversation.id,
    turn.reply,
    "bot",
    sendResult.externalMessageId ?? null,
    sendResult.ok ? "sent" : "failed"
  )

  await updateConversation(msg.workspaceId, conversation.id, {
    botState: mergedKnown as Record<string, unknown>,
    status: turn.escalate ? "escalated" : "bot",
    lastMessageAt: new Date(),
  })

  return { duplicate: false, escalated: turn.escalate }
}
