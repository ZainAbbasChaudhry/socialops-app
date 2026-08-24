const { createQualificationState, extractAndMerge, scoreLead } = require("./lead-scoring")

const MAX_STORED_MESSAGES = 20

/**
 * In-memory only, per the "no production database damage" instruction for
 * this rushed demo - keyed by WhatsApp chat id, so conversations never mix
 * between contacts. Lost on restart; that's an accepted tradeoff for a
 * 3-hour demo tool, not a regression of anything that has persistence
 * today.
 */
const conversations = new Map()

function getOrCreate(chatId) {
  let convo = conversations.get(chatId)
  if (!convo) {
    convo = {
      chatId,
      contactName: null,
      history: [], // [{role: "user"|"model", text, at}]
      qualification: createQualificationState(),
      lastInboundAt: null,
      lastInboundText: null,
      lastReplyAt: null,
      lastReplyText: null,
    }
    conversations.set(chatId, convo)
  }
  return convo
}

/** Records the inbound message, updates qualification state from it, and
 * returns the bounded history to send to the AI (before the reply is
 * appended). */
function recordInbound(chatId, text, contactName) {
  const convo = getOrCreate(chatId)
  if (contactName && !convo.contactName) convo.contactName = contactName
  convo.qualification = extractAndMerge(convo.qualification, text)
  convo.history.push({ role: "user", text, at: new Date().toISOString() })
  convo.lastInboundAt = new Date().toISOString()
  convo.lastInboundText = text
  if (convo.history.length > MAX_STORED_MESSAGES) convo.history = convo.history.slice(-MAX_STORED_MESSAGES)
  return convo
}

function recordReply(chatId, text) {
  const convo = getOrCreate(chatId)
  convo.history.push({ role: "model", text, at: new Date().toISOString() })
  convo.lastReplyAt = new Date().toISOString()
  convo.lastReplyText = text
  if (convo.history.length > MAX_STORED_MESSAGES) convo.history = convo.history.slice(-MAX_STORED_MESSAGES)
  return convo
}

function getHistoryForAi(chatId) {
  return getOrCreate(chatId).history.map((m) => ({ role: m.role, text: m.text }))
}

function getSummary(chatId) {
  const convo = getOrCreate(chatId)
  const { score, status } = scoreLead(convo.qualification)
  return {
    chatId,
    contactName: convo.contactName,
    qualification: convo.qualification,
    leadScore: score,
    leadStatus: status,
    lastInboundAt: convo.lastInboundAt,
    lastInboundText: convo.lastInboundText,
    lastReplyAt: convo.lastReplyAt,
    lastReplyText: convo.lastReplyText,
    messageCount: convo.history.length,
  }
}

/** Most recently active conversation - what the dashboard's single-contact
 * demo card shows, per the "Last incoming message / Last AI reply /
 * Current lead score" requirement. */
function getMostRecentSummary() {
  let latest = null
  for (const convo of conversations.values()) {
    if (!latest || (convo.lastInboundAt && convo.lastInboundAt > (latest.lastInboundAt || ""))) latest = convo
  }
  return latest ? getSummary(latest.chatId) : null
}

function reset() {
  conversations.clear()
}

module.exports = { recordInbound, recordReply, getHistoryForAi, getSummary, getMostRecentSummary, reset }
