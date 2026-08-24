const config = require("./config")
const memory = require("./conversation-memory")
const aiProvider = require("./ai/provider")

/** True if this inbound message should even be considered - filters out
 * everything that isn't a genuine 1:1 text message from someone else, so
 * the bot can never reply to itself, a status update, a group, or a
 * non-text message. */
function isEligibleInboundMessage(msg) {
  if (msg.fromMe) return false
  if (msg.isStatus || msg.from === "status@broadcast") return false
  if (msg.from.endsWith("@g.us")) return false // group chat - out of scope for this demo
  if (msg.type !== "chat") return false // text only for now, per instructions
  if (!msg.body || !msg.body.trim()) return false
  return true
}

function isAllowedNumber(chatId) {
  if (config.allowedNumbers.length === 0) return true
  const digits = chatId.replace(/\D/g, "")
  return config.allowedNumbers.some((n) => digits.endsWith(n) || n.endsWith(digits))
}

/** Wires a live whatsapp-web.js message event to: eligibility filters ->
 * conversation memory -> RAG-grounded AI reply -> (if allowed) an actual
 * WhatsApp send. Always records what happened, even when auto-reply is
 * off or the number isn't allow-listed, so the dashboard can show it. */
function createMessageHandler() {
  return async function handleMessage(msg) {
    if (!isEligibleInboundMessage(msg)) return

    const chatId = msg.from
    let contactName = null
    try {
      const contact = await msg.getContact()
      contactName = contact?.pushname || contact?.name || null
    } catch {
      // Non-fatal - proceed without a display name.
    }

    memory.recordInbound(chatId, msg.body, contactName)

    if (!isAllowedNumber(chatId)) {
      console.log(`[whatsapp-bridge] ${chatId} is not in DEMO_WHATSAPP_ALLOWED_NUMBERS - observing only, no reply.`)
      return
    }

    const history = memory.getHistoryForAi(chatId).slice(0, -1) // exclude the message we just recorded; provider.js re-appends it
    const result = await aiProvider.generateReply(history, msg.body)

    if (!result.ok) {
      console.error(`[whatsapp-bridge] AI reply failed for ${chatId}: ${result.code} - ${result.reason}`)
      return
    }

    memory.recordReply(chatId, result.text)

    if (!config.autoReply) {
      console.log(`[whatsapp-bridge] Auto-reply is OFF - generated a reply for ${chatId} but did not send it.`)
      return
    }

    try {
      await msg.reply(result.text)
    } catch (error) {
      console.error(`[whatsapp-bridge] Failed to send WhatsApp reply to ${chatId}:`, error instanceof Error ? error.message : error)
    }
  }
}

module.exports = { createMessageHandler, isEligibleInboundMessage, isAllowedNumber }
