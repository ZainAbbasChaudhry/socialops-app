"use client"

import * as React from "react"
import { AlertTriangle, Loader2, Megaphone, Send, ShieldAlert, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Bulk campaigns.
 *
 * This screen is deliberately blunt about consequences. A bulk send goes from
 * the client's own WhatsApp number, WhatsApp bans numbers for careless bulk
 * messaging, and messages already handed over cannot be recalled. So:
 *
 *  - the recipient count and the duplicates removed are shown BEFORE sending,
 *    from the same parsing the server will do, so nobody discovers the real
 *    number afterwards;
 *  - sending needs a deliberate second click, not one button;
 *  - progress is whatever the gateway reports, never a local guess - a
 *    campaign screen that invents its own "sent" figure is worse than one
 *    that admits it doesn't know yet;
 *  - cancel says plainly that it stops what hasn't gone yet, not what has.
 */

const MAX_RECIPIENTS = 500

interface Batch {
  batchId: string
  state: string | null
  total: number | null
  sent: number | null
  failed: number | null
}

export function CampaignsPanel() {
  const [numbers, setNumbers] = React.useState("")
  const [text, setText] = React.useState("")
  const [armed, setArmed] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [batch, setBatch] = React.useState<Batch | null>(null)
  const [cancelling, setCancelling] = React.useState(false)

  // Same normalisation the server applies, so the count on screen is the count
  // that will actually be messaged.
  const { recipients, duplicates } = React.useMemo(() => {
    const raw = numbers
      .split(/[\s,;\n]+/)
      .map((n) => n.replace(/\D/g, ""))
      .filter((n) => n.length >= 5)
    const unique = [...new Set(raw)]
    return { recipients: unique, duplicates: raw.length - unique.length }
  }, [numbers])

  const tooMany = recipients.length > MAX_RECIPIENTS
  const ready = recipients.length > 0 && text.trim().length > 0 && !tooMany

  // Poll the gateway while a campaign is running. Stops as soon as it isn't.
  React.useEffect(() => {
    if (!batch?.batchId) return
    const running = !batch.state || /run|progress|pending|queue/i.test(batch.state)
    if (!running) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/whatsapp/campaigns?batchId=${encodeURIComponent(batch.batchId)}`)
        const json = await res.json()
        if (!cancelled && res.ok && json.batch) setBatch(json.batch)
      } catch {
        /* a missed poll is not worth an error banner - the next one retries */
      }
    }, 5000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [batch])

  async function send() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch("/api/whatsapp/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipients, text: text.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not start the campaign.")
        return
      }
      setBatch({
        batchId: json.batchId ?? "",
        state: "running",
        total: json.recipientCount ?? recipients.length,
        sent: null,
        failed: null,
      })
      setArmed(false)
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setSending(false)
    }
  }

  async function cancel() {
    if (!batch?.batchId) return
    setCancelling(true)
    setError(null)
    try {
      const res = await fetch("/api/whatsapp/campaigns", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchId: batch.batchId }),
      })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? "Could not cancel the campaign.")
      else setBatch((b) => (b ? { ...b, state: "cancelled" } : b))
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-300">
        <AlertTriangle className="mt-px size-4 shrink-0" strokeWidth={1.75} />
        <p>
          Bulk messages go from the client&apos;s own WhatsApp number. WhatsApp restricts or bans numbers for
          unsolicited bulk sending — message people who expect to hear from you, and keep lists small.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Megaphone className="size-4 text-muted-foreground" strokeWidth={1.75} />
          New campaign
        </h3>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground">Recipients</label>
          <textarea
            value={numbers}
            onChange={(e) => {
              setNumbers(e.target.value)
              setArmed(false)
            }}
            rows={4}
            placeholder="Phone numbers, one per line or comma separated"
            className="w-full rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{recipients.length}</span> will be messaged
            {duplicates > 0 && ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} removed`}
            {tooMany && (
              <span className="text-destructive"> · over the {MAX_RECIPIENTS} limit for one campaign</span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground">Message</label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setArmed(false)
            }}
            rows={4}
            maxLength={4096}
            placeholder="What everyone on the list will receive"
            className="w-full rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-xs tabular-nums text-muted-foreground">{text.trim().length} characters</p>
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        )}

        {/* Two deliberate steps, so nobody messages 400 people by reflex. */}
        {!armed ? (
          <Button size="sm" className="w-fit" disabled={!ready} onClick={() => setArmed(true)}>
            <Send className="size-3.5" />
            Review and send
          </Button>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-3">
            <p className="text-xs text-foreground">
              Send this message to <span className="font-semibold">{recipients.length}</span> people from the
              connected WhatsApp number? This cannot be undone once it starts.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={sending} onClick={() => void send()}>
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Yes, send now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArmed(false)} disabled={sending}>
                Go back
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Progress ------------------------------------------------------ */}
      {batch && (
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Campaign progress</h3>
            <span className="text-xs text-muted-foreground">{batch.state ?? "starting"}</span>
          </div>

          <div className="flex flex-wrap gap-4 text-xs tabular-nums">
            <span className="text-muted-foreground">
              Recipients <span className="font-semibold text-foreground">{batch.total ?? "—"}</span>
            </span>
            <span className="text-muted-foreground">
              Sent <span className="font-semibold text-foreground">{batch.sent ?? "—"}</span>
            </span>
            <span className="text-muted-foreground">
              Failed <span className="font-semibold text-foreground">{batch.failed ?? "—"}</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            These are the gateway&apos;s own numbers. A dash means it hasn&apos;t reported that figure yet —
            EasyLife does not estimate it.
          </p>

          {batch.batchId && !/cancel|complete|done|finish/i.test(batch.state ?? "") && (
            <Button size="sm" variant="outline" className="w-fit" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
              Stop remaining sends
            </Button>
          )}
          {/cancel/i.test(batch.state ?? "") && (
            <p className="text-xs text-muted-foreground">
              Stopped. Messages already delivered to WhatsApp cannot be recalled.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
