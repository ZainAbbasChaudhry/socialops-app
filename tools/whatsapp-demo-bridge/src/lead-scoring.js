/**
 * Deterministic, rule-based lead scoring - the LLM never invents the
 * score. Fields are opportunistically extracted from the customer's own
 * messages with simple heuristics (same spirit as the main dashboard's
 * WhatsApp chatbot qualification extraction, duplicated here rather than
 * imported so this stays a self-contained, deletable tool).
 */

const BUDGET_RE = /(?:pkr|rs\.?|budget)\s*[:\-]?\s*([\d,]+\s*(?:k|thousand|lac|lakh|million)?)/i
const VOLUME_RE = /(\d[\d,]{1,6})\s*(?:leads?|inquiries|enquiries|customers|messages)\b/i
const URGENT_RE = /\b(this month|asap|immediately|urgent|right away|as soon as possible)\b/i
const SOON_RE = /\b(next month|soon|this quarter|couple of weeks|few weeks)\b/i
const DECISION_MAKER_YES_RE = /\b(i am|i'm|yes,? i am)\b.{0,20}\b(decision maker|owner|founder|ceo)\b|\byes\b.{0,10}\bdecision\b/i
const CALL_YES_RE = /\byes\b.{0,15}\b(call|talk|speak)\b|\bplease call\b|\bcall me\b/i
const INDUSTRY_RE = /\bi (?:run|own|manage)\s+(?:a|an)?\s*([a-z][a-z\s]{2,30}?)\s*(?:business|company|agency|store|shop|firm)\b/i
const REQUIREMENT_HINT_RE = /\b(problem|struggl|need|looking for|trying to|main issue|challenge)\b/i

function createQualificationState() {
  return {
    name: null,
    company: null,
    industry: null,
    requirement: null,
    painPoint: null,
    monthlyLeadVolume: null,
    budget: null,
    timeline: null,
    decisionMaker: null, // true | false | null
    callInterest: null, // true | false | null
  }
}

/** Merges any newly-detected fields from one customer message into the
 * existing state - never overwrites an already-known field with null. */
function extractAndMerge(state, message) {
  const next = { ...state }

  const industryMatch = message.match(INDUSTRY_RE)
  if (industryMatch && !next.industry) {
    next.industry = industryMatch[1].trim()
    next.company = next.company ?? industryMatch[1].trim()
  }

  const volumeMatch = message.match(VOLUME_RE)
  if (volumeMatch && !next.monthlyLeadVolume) {
    next.monthlyLeadVolume = Number(volumeMatch[1].replace(/,/g, ""))
  }

  const budgetMatch = message.match(BUDGET_RE)
  if (budgetMatch && !next.budget) {
    next.budget = budgetMatch[0].trim()
  }

  if (!next.timeline) {
    if (URGENT_RE.test(message)) next.timeline = "urgent"
    else if (SOON_RE.test(message)) next.timeline = "soon"
  }

  if (next.decisionMaker === null && DECISION_MAKER_YES_RE.test(message)) {
    next.decisionMaker = true
  }

  if (next.callInterest === null && CALL_YES_RE.test(message)) {
    next.callInterest = true
  }

  if (!next.requirement && REQUIREMENT_HINT_RE.test(message) && message.length > 15) {
    next.requirement = message.trim().slice(0, 200)
    next.painPoint = next.painPoint ?? next.requirement
  }

  return next
}

/** Pure function: state in, score out. Never influenced by the LLM's own
 * output - only by what was actually, deterministically extracted. */
function scoreLead(state) {
  let score = 0
  if (state.requirement) score += 15
  if (state.industry || state.company) score += 10
  if (state.monthlyLeadVolume && state.monthlyLeadVolume >= 100) score += 15
  if (state.budget) score += 20
  if (state.timeline === "urgent") score += 15
  else if (state.timeline === "soon") score += 8
  if (state.decisionMaker === true) score += 10
  if (state.callInterest === true) score += 10
  const hasCompleteContext = Boolean(state.company && state.requirement && state.budget && state.timeline)
  if (hasCompleteContext) score += 5

  score = Math.min(100, score)

  const status = score >= 70 ? "Qualified" : score >= 40 ? "Interested" : "Cold"
  return { score, status }
}

module.exports = { createQualificationState, extractAndMerge, scoreLead }
