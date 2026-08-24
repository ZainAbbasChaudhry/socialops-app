/**
 * Small, self-contained port of the main app's gemini-client.ts call
 * pattern - deliberately duplicated rather than imported, since this
 * bridge is an isolated tool with its own package.json/dependencies and
 * is meant to be deletable without touching the main app.
 */
const MODEL = "gemini-3.6-flash"
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

async function generateReply(turns, systemInstruction, apiKey) {
  if (!apiKey) return { ok: false, code: "not_configured", reason: "GEMINI_API_KEY is not set in the bridge's .env" }

  try {
    const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const message = body?.error?.message || `Gemini request failed (${res.status})`
      const lower = message.toLowerCase()
      let code = "provider_error"
      if (res.status === 429 && (lower.includes("prepayment") || lower.includes("credits") || lower.includes("depleted"))) code = "quota_exhausted"
      else if (res.status === 429) code = "rate_limited"
      else if (res.status === 400 && lower.includes("api key not valid")) code = "invalid_key"
      return { ok: false, code, reason: message }
    }

    const body = await res.json()
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || ""
    if (!text.trim()) return { ok: false, code: "provider_error", reason: "Gemini returned an empty completion" }
    return { ok: true, text: text.trim() }
  } catch (error) {
    return { ok: false, code: "network_error", reason: error instanceof Error ? error.message : String(error) }
  }
}

module.exports = { generateReply }
