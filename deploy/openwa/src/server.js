import { timingSafeEqual } from "node:crypto"
import express from "express"
import {
  startSession,
  getState,
  sendText,
  logout,
  isValidSessionId,
  logger,
} from "./sessions.js"

/**
 * HTTP surface of the EasyLife OpenWA gateway.
 *
 * This service is not public. Caddy terminates TLS in front of it and it
 * binds inside the container network only; every route below additionally
 * requires the shared API key, so an accidentally-exposed port is still not
 * an open WhatsApp relay.
 */

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    // Failing at boot is deliberate. A gateway that starts without its API
    // key would answer unauthenticated requests, and a gateway that starts
    // without its webhook secret would deliver unsigned messages the
    // dashboard is right to reject.
    logger.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return value
}

const config = {
  apiKey: requiredEnv("OPENWA_API_KEY"),
  webhookSecret: requiredEnv("OPENWA_WEBHOOK_SECRET"),
  webhookUrl: requiredEnv("DASHBOARD_WEBHOOK_URL"),
  sessionsDir: process.env.SESSIONS_DIR ?? "/data/sessions",
  maxReconnectAttempts: Number(process.env.MAX_RECONNECT_ATTEMPTS ?? 8),
}

const app = express()
app.disable("x-powered-by")
// WhatsApp text messages are small; a large body here means something is
// wrong, not something legitimate.
app.use(express.json({ limit: "256kb" }))

/** Constant-time API key check - a plain `!==` leaks the matching prefix
 * length through response timing. */
function apiKeyValid(provided) {
  if (typeof provided !== "string") return false
  const a = Buffer.from(provided)
  const b = Buffer.from(config.apiKey)
  return a.length === b.length && timingSafeEqual(a, b)
}

app.use((req, res, next) => {
  if (!apiKeyValid(req.header("x-api-key"))) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  next()
})

/** Liveness + credential probe. Backs the dashboard's "Test Connection"
 * button: it proves the gateway is reachable and the API key is right
 * without touching a WhatsApp session. */
app.get("/health", (_req, res) => {
  res.json({ ok: true, engine: "baileys-noweb", uptimeSeconds: Math.round(process.uptime()) })
})

function sessionIdOr400(req, res) {
  const { sessionId } = req.params
  if (!isValidSessionId(sessionId)) {
    res.status(400).json({ error: "Invalid session id" })
    return null
  }
  return sessionId
}

app.get("/sessions/:sessionId", (req, res) => {
  const sessionId = sessionIdOr400(req, res)
  if (!sessionId) return
  res.json(getState(sessionId))
})

app.post("/sessions/:sessionId/start", async (req, res) => {
  const sessionId = sessionIdOr400(req, res)
  if (!sessionId) return
  try {
    res.json(await startSession(config, sessionId))
  } catch (error) {
    logger.error({ sessionId, err: error?.message }, "[api] start failed")
    res.status(500).json({ error: "Failed to start the session." })
  }
})

app.post("/sessions/:sessionId/logout", async (req, res) => {
  const sessionId = sessionIdOr400(req, res)
  if (!sessionId) return
  try {
    res.json(await logout(config, sessionId))
  } catch (error) {
    logger.error({ sessionId, err: error?.message }, "[api] logout failed")
    res.status(500).json({ error: "Failed to log the session out." })
  }
})

app.post("/sessions/:sessionId/messages", async (req, res) => {
  const sessionId = sessionIdOr400(req, res)
  if (!sessionId) return

  const { to, text } = req.body ?? {}
  if (typeof to !== "string" || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "`to` and a non-empty `text` are required." })
  }

  try {
    const id = await sendText(sessionId, to, text)
    res.json({ ok: true, id })
  } catch (error) {
    const status = error?.statusCode ?? 500
    // Message bodies are never logged - they are customer conversation
    // content, and the recipient number is enough to trace a failure.
    logger.warn({ sessionId, to, status, err: error?.message }, "[api] send failed")
    res.status(status).json({ error: error?.message ?? "Send failed." })
  }
})

const port = Number(process.env.PORT ?? 3010)
app.listen(port, () => {
  logger.info({ port, engine: "baileys-noweb" }, "[gateway] listening")
})
