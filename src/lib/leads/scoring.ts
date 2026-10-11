import type { LeadIntentStatus, LeadScoreFactors } from "@/types"

/**
 * Configurable, modular scoring — every factor is 0–100 and weighted here.
 * This whole function is the seam a real model replaces later (e.g. an LLM
 * reading the full WhatsApp thread); nothing downstream cares how the score
 * was produced, only that it's 0–100.
 */
export const SCORE_FACTOR_WEIGHTS: Record<keyof LeadScoreFactors, number> = {
  buyingIntent: 0.22,
  budget: 0.16,
  urgency: 0.14,
  serviceMatch: 0.14,
  decisionAuthority: 0.12,
  willingnessToMeet: 0.12,
  sentiment: 0.06,
  engagement: 0.04,
}

export function computeLeadScore(factors: LeadScoreFactors): number {
  const weighted = (Object.keys(SCORE_FACTOR_WEIGHTS) as (keyof LeadScoreFactors)[]).reduce(
    (total, key) => total + factors[key] * SCORE_FACTOR_WEIGHTS[key],
    0
  )
  return Math.max(0, Math.min(100, Math.round(weighted)))
}

export interface ScoreBand {
  label: string
  status: LeadIntentStatus
  tone: "neutral" | "info" | "warning" | "success"
}

export function bandForScore(score: number): ScoreBand {
  if (score >= 86) return { label: "Hot Lead", status: "qualified", tone: "success" }
  if (score >= 71) return { label: "Qualified", status: "qualified", tone: "success" }
  if (score >= 51) return { label: "Interested", status: "interested", tone: "info" }
  if (score >= 31) return { label: "Warm", status: "warm", tone: "warning" }
  return { label: "Cold", status: "cold", tone: "neutral" }
}
