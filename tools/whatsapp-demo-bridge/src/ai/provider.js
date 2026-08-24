const config = require("../config")
const gemini = require("./gemini")
const ollama = require("./ollama")
const { SYSTEM_PROMPT } = require("../system-prompt")
const { retrieve } = require("../rag/retrieval")
const { searchProducts, isAvailabilityOrPriceQuery, formatMatchesForContext } = require("../rag/product-catalog")

const MAX_HISTORY_TURNS = 20

/**
 * Structured product/price lookup takes precedence over generic prose RAG
 * - per-question, never baked into the system prompt (so a re-sync is
 * reflected on the very next question, and prices are never frozen text
 * the model might repeat stale). Falls back to the knowledge-base RAG for
 * anything that isn't a product/price question, or that the catalog
 * genuinely has nothing for.
 */
function buildProductContext(message) {
  if (!isAvailabilityOrPriceQuery(message)) return null

  const { matches } = searchProducts(message)
  if (matches.length === 0) return null

  if (matches.length === 1) {
    return `Matched product from the current MeriteShop catalog (use these exact numbers, never invent different ones):\n\n${formatMatchesForContext(matches)}`
  }

  const names = matches.map((m) => m.name).join(", ")
  return (
    `Multiple MeriteShop products could match this question: ${names}.\n` +
    `Do NOT guess which one - ask the customer a short clarifying question (in their own language/style) naming the distinguishing options ` +
    `(e.g. core type, or standard vs flexible construction), then wait for their answer before quoting any price. Do not list all of these products in full.`
  )
}

function buildKnowledgeContext(message) {
  const chunks = retrieve(message, 4)
  if (chunks.length === 0) {
    return "Retrieved knowledge: (nothing matched this question in the Merit Cables knowledge base - be honest that you don't have that specific information and offer to connect them with the Merit Cables team.)"
  }
  return `Retrieved Merit Cables knowledge (use only this for facts - if it doesn't fully answer the question, say so honestly):\n\n${chunks.map((c) => `[${c.source}] ${c.text}`).join("\n\n")}`
}

/**
 * Builds the actual prompt sent to the model: the system prompt, plus
 * either a structured product-catalog match or the relevant knowledge
 * chunks for the LATEST message (never the whole KB/catalog), plus the
 * bounded recent conversation. `history` is [{role: "user"|"model", text}],
 * oldest first, NOT including the new message yet.
 */
async function generateReply(history, newUserMessage) {
  const contextBlock = buildProductContext(newUserMessage) ?? buildKnowledgeContext(newUserMessage)

  const bounded = history.slice(-MAX_HISTORY_TURNS)
  const turns = [...bounded, { role: "user", text: `${contextBlock}\n\nCustomer message: ${newUserMessage}` }]

  if (config.aiProvider === "gemini") {
    return gemini.generateReply(turns, SYSTEM_PROMPT, config.geminiApiKey)
  }
  return ollama.generateReply(turns, SYSTEM_PROMPT, config.ollamaModel, config.ollamaBaseUrl)
}

module.exports = { generateReply }
