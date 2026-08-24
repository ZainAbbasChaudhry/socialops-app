/** Local Ollama chat completion - no external network call, no billing,
 * no quota. Requires the model to already be pulled locally; this module
 * never triggers a download. */

async function listInstalledModels(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { ok: false, models: [] }
    const body = await res.json().catch(() => null)
    return { ok: true, models: (body?.models || []).map((m) => m.name) }
  } catch {
    return { ok: false, models: [] }
  }
}

async function generateReply(turns, systemInstruction, model, baseUrl) {
  const messages = [{ role: "system", content: systemInstruction }, ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text }))]

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000), // local generation can be slow on CPU
      body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.7 } }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const message = body?.error || `Ollama request failed (${res.status})`
      const code = /model .* not found/i.test(message) ? "model_error" : "provider_error"
      return { ok: false, code, reason: message }
    }

    const body = await res.json()
    const text = body?.message?.content || ""
    if (!text.trim()) return { ok: false, code: "provider_error", reason: "Ollama returned an empty completion" }
    return { ok: true, text: text.trim() }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const code = /fetch failed|ECONNREFUSED/i.test(reason) ? "network_error" : "provider_error"
    return { ok: false, code, reason: `Is Ollama running? (${reason})` }
  }
}

module.exports = { generateReply, listInstalledModels }
