import type { CallPermission, LeadIntentStatus, LeadQualification, LeadScoreFactors } from "@/types"
import { classifyLeadIntent, extractQualificationFromMessage } from "@/lib/integrations/ai/lead-intent"
import { computeLeadScore, bandForScore } from "@/lib/leads/scoring"

/**
 * WhatsApp AI chatbot — the seam a real LLM (reading the live WhatsApp
 * thread via the Cloud API webhook) replaces. This is a small deterministic
 * finite-state machine so the qualification UX can be built and demoed
 * without any model/API dependency. It asks one thing at a time, skips
 * anything it can already infer from what the customer just said, and never
 * re-asks a question it already has an answer for.
 */

export type ChatbotStep = "greeting" | "name" | "business" | "location" | "budget" | "timeline" | "call-offer" | "closing"

export interface ChatbotCollected extends Pick<LeadQualification, "businessType" | "location" | "serviceInterested" | "requirement" | "budget" | "timeline"> {
  name?: string
  wantsCall?: boolean
}

export interface ChatbotState {
  step: ChatbotStep
  collected: ChatbotCollected
  turns: number
}

export interface ChatbotTurnResult {
  reply: string
  state: ChatbotState
  finished: boolean
}

export function createInitialChatbotState(): ChatbotState {
  return { step: "greeting", collected: {}, turns: 0 }
}

const SERVICE_KEYWORDS: Record<string, string> = {
  website: "Website design",
  app: "App development",
  market: "Digital marketing",
  social: "Social media management",
  brand: "Branding",
  seo: "SEO",
  automat: "Automation",
  consult: "Business consulting",
  ecommerce: "E-commerce setup",
  "e-commerce": "E-commerce setup",
}

function guessService(message: string): string | undefined {
  const lower = message.toLowerCase()
  for (const [key, label] of Object.entries(SERVICE_KEYWORDS)) {
    if (lower.includes(key)) return label
  }
  return undefined
}

function applyOpportunisticExtraction(collected: ChatbotCollected, message: string): ChatbotCollected {
  const next = { ...collected }
  const extracted = extractQualificationFromMessage(message)
  if (extracted.budget && !next.budget) next.budget = extracted.budget
  if (extracted.timeline && !next.timeline) next.timeline = extracted.timeline
  const service = guessService(message)
  if (service && !next.serviceInterested) next.serviceInterested = service
  return next
}

export function nextChatbotTurn(state: ChatbotState, userMessage: string): ChatbotTurnResult {
  const collected = applyOpportunisticExtraction(state.collected, userMessage)
  const trimmed = userMessage.trim()

  let reply = ""
  let nextStep: ChatbotStep = state.step

  switch (state.step) {
    case "greeting":
      collected.serviceInterested = collected.serviceInterested ?? trimmed
      reply = "Great, thanks for sharing that! And who do I have the pleasure of chatting with?"
      nextStep = "name"
      break

    case "name":
      collected.name = collected.name ?? trimmed.split(/[,.\n]/)[0].slice(0, 40)
      reply = "Nice to meet you! What kind of business do you run, and what's the main thing you're trying to solve right now?"
      nextStep = "business"
      break

    case "business":
      collected.businessType = collected.businessType ?? trimmed
      collected.requirement = collected.requirement ?? trimmed
      reply = "Understood. Where's the business based?"
      nextStep = "location"
      break

    case "location":
      collected.location = collected.location ?? trimmed
      reply = collected.budget
        ? "And roughly what timeline are you working with — this month, next month, or later?"
        : "Do you have a rough budget in mind for this?"
      nextStep = collected.budget ? "timeline" : "budget"
      break

    case "budget":
      collected.budget = collected.budget ?? trimmed
      reply = "Thanks. When would you like to get started — this month, next month, or later?"
      nextStep = "timeline"
      break

    case "timeline":
      collected.timeline = collected.timeline ?? trimmed
      reply = "That's everything I need for now. Would you like a quick call with our team to go over the details?"
      nextStep = "call-offer"
      break

    case "call-offer": {
      const positive = /\b(yes|sure|ok(ay)?|yeah|yep|sounds good|please|definitely|go ahead)\b/i.test(trimmed)
      const negative = /\b(no|not now|maybe later|not interested|nah)\b/i.test(trimmed)
      collected.wantsCall = positive ? true : negative ? false : undefined
      reply = positive
        ? "Perfect — I've passed your details to our team and they'll call you shortly. Anything else I should mention before you go?"
        : "No problem — I'll keep your details on file so you can pick this up anytime. Anything else I can help with?"
      nextStep = "closing"
      break
    }

    default:
      reply = "Thanks for the extra detail — our team has everything they need now. 🙌"
      nextStep = "closing"
  }

  const newState: ChatbotState = { step: nextStep, collected, turns: state.turns + 1 }
  return { reply, state: newState, finished: nextStep === "closing" && state.step === "call-offer" }
}

export interface ChatbotClassification {
  score: number
  status: LeadIntentStatus
  bandLabel: string
  factors: LeadScoreFactors
  callPermission: CallPermission
  eligibleForCallQueue: boolean
}

/** Runs after the conversation ends — mirrors the same scoring module the
 * WhatsApp inbox and call summaries use, so a lead's score means the same
 * thing everywhere in the product. */
export function classifyChatbotLead(state: ChatbotState, fullTranscript: string, minimumLeadScore: number): ChatbotClassification {
  const intent = classifyLeadIntent(fullTranscript)
  const { collected } = state

  // Same correction as the Gemini path: the positive end of each signal has
  // to reach the top of its range, or the Hot Lead band (86+) can never be
  // awarded. Unknown and negative values are unchanged.
  const factors: LeadScoreFactors = {
    buyingIntent: collected.wantsCall ? 100 : intent === "interested" || intent === "qualified" ? 65 : 35,
    budget: collected.budget ? 90 : 30,
    urgency: collected.timeline ? 90 : 30,
    serviceMatch: collected.serviceInterested ? 90 : 30,
    // This flow never asks who decides, so this stays neutral rather than
    // guessing. It is the one factor holding a perfect chatbot lead below a
    // perfect Gemini-qualified one, which is the honest ordering: the
    // chatbot genuinely knows less.
    decisionAuthority: 55,
    willingnessToMeet: collected.wantsCall === true ? 100 : collected.wantsCall === false ? 15 : 40,
    sentiment: intent === "not-interested" || intent === "spam" ? 10 : 70,
    engagement: Math.min(100, state.turns * 15),
  }

  const score = computeLeadScore(factors)
  const band = bandForScore(score)
  let status: LeadIntentStatus = band.status
  if (intent === "not-interested" || intent === "spam") status = intent
  else if (collected.wantsCall === false) status = "warm"

  const callPermission: CallPermission = collected.wantsCall === true ? "yes" : collected.wantsCall === false ? "no" : "unknown"
  const eligibleForCallQueue = score >= minimumLeadScore && callPermission !== "no" && status !== "not-interested" && status !== "spam" && status !== "human-review"

  return { score, status, bandLabel: band.label, factors, callPermission, eligibleForCallQueue }
}

/** Generates a plausible-looking demo WhatsApp number for the simulated
 * chat session — a real WhatsApp Business webhook receives the sender's
 * number automatically, it's never typed into the conversation. */
export function generateDemoWhatsAppNumber(): string {
  const mid = Math.floor(Math.random() * 90 + 10)
  const rest = Math.floor(Math.random() * 9000000 + 1000000)
  return `+92 3${mid} ${rest}`
}
