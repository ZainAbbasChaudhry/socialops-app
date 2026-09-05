import type { LeadIntentStatus } from "@/types"

/**
 * Mock lead-intent classification. This is the seam a real NLU/LLM call
 * replaces — every function here is a plain keyword heuristic so the rest
 * of the WhatsApp/lead pipeline has something deterministic to build
 * against before a real model is wired in behind `lib/services/ai-service.ts`.
 */

/**
 * ORDER MATTERS - `classifyLeadIntent` returns the first match, and object
 * key order is the evaluation order.
 *
 * Opt-out and spam are checked FIRST and deliberately so. They used to sit
 * below `warm`, whose `\binterested\b` alternative matches inside the
 * phrase "not interested" - so "I'm not interested, please stop" classified
 * as **warm**, the `not-interested` status was never applied, and the lead
 * stayed eligible for the AI call queue. Someone who asked to be left alone
 * could be phoned. Negative and terminal intents must therefore always be
 * evaluated before the positive ones that share their vocabulary.
 */
const INTENT_KEYWORDS: Record<Exclude<LeadIntentStatus, "cold" | "human-review">, RegExp> = {
  "not-interested": /\b(not interested|no thanks|no thank you|stop|unsubscribe|remove me|don'?t contact)\b/i,
  spam: /(https?:\/\/)|\b(crypto|forex|investment opportunity)\b/i,
  "existing-customer": /\b(my order|already (a )?customer|my account|my subscription)\b/i,
  support: /\b(refund|complaint|issue|problem|not working|broken)\b/i,
  qualified: /\b(appointment|consultation|book|call me|schedule|when can we|meeting)\b/i,
  interested: /\b(price|pricing|cost|how much|details|send details|information)\b/i,
  warm: /\b(interested|tell me more|learn more|curious)\b/i,
}

/** Words that plausibly indicate genuine buying intent — used only for the
 * "willingness / intent" scoring signal, not for classification. */
export const BUYING_INTENT_KEYWORDS = /\b(buy|purchase|sign up|join|get started|how can i buy)\b/i

export function classifyLeadIntent(message: string): LeadIntentStatus {
  for (const [status, pattern] of Object.entries(INTENT_KEYWORDS)) {
    if (pattern.test(message)) return status as LeadIntentStatus
  }
  return "cold"
}

export interface ExtractedQualification {
  budget?: string
  timeline?: string
  serviceInterested?: string
}

const BUDGET_PATTERN = /\$\s?\d[\d,]*(?:\s?-\s?\$?\s?\d[\d,]*)?/
const TIMELINE_PATTERN = /\b(this week|next week|this month|next month|asap|immediately|in \d+ (days|weeks|months))\b/i

/** Very light extraction from a single message — a real model would read
 * the whole thread and infer far more than regex ever could. */
export function extractQualificationFromMessage(message: string): ExtractedQualification {
  const budgetMatch = message.match(BUDGET_PATTERN)
  const timelineMatch = message.match(TIMELINE_PATTERN)
  return {
    budget: budgetMatch?.[0],
    timeline: timelineMatch?.[0],
  }
}
