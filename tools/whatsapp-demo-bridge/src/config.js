require("dotenv").config()

function parseList(value) {
  return (value ?? "")
    .split(",")
    .map((v) => v.replace(/\D/g, ""))
    .filter(Boolean)
}

const config = {
  port: Number(process.env.PORT) || 4001,
  aiProvider: process.env.DEMO_RAG_AI_PROVIDER === "gemini" ? "gemini" : "ollama",
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3:8b",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  allowedNumbers: parseList(process.env.DEMO_WHATSAPP_ALLOWED_NUMBERS),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  // Runtime-toggleable (via POST /settings) - the env var only supplies the
  // starting value, since env vars can't be hot-reloaded from the dashboard.
  autoReply: process.env.DEMO_WHATSAPP_AUTO_REPLY !== "false",
}

module.exports = config
