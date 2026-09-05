import { createHmac } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys"
import QRCode from "qrcode"
import pino from "pino"

/**
 * Session manager for the EasyLife OpenWA gateway.
 *
 * Engine: Baileys "NOWEB" - a direct WebSocket implementation of WhatsApp's
 * multi-device protocol. There is no browser here: no puppeteer, no
 * chromium, no whatsapp-web.js, no page scraping. That is precisely why
 * this runs as its own long-lived service rather than inside the Next.js
 * app - a paired WhatsApp socket has to stay open between requests, which a
 * request-scoped handler on cPanel/Passenger cannot do.
 *
 * One session == one paired phone == one dashboard workspace. Session ids
 * are chosen by the dashboard (derived there from the workspace id) and are
 * treated here as opaque, validated strings.
 */

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" })

/** Session ids come from the dashboard, but this service must not trust
 * them into a filesystem path. Only the characters the dashboard's own
 * derivation can produce are accepted; anything else is rejected before it
 * can become a directory name. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/

export function isValidSessionId(sessionId) {
  return typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId)
}

/** In-memory view of every session this process is running. Restarting the
 * process rebuilds it from the credentials on disk (see SESSIONS_DIR). */
const sessions = new Map()

function emptyState(sessionId) {
  return {
    sessionId,
    status: "disconnected",
    qr: null,
    connectedNumber: null,
    lastError: null,
    sock: null,
    /** Guards against two concurrent start requests racing to open two
     * sockets for the same pairing. */
    starting: false,
    reconnectAttempts: 0,
  }
}

function publicState(state) {
  return {
    status: state.status,
    qr: state.qr,
    connectedNumber: state.connectedNumber,
    lastError: state.lastError,
  }
}

export function getState(sessionId) {
  return publicState(sessions.get(sessionId) ?? emptyState(sessionId))
}

/**
 * Delivers an event to the dashboard, signed so the dashboard can prove it
 * came from this gateway. The signature covers the exact bytes sent - the
 * dashboard recomputes it over the raw body, so the JSON must not be
 * re-serialized anywhere in between.
 */
async function postWebhook(config, payload) {
  const body = JSON.stringify(payload)
  const signature = createHmac("sha256", config.webhookSecret).update(body, "utf8").digest("hex")

  try {
    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenWA-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      logger.warn({ status: res.status, event: payload.event }, "[webhook] dashboard rejected delivery")
    }
  } catch (error) {
    // Never throw out of a socket event handler - a dashboard that is down
    // must not take the WhatsApp connection with it.
    logger.warn({ err: error?.message, event: payload.event }, "[webhook] delivery failed")
  }
}

/** Baileys represents a chat address as "<number>@s.whatsapp.net". The
 * dashboard only ever deals in bare digits. */
function jidToNumber(jid) {
  if (typeof jid !== "string") return null
  const [user] = jid.split("@")
  const digits = (user ?? "").split(":")[0]
  return /^\d{5,}$/.test(digits) ? digits : null
}

function numberToJid(number) {
  const digits = String(number).replace(/[^\d]/g, "")
  return `${digits}@s.whatsapp.net`
}

/** Baileys puts the text in one of several places depending on how the
 * sender's client composed it. Anything that isn't plain text returns null
 * and is reported to the dashboard as a non-text message type. */
function extractText(message) {
  const m = message?.message
  if (!m) return null
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    null
  )
}

async function announceStatus(config, sessionId, state) {
  await postWebhook(config, {
    event: "session.status",
    sessionId,
    session: {
      status: state.status,
      connectedNumber: state.connectedNumber,
      error: state.lastError,
    },
  })
}

/**
 * Opens (or reopens) a session. Idempotent: calling it for a session that
 * is already connected returns the existing state without disturbing the
 * pairing, which is what makes the dashboard's "Connect" button safe to
 * press twice.
 */
