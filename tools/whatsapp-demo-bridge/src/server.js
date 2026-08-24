const express = require("express")
const cors = require("cors")
const config = require("./config")
const { WhatsAppBridge } = require("./whatsapp-client")
const { createMessageHandler } = require("./message-handler")
const memory = require("./conversation-memory")
const { reloadKnowledge, getChunks } = require("./rag/retrieval")
const ollama = require("./ai/ollama")

const app = express()
app.use(cors({ origin: config.corsOrigin }))
app.use(express.json())

const bridge = new WhatsAppBridge()
bridge.onMessage = createMessageHandler()

const startedAt = Date.now()

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) })
})

app.get("/status", (_req, res) => {
  res.json(bridge.getState())
})

app.get("/qr", (_req, res) => {
  const state = bridge.getState()
  res.json({ status: state.status, qrDataUrl: state.qrDataUrl })
})

app.post("/disconnect", async (_req, res) => {
  await bridge.disconnect()
  memory.reset()
  res.json({ ok: true, status: bridge.getState().status })
})

app.post("/reconnect", async (_req, res) => {
  await bridge.reconnect()
  res.json({ ok: true, status: bridge.getState().status })
})

app.get("/demo-state", (_req, res) => {
  res.json({ conversation: memory.getMostRecentSummary() })
})

app.get("/settings", (_req, res) => {
  res.json({
    aiProvider: config.aiProvider,
    ollamaModel: config.aiProvider === "ollama" ? config.ollamaModel : null,
    autoReply: config.autoReply,
    allowedNumbersConfigured: config.allowedNumbers.length > 0,
    knowledgeChunks: getChunks().length,
  })
})

app.post("/settings", (req, res) => {
  if (typeof req.body?.autoReply === "boolean") config.autoReply = req.body.autoReply
  res.json({ ok: true, autoReply: config.autoReply })
})

app.post("/reload-knowledge", (_req, res) => {
  const count = reloadKnowledge()
  res.json({ ok: true, chunks: count })
})

app.get("/ollama-models", async (_req, res) => {
  const result = await ollama.listInstalledModels(config.ollamaBaseUrl)
  res.json(result)
})

app.listen(config.port, () => {
  console.log(`\n[whatsapp-bridge] EasyLife WhatsApp Demo Bridge listening on http://localhost:${config.port}`)
  console.log(`[whatsapp-bridge] AI provider: ${config.aiProvider}${config.aiProvider === "ollama" ? ` (model: ${config.ollamaModel})` : ""}`)
  console.log(`[whatsapp-bridge] Knowledge chunks loaded: ${getChunks().length}`)
  console.log(`[whatsapp-bridge] Auto-reply: ${config.autoReply ? "ON" : "OFF (observe-only)"}`)
  console.log(`[whatsapp-bridge] Allowed numbers: ${config.allowedNumbers.length > 0 ? config.allowedNumbers.join(", ") : "(any - not restricted)"}\n`)

  bridge.start().catch((error) => {
    console.error("[whatsapp-bridge] Failed to start WhatsApp client:", error instanceof Error ? error.message : error)
  })
})
