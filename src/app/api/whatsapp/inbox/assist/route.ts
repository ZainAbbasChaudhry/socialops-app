import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { apiError } from "@/lib/api/errors"
import { resolveLlm } from "@/lib/services/llm/resolve"
import { generateWithLLM } from "@/lib/services/llm"
import {
  resolveGatewayContext,
  statusForGatewayFailure,
  gatewayFailureBody,
} from "@/lib/integrations/whatsapp/gateway-context"
import { listChatMessages } from "@/lib/integrations/whatsapp/openwa-client"

/**
 * EasyLife AI, sitting beside the conversation.
 *
 * This is the honest replacement for the Meta AI entry people expect in this
 * position. Meta AI is Meta's own assistant with no API; imitating it would
 * mean pretending. What EasyLife can genuinely offer is better for a sales
 * team anyway: an assistant that has read THIS conversation and helps answer
 * it - summarise where it has got to, suggest the next reply, or answer a
 * question about it.
 *
 * It drafts; it never sends. Every suggestion lands in the reply box for a
 * person to read, edit and send, because a message going out from a client's
 * own number under their own name should be theirs.
 */

const schema = z.object({
  chatId: z.string().trim().min(3).max(128),
  mode: z.enum(["summarise", "suggest-reply", "ask"]),
  question: z.string().trim().max(1000).optional(),
})

const SYSTEM = [
  "You are EasyLife AI, helping a salesperson at EasyLife Business Centre handle a WhatsApp conversation.",
  "You are given the recent messages of one conversation. 'Customer' is the other person; 'Us' is EasyLife.",
  "Be concise and practical. Write in the language the customer is using - if they write Urdu or Roman Urdu, answer in that.",
  "Never invent facts about pricing, availability or commitments that are not in the conversation.",
  "When suggesting a reply, output ONLY the message text, ready to send - no preamble, no quotes, no labels.",
].join(" ")

export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const { workspaceId } = auth.ctx

    const body = schema.parse(await request.json())

    const resolved = await resolveGatewayContext(workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    // The transcript is read live rather than trusted from the browser: a
    // client could otherwise put words in the customer's mouth and have the
    // assistant reason about a conversation that never happened.
    const messages = await listChatMessages(resolved.ctx.config, resolved.ctx.sessionId, body.chatId, 40)
    if (!messages.ok) {
      return NextResponse.json(gatewayFailureBody(messages), { status: statusForGatewayFailure(messages) })
    }

    const transcript = messages.data
      .filter((m) => m.body)
      .map((m) => `${m.direction === "out" ? "Us" : "Customer"}: ${m.body}`)
      .join("\n")

    if (!transcript.trim()) {
      return NextResponse.json({ error: "There is nothing written in this conversation yet." }, { status: 400 })
    }

    const instruction =
      body.mode === "summarise"
        ? "Summarise where this conversation has got to in three or four short lines: what they want, what is still unknown, and what we should do next."
        : body.mode === "suggest-reply"
          ? "Write the next message we should send. One message, ready to send."
          : (body.question ?? "What should I know about this conversation?")

    const llm = await resolveLlm(workspaceId, "complex")
    const result = await generateWithLLM(`${instruction}\n\nConversation:\n${transcript}`, SYSTEM, llm)

    if (!result.ok) {
      // Said plainly rather than dressed up as an answer: a made-up
      // suggestion is worse than none, and the salesperson needs to know the
      // assistant did not actually read anything.
      return NextResponse.json(
        {
          error:
            result.reason ||
            "EasyLife AI is not available right now. Check your AI model in Integrations.",
        },
        { status: 502 }
      )
    }

    const text = result.text.trim()
    if (!text) {
      return NextResponse.json({ error: "EasyLife AI returned nothing to use." }, { status: 502 })
    }
    return NextResponse.json({ mode: body.mode, text })
  } catch (error) {
    return apiError(error, "EasyLife AI could not answer")
  }
}