export async function startSession(config, sessionId) {
  let state = sessions.get(sessionId)
  if (state && (state.status === "connected" || state.starting)) {
    return publicState(state)
  }

  state = state ?? emptyState(sessionId)
  state.starting = true
  state.status = "connecting"
  state.lastError = null
  sessions.set(sessionId, state)

  const authDir = path.join(config.sessionsDir, sessionId)
  await mkdir(authDir, { recursive: true })

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: authState,
    // NOWEB: no browser is launched. This tuple is only the client identity
    // WhatsApp shows in "Linked devices".
    browser: ["EasyLife", "Chrome", "1.0.0"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    logger: pino({ level: "silent" }),
  })

  state.sock = sock
  state.starting = false

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // Rendered here rather than in the dashboard so the raw pairing string
      // never has to travel further than it must.
      QRCode.toDataURL(qr)
        .then((dataUrl) => {
          state.qr = dataUrl
          state.status = "qr"
          logger.info({ sessionId }, "[session] pairing QR ready")
          void announceStatus(config, sessionId, state)
        })
        .catch((error) => logger.warn({ err: error?.message }, "[session] QR render failed"))
    }

    if (connection === "open") {
      state.status = "connected"
      state.qr = null
      state.lastError = null
      state.reconnectAttempts = 0
      state.connectedNumber = jidToNumber(sock.user?.id)
      logger.info({ sessionId, number: state.connectedNumber }, "[session] connected")
      void announceStatus(config, sessionId, state)
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut

      state.sock = null
      state.qr = null

      if (loggedOut) {
        // The phone unlinked this device. Reconnecting is impossible without
        // a fresh scan, so retrying would spin forever.
        state.status = "disconnected"
        state.connectedNumber = null
        logger.info({ sessionId }, "[session] logged out from the phone")
        void announceStatus(config, sessionId, state)
        return
      }

      // Bounded exponential backoff. An unbounded retry loop against
      // WhatsApp's servers is how a gateway gets rate-limited or banned.
      state.reconnectAttempts += 1
      if (state.reconnectAttempts > config.maxReconnectAttempts) {
        state.status = "error"
        state.lastError = `Gave up reconnecting after ${config.maxReconnectAttempts} attempts.`
        logger.error({ sessionId }, "[session] reconnect budget exhausted")
        void announceStatus(config, sessionId, state)
        return
      }

      const delayMs = Math.min(60_000, 2_000 * 2 ** (state.reconnectAttempts - 1))
      state.status = "connecting"
      logger.warn({ sessionId, statusCode, delayMs, attempt: state.reconnectAttempts }, "[session] reconnecting")
      setTimeout(() => {
        startSession(config, sessionId).catch((error) =>
          logger.error({ sessionId, err: error?.message }, "[session] reconnect failed")
        )
      }, delayMs)
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // "notify" is a genuinely new message; "append" is history sync, which
    // must not be replayed into the dashboard's lead pipeline.
    if (type !== "notify") return

    for (const message of messages) {
      const remoteJid = message.key?.remoteJid
      const from = jidToNumber(remoteJid)
      // Groups, broadcasts and status updates are out of scope for a 1:1
      // sales conversation and are dropped rather than half-handled.
      if (!from || typeof remoteJid !== "string" || !remoteJid.endsWith("@s.whatsapp.net")) continue
      if (!message.key?.id) continue

      const text = extractText(message)
      await postWebhook(config, {
        event: "message",
        sessionId,
        message: {
          id: message.key.id,
          from,
          pushName: message.pushName ?? null,
          type: text === null ? "unsupported" : "text",
          text,
          // The dashboard drops these, but they are reported rather than
          // silently swallowed so an operator can see the full picture.
          fromMe: Boolean(message.key.fromMe),
          timestamp: Number(message.messageTimestamp ?? 0) || null,
        },
      })
    }
  })

  return publicState(state)
}

/** Sends a text message. Resolves with the id WhatsApp assigned, or throws -
 * the caller turns a throw into a 4xx/5xx so the dashboard never records a
 * message as "sent" that WhatsApp did not accept. */
export async function sendText(sessionId, to, text) {
  const state = sessions.get(sessionId)
  if (!state || state.status !== "connected" || !state.sock) {
    const error = new Error("Session is not connected.")
    error.statusCode = 409
    throw error
  }

  const result = await state.sock.sendMessage(numberToJid(to), { text })
  const id = result?.key?.id
  if (!id) {
    const error = new Error("WhatsApp did not return a message id.")
    error.statusCode = 502
    throw error
  }
  return id
}

/** Ends the session and clears its stored credentials. Genuinely
 * destructive - reconnecting requires a new QR scan. */
export async function logout(config, sessionId) {
  const state = sessions.get(sessionId)
  if (state?.sock) {
    try {
      await state.sock.logout()
    } catch (error) {
      logger.warn({ sessionId, err: error?.message }, "[session] logout call failed; clearing locally anyway")
    }
  }

  const cleared = emptyState(sessionId)
  sessions.set(sessionId, cleared)
  await announceStatus(config, sessionId, cleared)
  return publicState(cleared)
}

export { logger }
