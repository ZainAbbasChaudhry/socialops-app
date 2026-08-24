const path = require("node:path")
const QRCode = require("qrcode")
const { Client, LocalAuth } = require("whatsapp-web.js")

const SESSION_DIR = path.join(__dirname, "..", ".wwebjs_auth")

/**
 * Thin state-machine wrapper around whatsapp-web.js. Never exposes
 * anything session/credential-shaped - only a status string, the latest
 * QR as a data URL, and a safe "identity" (number + display name) once
 * authenticated. LocalAuth persists the session under .wwebjs_auth/ (a
 * gitignored, local-only folder) so a dashboard refresh doesn't force a
 * re-scan.
 */
class WhatsAppBridge {
  constructor() {
    this.status = "initializing" // initializing | qr_required | authenticated | ready | disconnected | error
    this.qrDataUrl = null
    this.identity = null
    this.lastError = null
    this.onMessage = null // set by message-handler.js
    this.client = null
  }

  async start() {
    if (this.client) return
    this.status = "initializing"
    this.lastError = null

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      },
    })

    this.client.on("qr", async (qr) => {
      this.status = "qr_required"
      this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, scale: 6 })
    })

    this.client.on("authenticated", () => {
      this.status = "authenticated"
      this.qrDataUrl = null
    })

    this.client.on("auth_failure", (message) => {
      this.status = "error"
      this.lastError = `Authentication failed: ${message}`
    })

    this.client.on("ready", () => {
      this.status = "ready"
      this.qrDataUrl = null
      const info = this.client.info
      this.identity = info ? { number: info.wid?.user ?? null, name: info.pushname ?? null } : null
    })

    this.client.on("disconnected", (reason) => {
      this.status = "disconnected"
      this.identity = null
      this.lastError = reason ? String(reason) : null
    })

    this.client.on("message", async (msg) => {
      if (typeof this.onMessage === "function") {
        try {
          await this.onMessage(msg)
        } catch (error) {
          console.error("[whatsapp-bridge] message handler error:", error instanceof Error ? error.message : error)
        }
      }
    })

    try {
      await this.client.initialize()
    } catch (error) {
      this.status = "error"
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  async disconnect() {
    if (!this.client) return
    try {
      await this.client.logout()
    } catch (error) {
      console.error("[whatsapp-bridge] logout error:", error instanceof Error ? error.message : error)
    }
    try {
      await this.client.destroy()
    } catch {
      // already torn down - fine
    }
    this.client = null
    this.status = "disconnected"
    this.qrDataUrl = null
    this.identity = null
  }

  async reconnect() {
    await this.disconnect()
    await this.start()
  }

  getState() {
    return {
      status: this.status,
      qrDataUrl: this.status === "qr_required" ? this.qrDataUrl : null,
      identity: this.identity,
      lastError: this.lastError,
    }
  }
}

module.exports = { WhatsAppBridge }
