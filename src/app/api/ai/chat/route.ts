import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { getDashboardViewMode } from "@/lib/dashboard-view-mode"
import { resolveCredentialValue } from "@/lib/integrations/credential-resolution"
import { generateChatWithLLM } from "@/lib/services/llm"
import { resolveLlm } from "@/lib/services/llm/resolve"
import type { LlmChatTurn as GeminiChatTurn, LlmFailureCode as GeminiFailureCode } from "@/lib/services/llm/types"
import { EASYLIFE_SYSTEM_PROMPT } from "@/lib/ai/easylife-system-prompt"
import { apiError } from "@/lib/api/errors"

/**
 * The EasyLife AI Assistant's real chat endpoint. Deliberately has NO
 * requireClientMode() guard - Gemini for the AI Assistant is the one,
 * explicit exception to "Demo Mode makes zero real provider calls" (every
 * other provider action stays blocked in demo mode, see
 * dashboard-mode-guard.ts and the 12 routes that call it). Do not add a
 * requireClientMode() check here; that would break the intended Demo Mode
 * AI Assistant experience.
 *
 * Credential resolution is mode-aware but content is not: the same
 * EASYLIFE_SYSTEM_PROMPT and the same bounded conversation history are
 * used in both modes. No workspace CRM data (leads/messages/contacts/
 * calls) is ever read or injected here - only what the user actually
 * typed in this chat - so there is nothing workspace-specific to leak
 * between Client and Demo mode in the first place.
 */

const MAX_MESSAGE_LENGTH = 4000
const MAX_HISTORY_TURNS = 24 // bounds token growth regardless of what the client sends

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
})
const bodySchema = z.object({ messages: z.array(messageSchema).min(1).max(200) })

const GENERIC_UNAVAILABLE_MESSAGE = "EasyLife AI is temporarily unavailable. Please try again shortly."

/** User-facing text per failure code - deliberately generic and never
 * containing Google's raw error payload. Codes not listed here (e.g.
 * invalid_key, billing_required, model_error, network_error) share the
 * generic message: distinguishing them further wouldn't be actionable
 * for an end user, only for whoever reads the sanitized server log line
 * gemini-client.ts already writes for each one. */
const USER_MESSAGE: Partial<Record<GeminiFailureCode, string>> = {
  not_configured: "EasyLife AI has not been configured yet.",
  quota_exhausted: "EasyLife AI credits are currently unavailable. Please try again after the AI service quota is restored.",
  rate_limited: "EasyLife AI is receiving too many requests. Please try again shortly.",
}

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const body = bodySchema.parse(await request.json())
    const lastMessage = body.messages[body.messages.length - 1]
    if (lastMessage.role !== "user") {
      return NextResponse.json({ error: "The last message must be from the user." }, { status: 400 })
    }

    // Server derives the mode itself from the same cookie every other
    // guard reads - never trusts a client-supplied mode field, so a
    // crafted request can't claim "client" to reach a workspace's own key
    // it shouldn't, or claim "demo" to dodge workspace attribution.
    const viewMode = await getDashboardViewMode()
    const llm =
      viewMode === "client"
        ? await resolveLlm(auth.ctx.workspaceId, "complex")
        : // Demo Mode never uses (or requires) a workspace's own credential -
          // it always runs on EasyLife's platform-configured key, so a demo
          // visitor never has to configure anything first.
          (() => {
            const platformKey = resolveCredentialValue(null, "apiKey", "gemini").value
            return platformKey ? ({ provider: "gemini", apiKey: platformKey } as const) : null
          })()

    const turns: GeminiChatTurn[] = body.messages.slice(-MAX_HISTORY_TURNS).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      text: m.content,
    }))

    const result = await generateChatWithLLM(turns, EASYLIFE_SYSTEM_PROMPT, llm)

    if (result.ok) {
      return NextResponse.json({ ok: true, text: result.text })
    }

    // Honest, friendly failure - never a silently-swapped fake response,
    // and never the raw provider error/reason exposed to the client. The
    // code lets the UI (or a future UI) distinguish "try again shortly"
    // from "an admin needs to fix something" without ever seeing why.
    return NextResponse.json({ ok: false, code: result.code, error: USER_MESSAGE[result.code] ?? GENERIC_UNAVAILABLE_MESSAGE })
  } catch (error) {
    return apiError(error, "Failed to reach the AI Assistant")
  }
}
