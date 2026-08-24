"use client"

import * as React from "react"
import { Loader2, RefreshCw, Unplug, TriangleAlert, CircleCheck, MessageCircle, Bot } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { LeadScoreBadge } from "@/components/leads/lead-score-badge"

/**
 * Talks directly to the local WhatsApp demo bridge (tools/whatsapp-demo-
 * bridge/) - a temporary, isolated demo tool, NOT the production WhatsApp
 * Cloud API integration (that's ConnectionCard, above this tab). Only
 * meaningful when both the dashboard and the bridge are running on the
 * same machine (see that folder's README) - this card degrades to an
 * honest "bridge not reachable" state otherwise, it never fakes a
 * connection.
 */
const BRIDGE_URL = process.env.NEXT_PUBLIC_WHATSAPP_BRIDGE_URL || "http://localhost:4001"

type BridgeStatus = "initializing" | "qr_required" | "authenticated" | "ready" | "disconnected" | "error"

interface BridgeState {
  status: BridgeStatus
  qrDataUrl: string | null
  identity: { number: string | null; name: string | null } | null
  lastError: string | null
}

interface ConversationSummary {
  chatId: string
  contactName: string | null
  leadScore: number
  leadStatus: string
  lastInboundText: string | null
  lastReplyText: string | null
}

const STATUS_LABEL: Record<BridgeStatus, string> = {
  initializing: "Starting…",
  qr_required: "Scan to connect",
  authenticated: "Connecting…",
  ready: "WhatsApp Connected",
  disconnected: "Disconnected",
  error: "Error",
}

export function QrDemoConnectionCard() {
  const [bridgeReachable, setBridgeReachable] = React.useState<boolean | null>(null)
  const [state, setState] = React.useState<BridgeState | null>(null)
  const [conversation, setConversation] = React.useState<ConversationSummary | null>(null)
  const [autoReply, setAutoReply] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  // Defined inside the effect (not a component-level useCallback called
  // directly from it) - the async work and its setState calls only ever
  // run from the interval/timeout callbacks below, never synchronously
  // from the effect body itself.
  React.useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const [statusRes, demoRes, settingsRes] = await Promise.all([
          fetch(`${BRIDGE_URL}/status`),
          fetch(`${BRIDGE_URL}/demo-state`),
          fetch(`${BRIDGE_URL}/settings`),
        ])
        const statusData = await statusRes.json()
        const demoData = await demoRes.json()
        const settingsData = await settingsRes.json()
        if (cancelled) return
        setState(statusData)
        setConversation(demoData?.conversation ?? null)
        setAutoReply(Boolean(settingsData?.autoReply))
        setBridgeReachable(true)
      } catch {
        if (!cancelled) setBridgeReachable(false)
      }
    }

    const interval = setInterval(poll, 2000)
    const timeout = setTimeout(poll, 0)
    return () => {
      cancelled = true
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [])

  async function poll() {
    try {
      const [statusRes, demoRes, settingsRes] = await Promise.all([
        fetch(`${BRIDGE_URL}/status`),
        fetch(`${BRIDGE_URL}/demo-state`),
        fetch(`${BRIDGE_URL}/settings`),
      ])
      const statusData = await statusRes.json()
      const demoData = await demoRes.json()
      const settingsData = await settingsRes.json()
      setState(statusData)
      setConversation(demoData?.conversation ?? null)
      setAutoReply(Boolean(settingsData?.autoReply))
      setBridgeReachable(true)
    } catch {
      setBridgeReachable(false)
    }
  }

  async function handleReconnect() {
    setBusy(true)
    try {
      await fetch(`${BRIDGE_URL}/reconnect`, { method: "POST" })
      await poll()
    } catch {
      setBridgeReachable(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try {
      await fetch(`${BRIDGE_URL}/disconnect`, { method: "POST" })
      await poll()
    } catch {
      setBridgeReachable(false)
    } finally {
      setBusy(false)
    }
  }

  async function toggleAutoReply() {
    const next = !autoReply
    setAutoReply(next)
    try {
      await fetch(`${BRIDGE_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReply: next }),
      })
    } catch {
      // Best-effort - next poll() will reconcile the real value.
    }
  }

  return (
    <Card className="gap-4 px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            QR Demo Connection
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning-foreground dark:text-warning">DEMO</span>
          </span>
          <span className="text-xs text-muted-foreground">
            Demo connection — production deployments use the official WhatsApp Business integration.
          </span>
        </div>
        {state && (
          <StatusBadge tone={state.status === "ready" ? "success" : state.status === "error" ? "error" : "neutral"}>
            {STATUS_LABEL[state.status]}
          </StatusBadge>
        )}
      </div>

      {bridgeReachable === false ? (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground dark:text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Can&apos;t reach the local demo bridge at <code>{BRIDGE_URL}</code>. Start it with <code>npm start</code> in{" "}
            <code>tools/whatsapp-demo-bridge/</code> on this same machine (see its README).
          </span>
        </div>
      ) : bridgeReachable === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking demo bridge…
        </div>
      ) : (
        <>
          {state?.status === "qr_required" && state.qrDataUrl && (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/40 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.qrDataUrl} alt="WhatsApp QR code" className="size-48 rounded-lg bg-white p-2" />
              <p className="text-xs text-muted-foreground">Scan with WhatsApp → Linked Devices → Link a Device</p>
            </div>
          )}

          {state?.status === "ready" && (
            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
              <CircleCheck className="size-3.5 shrink-0" />
              {state.identity?.name || state.identity?.number
                ? `Connected as ${state.identity?.name ?? state.identity?.number}`
                : "Connected"}
            </div>
          )}

          {state?.status === "error" && state.lastError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {state.lastError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleReconnect} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {state?.status === "ready" ? "Reconnect" : "Refresh"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={handleDisconnect} disabled={busy}>
              <Unplug className="size-3.5" />
              Disconnect
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={toggleAutoReply}>
              <Bot className="size-3.5" />
              Auto-reply: {autoReply ? "On" : "Off"}
            </Button>
          </div>

          {conversation && (
            <div className="flex flex-col gap-2.5 rounded-xl bg-muted/40 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <MessageCircle className="size-3.5" />
                  {conversation.contactName ?? conversation.chatId}
                </span>
                <LeadScoreBadge score={conversation.leadScore} />
              </div>
              {conversation.lastInboundText && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground">Last incoming message</span>
                  <p className="line-clamp-2 text-xs text-foreground">{conversation.lastInboundText}</p>
                </div>
              )}
              {conversation.lastReplyText && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground">Last AI reply</span>
                  <p className="line-clamp-2 text-xs text-foreground">{conversation.lastReplyText}</p>
                </div>
              )}
              <span className="text-[11px] text-muted-foreground">Status: {conversation.leadStatus}</span>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
