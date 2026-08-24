/**
 * Deterministic, rule-based MeriteShop purchase-lead scoring - the LLM
 * never invents the score. Fields are opportunistically extracted from
 * the customer's own messages with simple heuristics, reusing the same
 * product-catalog matcher the AI reply itself uses (so "productInterest"
 * means the same thing here as what Pluggy actually answered about).
 */
const { searchProducts } = require("./rag/product-catalog")

const QUANTITY_RE = /(\d[\d,]{0,5})\s*(?:rolls?|meters?|pieces?|units?|coils?)\b/i
const CITY_LIST = ["lahore", "islamabad", "karachi", "rawalpindi", "sukkur", "faisalabad", "multan", "peshawar", "quetta", "sialkot", "gujranwala", "hyderabad", "gulberg"]
const PROJECT_RE = /\b(construction|project|commercial|industrial|building|site)\b/i
const HOUSE_WIRING_RE = /\b(house wiring|ghar\s*(ki|ke)?\s*wiring|home wiring)\b/i
const SOLAR_APPLICATION_RE = /\bsolar\b/i
const URGENT_RE = /\b(this month|asap|immediately|urgent|right away|as soon as possible|abhi|jaldi)\b/i
const SOON_RE = /\b(next month|soon|this quarter|couple of weeks|few weeks)\b/i
const CUSTOMER_TYPE_PATTERNS = [
  { type: "electrician", re: /\belectrician\b/i },
  { type: "contractor", re: /\bcontractor\b/i },
  { type: "builder", re: /\bbuilder\b/i },
  { type: "dealer", re: /\bdealer\b|\bwholesale\b/i },
  { type: "solar installer", re: /\bsolar installer\b/i },
  { type: "business", re: /\bbusiness\b|\bcompany\b|\bshop\b/i },
  { type: "home owner", re: /\bmy house\b|\bapna ghar\b|\bghar (ke|ki)?\s*liye\b|\bhome owner\b/i },
]
const QUOTATION_RE = /\bquotation\b|\bquote\b/i
const PURCHASE_INTENT_RE = /\border\b|\bbuy\b|\bkharidna\b|\bkharidnay\b|\bpurchase\b/i
const HUMAN_SUPPORT_RE = /\bcall me\b|\bsales\s*(call|contact)\b|\btalk to (someone|a human|an agent)\b|\bhuman\b.{0,15}\b(support|contact)\b/i
const PHONE_RE = /(\+92\s?3\d{2}|\b03\d{2})[\s-]?\d{3}[\s-]?\d{4}\b/

function createQualificationState() {
  return {
    customerName: null,
    phone: null,
    city: null,
    customerType: null,
    productInterest: null,
    cableCategory: null,
    requiredSize: null,
    requiredQuantity: null,
    projectType: null,
    application: null,
    timeline: null,
    bulkOrder: null, // true | false | null
    quotationRequested: false,
    purchaseIntent: false,
    humanSupportRequested: false,
  }
}

/** Merges any newly-detected fields from one customer message into the
 * existing state - never overwrites an already-known field with null,
 * and boolean "requested" flags only ever turn true, never back to false. */
function extractAndMerge(state, message) {
  const next = { ...state }

  if (!next.productInterest) {
    const { matches, sizesFound } = searchProducts(message)
    if (matches.length >= 1) {
      next.productInterest = matches.length === 1 ? matches[0].name : `${matches.length} possible matches`
      next.cableCategory = next.cableCategory ?? matches[0]?.category ?? null
    }
    if (sizesFound.length > 0 && !next.requiredSize) next.requiredSize = `${sizesFound[0]} mm²`
  }

  const qtyMatch = message.match(QUANTITY_RE)
  if (qtyMatch && !next.requiredQuantity) {
    next.requiredQuantity = qtyMatch[0].trim()
    const n = Number(qtyMatch[1].replace(/,/g, ""))
    if (n >= 10) next.bulkOrder = true
  }

  if (!next.city) {
    const lower = message.toLowerCase()
    const found = CITY_LIST.find((c) => lower.includes(c))
    if (found) next.city = found.charAt(0).toUpperCase() + found.slice(1)
  }

  if (!next.projectType) {
    if (PROJECT_RE.test(message)) next.projectType = "construction/project"
    else if (HOUSE_WIRING_RE.test(message)) next.projectType = "house wiring"
  }
  if (!next.application) {
    if (SOLAR_APPLICATION_RE.test(message)) next.application = "solar"
    else if (HOUSE_WIRING_RE.test(message)) next.application = "house wiring"
  }
  if (PROJECT_RE.test(message) && next.bulkOrder === null) next.bulkOrder = true

  if (!next.timeline) {
    if (URGENT_RE.test(message)) next.timeline = "urgent"
    else if (SOON_RE.test(message)) next.timeline = "soon"
  }

  if (!next.customerType) {
    const found = CUSTOMER_TYPE_PATTERNS.find((p) => p.re.test(message))
    if (found) next.customerType = found.type
  }

  // A quotation request is itself a strong purchase-intent signal (a
  // customer doesn't ask for pricing on a bulk/project order unless
  // they're seriously evaluating a purchase) - counts as both.
  if (QUOTATION_RE.test(message)) {
    next.quotationRequested = true
    next.purchaseIntent = true
  }
  if (PURCHASE_INTENT_RE.test(message)) next.purchaseIntent = true
  if (HUMAN_SUPPORT_RE.test(message)) next.humanSupportRequested = true

  const phoneMatch = message.match(PHONE_RE)
  if (phoneMatch && !next.phone) next.phone = phoneMatch[0].trim()

  return next
}

/** Pure function: state in, score out. Never influenced by the LLM's own
 * output - only by what was actually, deterministically extracted. */
function scoreLead(state) {
  let score = 0
  if (state.productInterest) score += 15
  if (state.requiredQuantity) score += 15
  if (state.bulkOrder === true || state.projectType) score += 15
  if (state.city) score += 5
  if (state.timeline === "urgent") score += 10
  else if (state.timeline === "soon") score += 5
  if (state.quotationRequested) score += 15
  if (state.customerType && ["contractor", "dealer", "builder"].includes(state.customerType)) score += 10
  if (state.purchaseIntent) score += 10
  if (state.humanSupportRequested) score += 5

  score = Math.min(100, score)

  const status = score >= 70 ? "Hot Lead" : score >= 40 ? "Interested" : "Browsing"
  return { score, status }
}

module.exports = { createQualificationState, extractAndMerge, scoreLead }
