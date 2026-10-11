import type { LeadStage } from "@/types"
import { findLeadByWhatsAppNumber, getLead, createLead, updateLead, createActivity } from "@/lib/leads/repository"
import { bandForScore } from "@/lib/leads/scoring"
import {
  ensureWhatsAppAccount,
  ensureConversation,
  updateConversation,
  insertInboundMessageIfNew,
  insertOutboundMessage,
  setInboundMessageMedia,
  listMessages,
} from "./repository"
import { sendWhatsAppTextMessage, fetchWhatsAppMediaMeta, downloadWhatsAppMedia } from "./cloud-api"
import { validateWhatsAppMedia, storeWhatsAppMedia } from "./media"
import { runQualificationTurn, scoreQualification, type KnownQualification, type ConversationTurn } from "./gemini-qualification"
import { resolveActiveApiKey } from "@/lib/integrations/credential-resolution"
import { dispatchAutomationEvent } from "@/lib/automations/engine"

const STAGE_ORDER: LeadStage[] = ["whatsapp-started", "qualifying", "interested", "qualified", "ready-for-sales"]
const MEDIA_MESSAGE_TYPES = new Set(["image", "video", "audio", "document", "sticker"])

/** Best-effort: downloads an inbound attachment from Meta's short-lived
 * CDN URL and keeps a local copy, since that URL expires in minutes and
 * the dashboard needs to display the file indefinitely afterward. Failure
 * here never fails message processing - the text/caption and the message
 * row itself are already saved either way. */
async function downloadAndStoreInboundMedia(
  workspaceId: string,
  messageRowId: string,
  messageType: string,
  rawMetadata: Record<string, unknown>,
  accessToken: string
): Promise<void> {
  if (!MEDIA_MESSAGE_TYPES.has(messageType)) return
  const mediaObj = rawMetadata[messageType] as { id?: string; mime_type?: string; filename?: string } | undefined
  if (!mediaObj?.id) return

  try {
    const meta = await fetchWhatsAppMediaMeta(mediaObj.id, accessToken)
    if (!meta.ok || !meta.url) return
    const mimeType = meta.mimeType ?? mediaObj.mime_type ?? "application/octet-stream"
    const buffer = await downloadWhatsAppMedia(meta.url, accessToken)
    if (!buffer) return

    const validation = validateWhatsAppMedia(mimeType, buffer.byteLength)
    const extension = validation.ok ? validation.extension : "." + (mimeType.split("/")[1] ?? "bin")
    const stored = await storeWhatsAppMedia(workspaceId, buffer, extension)
    await setInboundMessageMedia(workspaceId, messageRowId, {
      storageKey: stored.storageKey,
      mimeType,
      filename: mediaObj.filename ?? null,
      sizeBytes: stored.sizeBytes,
    })
  } catch (error) {
    console.error("WhatsApp inbound media download failed:", error instanceof Error ? error.message : error)
  }
}

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
  integrationConnectionId: string | null
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string | null
  accessToken: string
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
export async function processInboundMessage(
  msg: InboundTextMessage
): Promise<{ duplicate: boolean; escalated?: boolean; suggested?: boolean }> {
  const account = await ensureWhatsAppAccount(
    msg.workspaceId,
    msg.integrationConnectionId,
    msg.phoneNumberId,
    msg.wabaId,
    msg.displayPhoneNumber
  )
  const conversation = await ensureConversation(msg.workspaceId, account.id, msg.from)
  const whatsappCtx = { toNumber: msg.from, phoneNumberId: msg.phoneNumberId, accessToken: msg.accessToken, conversationId: conversation.id }

  const inserted = await insertInboundMessageIfNew(
    msg.workspaceId,
    conversation.id,
    msg.externalMessageId,
    msg.messageType,
    msg.body,
    msg.rawMetadata
  )
  if (!inserted) return { duplicate: true }

  // Fire-and-forget from the caller's perspective but awaited here so the
  // webhook's own try/catch still logs a failure - never allowed to throw
  // out of this function, since a download failure must not re-queue
  // (and duplicate-process) an otherwise successfully recorded message.
  await downloadAndStoreInboundMedia(msg.workspaceId, inserted.id, msg.messageType, msg.rawMetadata, msg.accessToken)

  // A customer messaging again is the universal "reopen" signal for any
  // conversation an agent had marked resolved or snoozed - mirrors how
  // every helpdesk (Zendesk, Intercom, etc.) treats a new reply on a closed
  // ticket. Doesn't touch `status` (bot/human handling), only the
  // resolution workflow state.
  if (conversation.resolutionStatus === "resolved" || conversation.resolutionStatus === "snoozed") {
    await updateConversation(msg.workspaceId, conversation.id, { resolutionStatus: "open", snoozedUntil: null })
  }

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

  // Non-text messages, already-escalated/human conversations, and anything
  // the agent has explicitly switched to "Human only" are stored but don't
  // run the bot — a human is expected to take it from here.
  if (
    msg.messageType !== "text" ||
    !msg.body ||
    conversation.status === "escalated" ||
    conversation.status === "human" ||
    conversation.aiMode === "off"
  ) {
    const now = new Date()
    await updateConversation(msg.workspaceId, conversation.id, {
      lastMessageAt: now,
      lastInboundMessageAt: now,
      ...(conversation.firstInboundMessageAt ? {} : { firstInboundMessageAt: now }),
    })
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
    scoreFactors: scoreResult.factors,
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

  const now = new Date()

  // "suggest" mode: everything above (qualification, lead/CRM sync,
  // automations) already ran for real - only the actual send to the
  // customer is held back for an agent to review first.
  if (conversation.aiMode === "suggest") {
    await updateConversation(msg.workspaceId, conversation.id, {
      botState: mergedKnown as Record<string, unknown>,
      pendingAiReply: turn.reply,
      status: turn.escalate ? "escalated" : "bot",
      lastMessageAt: now,
      lastInboundMessageAt: now,
      ...(conversation.firstInboundMessageAt ? {} : { firstInboundMessageAt: now }),
    })
    return { duplicate: false, escalated: turn.escalate, suggested: true }
  }

  const sendResult = await sendWhatsAppTextMessage(msg.phoneNumberId, msg.accessToken, msg.from, turn.reply)
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
    lastMessageAt: now,
    lastInboundMessageAt: now,
    ...(conversation.firstInboundMessageAt ? {} : { firstInboundMessageAt: now }),
    ...(sendResult.ok ? { lastOutboundMessageAt: now } : {}),
    ...(sendResult.ok && !conversation.firstResponseAt ? { firstResponseAt: now } : {}),
  })

  return { duplicate: false, escalated: turn.escalate }
}
