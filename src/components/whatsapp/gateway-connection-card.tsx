"use client"

import * as React from "react"
import Image from "next/image"
import { Loader2, QrCode, Smartphone, Unplug, RefreshCw, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge"
import { WhatsAppIcon } from "@/components/whatsapp/whatsapp-icon"

/**
 * EasyLife's WhatsApp connection card.
 *
 * Two ways to link a client's number, both EasyLife-branded end to end:
 *  - scan a QR code from the phone, or
 *  - enter an 8-character pairing code, for when nobody can point a camera at
 *    the screen (remote onboarding, a phone already in someone's hand).
 *
 * Which methods appear is decided by the workspace's entitlements, returned
 * with the session state - so a client only ever sees the options EasyLife
 * has actually enabled for them.
 */

type Status = "disconnected" | "connecting" | "qr" | "connected" | "error"

interface SessionView {
  accountId: string
  status: Status
  qr: string | null
  connectedNumber: string | null
  lastError: string | null
  stale: boolean
  methods: { qr: boolean; pairingCode: boolean }
}

interface SessionResponse {
  configured: boolean
  message?: string
  session?: SessionView
  pairingCode?: string
  error?: string
}

const STATUS_COPY: Record<Status, { label: string; tone: StatusTone }> = {
  disconnected: { label: "Not connected", tone: "neutral" },
  connecting: { label: "Connecting", tone: "info" },
  qr: { label: "Waiting for scan", tone: "warning" },
  connected: { label: "Connected", tone: "success" },
  error: { label: "Connection problem", tone: "error" },
}

/** While a QR is on screen it expires and is replaced every ~20s, so the card
 * polls. Once connected there is nothing to watch that closely. */
const POLL_WHILE_PAIRING_MS = 4000
const POLL_WHEN_SETTLED_MS = 30000

export function GatewayConnectionCard() {
  const [state, setState] = React.useState<SessionResponse | null>(null)
  const [busy, setBusy] = React.useState<"connect" | "pairing" | "disconnect" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<"qr" | "pairing-code">("qr")
  const [phone, setPhone] = React.useState("")
  const [pairingCode, setPairingCode] = React.useState<string | null>(null)

  /** Nudges the poller to fetch immediately - used after Connect/Unlink so
   * the card reflects the new state without waiting for the next tick. */
  const [refreshKey, setRefreshKey] = React.useState(0)
  const load = React.useCallback(() => setRefreshKey((k) => k + 1), [])

  /**
   * One self-scheduling poller rather than a fixed interval: the delay
   * depends on the state that has just arrived, and a QR expires and is
   * replaced roughly every 20 seconds, so pairing needs a much tighter loop
   * than a settled connection. State is set from the async callback, never
   * synchronously in the effect body.
   */
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      let next: SessionResponse | null = null
      try {
        const res = await fetch("/api/whatsapp/session")
        next = (await res.json()) as SessionResponse
      } catch {
        if (!cancelled) setError("Couldn't reach EasyLife. Check your connection and try again.")
      }

      if (cancelled) return
      if (next) {
        setState(next)
        // A completed pairing makes the code meaningless - drop it rather
        // than leaving a dead code on screen.
        if (next.session?.status === "connected") setPairingCode(null)
      }

      const pairing = next?.session?.status === "qr" || next?.session?.status === "connecting"
      timer = setTimeout(() => void tick(), pairing ? POLL_WHILE_PAIRING_MS : POLL_WHEN_SETTLED_MS)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [refreshKey])

  async function connect(method: "qr" | "pairing-code") {
    setBusy(method === "qr" ? "connect" : "pairing")
    setError(null)
    setPairingCode(null)
    try {
      const res = await fetch("/api/whatsapp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, phoneNumber: method === "pairing-code" ? phone : undefined }),
      })
      const json: SessionResponse = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Couldn't start the connection.")
        return
      }
      if (json.pairingCode) setPairingCode(json.pairingCode)
      setState((prev) => ({ ...(prev ?? { configured: true }), ...json, configured: true }))
      load()
    } catch {
      setError("Couldn't start the connection.")
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!window.confirm("Unlink this WhatsApp number? Reconnecting will need a fresh QR scan. Your conversation history is kept.")) {
      return
    }
    setBusy("disconnect")
    setError(null)
    try {
      const res = await fetch("/api/whatsapp/session", { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? "Couldn't unlink the number.")
      setPairingCode(null)
      load()
    } catch {
      setError("Couldn't unlink the number.")
    } finally {
      setBusy(null)
    }
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-6 text-sm text-muted-foreground ring-1 ring-foreground/10">
        <Loader2 className="size-4 animate-spin" /> Checking your WhatsApp connection…
      </div>
    )
  }

  if (!state.configured) {
    return (
      <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">WhatsApp isn&apos;t set up yet</p>
            <p className="text-sm text-muted-foreground">
              {state.message ?? "Ask your EasyLife administrator to finish the WhatsApp setup for this workspace."}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const session = state.session
  if (!session) return null
  const copy = STATUS_COPY[session.status]
  const bothMethods = session.methods.qr && session.methods.pairingCode

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-[#25D366]/10">
            <WhatsAppIcon size={20} />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">EasyLife WhatsApp</span>
            <span className="text-xs text-muted-foreground">
              {session.connectedNumber ? `+${session.connectedNumber}` : "No number linked yet"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Never claim "connected" from a stale read - say so instead. */}
          {session.stale && <span className="text-xs text-muted-foreground">last known state</span>}
          <StatusBadge tone={copy.tone}>{copy.label}</StatusBadge>
        </div>
      </div>

      {(error || session.lastError) && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error ?? session.lastError}</p>
      )}

      {session.status === "connected" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={busy === "disconnect"}>
            {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
            Unlink number
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {bothMethods && (
            <div className="flex gap-1 rounded-lg bg-muted p-1 sm:max-w-xs">
              <button
                type="button"
                onClick={() => setMode("qr")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === "qr" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <QrCode className="size-3.5" /> Scan QR
              </button>
              <button
                type="button"
                onClick={() => setMode("pairing-code")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === "pairing-code" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Smartphone className="size-3.5" /> Use a code
              </button>
            </div>
          )}

          {(mode === "qr" || !session.methods.pairingCode) && session.methods.qr && (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="flex size-44 shrink-0 items-center justify-center rounded-xl bg-white p-2 ring-1 ring-foreground/10">
                {session.qr ? (
                  <Image src={session.qr} alt="WhatsApp pairing QR code" width={160} height={160} unoptimized className="size-40" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                    {busy === "connect" || session.status === "connecting" ? (
                      <>
                        <Loader2 className="size-5 animate-spin" />
                        Preparing your code…
                      </>
                    ) : (
                      <>
                        <QrCode className="size-6" strokeWidth={1.5} />
                        Press Connect to get a code
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-medium text-foreground">Link by scanning</p>
                <ol className="flex list-decimal flex-col gap-1 pl-4 text-muted-foreground">
                  <li>Open WhatsApp on the phone</li>
                  <li>Tap <span className="text-foreground">Settings → Linked devices</span></li>
                  <li>Tap <span className="text-foreground">Link a device</span> and scan this code</li>
                </ol>
                <Button size="sm" className="mt-1 self-start" onClick={() => void connect("qr")} disabled={busy !== null}>
                  {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
                  {session.qr ? "New code" : "Connect"}
                </Button>
              </div>
            </div>
          )}

          {mode === "pairing-code" && session.methods.pairingCode && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-medium text-foreground">Link with a code</p>
                <p className="text-muted-foreground">
                  Enter the WhatsApp number with its country code. EasyLife gives you an 8-character code to type into
                  the phone — no camera needed.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="923001234567"
                  inputMode="tel"
                  className="sm:max-w-52"
                />
                <Button size="sm" onClick={() => void connect("pairing-code")} disabled={busy !== null || phone.trim().length < 8}>
                  {busy === "pairing" ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                  Get code
                </Button>
              </div>
              {pairingCode && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-4 py-3">
                  <span className="text-xs text-muted-foreground">Type this into WhatsApp on the phone</span>
                  <span className="font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">{pairingCode}</span>
                  <span className="text-xs text-muted-foreground">
                    WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead
                  </span>
                </div>
              )}
            </div>
          )}

          {!session.methods.qr && !session.methods.pairingCode && (
            <p className="text-sm text-muted-foreground">
              No WhatsApp connection method is enabled for this workspace. Contact your EasyLife administrator.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
