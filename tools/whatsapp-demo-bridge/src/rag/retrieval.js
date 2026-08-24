const fs = require("node:fs")
const path = require("node:path")
const config = require("../config")

/**
 * Deliberately simple: no vector DB, no embedding API call (nothing else
 * to fail during a live demo). Loads every .md/.txt file in
 * demo-knowledge/<config.client>/, splits each on "## " headings into
 * chunks, and scores chunks against a query by term overlap (a small
 * deterministic TF-style score) - good enough for a hand-curated few-page
 * knowledge base. Swap this module's retrieve() for a pgvector-backed one
 * later without touching any caller.
 *
 * Per-client knowledge is isolated by directory (demo-knowledge/meriteshop/,
 * demo-knowledge/easylife/, ...) - only the active client's own files are
 * ever loaded, so a MeriteShop customer conversation can never surface
 * EasyLife's own company knowledge (or vice versa for a future client).
 */
const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "demo-knowledge", config.client)

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "of", "to", "in", "on", "for",
  "with", "this", "that", "it", "its", "as", "by", "from", "at", "be", "not", "no", "do",
  "does", "did", "you", "your", "we", "our", "i", "what", "how", "can", "will", "about",
])

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

function loadChunks() {
  const chunks = []
  let files = []
  try {
    files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
  } catch {
    return chunks
  }

  for (const file of files) {
    const raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), "utf8")
    const sections = raw.split(/\n(?=## )/g)
    for (const section of sections) {
      const trimmed = section.trim()
      if (!trimmed) continue
      const heading = (trimmed.match(/^#{1,2}\s+(.+)$/m) || [])[1] || file
      chunks.push({ source: file, heading, text: trimmed, terms: tokenize(trimmed) })
    }
  }
  return chunks
}

let cachedChunks = null
function getChunks() {
  // Cached at module load, not per-request - this is a static local KB
  // for a live demo, not something that needs hot-reload mid-conversation.
  if (!cachedChunks) cachedChunks = loadChunks()
  return cachedChunks
}

// Smooths the length-normalization denominator so a very short chunk (a
// 3-sentence stub) can't outscore a genuinely relevant longer chunk just
// by having fewer total terms to divide by - found via a real case: a
// 4-term "Coaxial Cable" stub was outranking a 142-term chunk containing
// the actual safety-critical "don't guess a cable size, ask first"
// instruction for a house-wiring question. Below ~10 terms this barely
// changes anything; above it, it keeps the original relative behavior.
const LENGTH_SMOOTHING = 10

function scoreChunk(queryTerms, chunk) {
  if (queryTerms.length === 0 || chunk.terms.length === 0) return 0
  const termCounts = new Map()
  for (const t of chunk.terms) termCounts.set(t, (termCounts.get(t) || 0) + 1)

  let score = 0
  for (const qt of queryTerms) {
    const count = termCounts.get(qt) || 0
    if (count > 0) score += count / Math.sqrt(chunk.terms.length + LENGTH_SMOOTHING)
  }
  return score
}

/** Returns the top `limit` chunks most relevant to `query`, or [] if the
 * KB is empty or nothing scores above zero (caller should tell the model
 * "no matching knowledge" rather than pass an empty block silently). */
function retrieve(query, limit = 3) {
  const queryTerms = tokenize(query)
  const chunks = getChunks()
  if (chunks.length === 0 || queryTerms.length === 0) return []

  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(queryTerms, chunk) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.chunk)
}

function reloadKnowledge() {
  cachedChunks = null
  return getChunks().length
}

module.exports = { retrieve, reloadKnowledge, getChunks }
