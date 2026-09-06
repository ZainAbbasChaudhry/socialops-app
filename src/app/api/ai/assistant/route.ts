import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { generateWithLLM } from "@/lib/services/llm"
import { resolveLlm } from "@/lib/services/llm/resolve"
import { buildTemplateResponse } from "@/lib/services/ai-service"
import type { AiCapability } from "@/types"

const SYSTEM_INSTRUCTION =
  "You are the AI Assistant inside EasyLife, a social-media sales dashboard for small businesses. " +
  "Write concise, practical, on-brand social media content. No preamble like \"Sure, here is...\" — just the content itself, " +
  "formatted the way a busy marketer would want to paste it straight into a post or reply."

const CAPABILITY_PROMPT: Record<AiCapability, (input: string) => string> = {
  caption: (input) => `Write one engaging social media caption (2-3 sentences, one relevant emoji, ending with a soft call-to-action) about: ${input}`,
  rewrite: (input) => `Rewrite this to be punchier and more scroll-stopping, same meaning, roughly the same length:\n\n${input}`,
  hashtags: (input) => `Suggest 6-8 relevant hashtags (mix of broad and niche) for a social post about: ${input}. Return them space-separated on one line.`,
  ideas: (input) => `Give 5 short, specific content ideas (one line each, numbered) for a small business social account, on the theme: ${input}`,
  "dm-reply": (input) => `Draft a warm, brief reply to this incoming DM from a potential customer:\n\n${input}`,
  "comment-reply": (input) => `Draft a brief, genuine reply to this social media comment:\n\n${input}`,
  intent: (input) => `Classify the intent of this message in 2-4 words (e.g. "Pricing question", "Complaint", "Booking request", "Compliment", "General question"), then one short sentence explaining why:\n\n${input}`,
  repurpose: (input) => `Repurpose this content into three formats — a short X/Twitter post, a reflective LinkedIn post, and a TikTok hook line. Label each clearly:\n\n${input}`,
}

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  let payload: { capability?: AiCapability; input?: string }
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { capability, input } = payload
  if (!capability || !CAPABILITY_PROMPT[capability] || typeof input !== "string") {
    return NextResponse.json({ error: "capability and input are required" }, { status: 400 })
  }

  const prompt = CAPABILITY_PROMPT[capability](input.trim() || "a new update")
  const llm = await resolveLlm(auth.ctx.workspaceId, "complex")
  const result = await generateWithLLM(prompt, SYSTEM_INSTRUCTION, llm)

  if (result.ok) {
    // `source` names the model that actually answered, not a hardcoded
    // "gemini" - a client running their own model should see that.
    return NextResponse.json({ text: result.text, source: llm?.provider ?? "gemini" })
  }

  // Gemini unavailable for any reason (no billing, network, etc.) — never
  // break the demo, fall back to the deterministic local template instead.
  return NextResponse.json({
    text: buildTemplateResponse(capability, input),
    source: "simulated",
    reason: result.reason,
  })
}
