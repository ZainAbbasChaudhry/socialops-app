const config = require("../config")
const gemini = require("./gemini")
const ollama = require("./ollama")
const { SYSTEM_PROMPT } = require("../system-prompt")
const { retrieve } = require("../rag/retrieval")

const MAX_HISTORY_TURNS = 20

/**
 * Builds the actual prompt sent to the model: the system prompt, plus only
 * the retrieved knowledge chunks relevant to the LATEST message (never the
 * whole knowledge base), plus the bounded recent conversation. `history`
 * is [{role: "user"|"model", text}], oldest first, NOT including the new
 * message yet.
 */
async function generateReply(history, newUserMessage) {
  const chunks = retrieve(newUserMessage, 3)
  const knowledgeBlock =
    chunks.length > 0
      ? `Retrieved knowledge (use only this for EasyLife facts - if it doesn't answer the question, say so honestly):\n\n${chunks.map((c) => `[${c.source}] ${c.text}`).join("\n\n")}`
      : "Retrieved knowledge: (nothing matched this question in the knowledge base - be honest that you don't have that specific information and offer to arrange help from the EasyLife team.)"

  const bounded = history.slice(-MAX_HISTORY_TURNS)
  const turns = [...bounded, { role: "user", text: `${knowledgeBlock}\n\nCustomer message: ${newUserMessage}` }]

  if (config.aiProvider === "gemini") {
    return gemini.generateReply(turns, SYSTEM_PROMPT, config.geminiApiKey)
  }
  return ollama.generateReply(turns, SYSTEM_PROMPT, config.ollamaModel, config.ollamaBaseUrl)
}

module.exports = { generateReply }
