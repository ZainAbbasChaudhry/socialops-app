"use client"

import * as React from "react"
import { Ban, CheckCircle2, Loader2, Search, ShieldAlert, UserRound, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

/**
 * The connected number's WhatsApp address book, plus the number check that
 * keeps campaign lists clean.
 *
 * Everything on screen comes from the gateway. When a capability is not
 * enabled for the workspace the server answers 403 and this panel says so in
 * plain words rather than showing an empty list, which would read as "you
 * have no contacts".
 */

interface Contact {
  id: string
  name: string | null
  phone: string | null
  isBlocked: boolean
  isBusiness: boolean
}

interface Response {
  contacts?: Contact[]
  can?: { block: boolean; check: boolean }
  error?: string
  blocked?: boolean
}

export function ContactsPanel() {
  const [data, setData] = React.useState<Response | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Number check keeps its own state - it is a separate capability and often
  // the only one a workspace has.
  const [checkNumber, setCheckNumber] = React.useState("")
  const [checking, setChecking] = React.useState(false)
  const [checkResult, setCheckResult] = React.useState<{ number: string; exists: boolean } | null>(null)

  const read = React.useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/contacts")
      const json: Response = await res.json()
      setData(json)
      if (!res.ok) setError(json.error ?? "Could not load contacts.")
      else setError(null)
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/whatsapp/contacts")
        const json: Response = await res.json()
        if (cancelled) return
        setData(json)
        if (!res.ok) setError(json.error ?? "Could not load contacts.")
      } catch {
        if (!cancelled) setError("Could not reach EasyLife.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggleBlock(contact: Contact) {
    setBusyId(contact.id)
    setError(null)
    try {
      const res = await fetch("/api/whatsapp/contacts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, blocked: !contact.isBlocked }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not update the contact.")
        return
      }
      // Re-read rather than flipping the row locally: the change is only real
      // once WhatsApp has it.
      await read()
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setBusyId(null)
    }
  }

  async function runCheck() {
    if (!checkNumber.trim()) return
    setChecking(true)
    setCheckResult(null)
    setError(null)
    try {
      const res = await fetch(`/api/whatsapp/contacts?check=${encodeURIComponent(checkNumber.trim())}`)
      const json = await res.json()
      if (!res.ok) setError(json.error ?? "Could not check that number.")
      else setCheckResult({ number: json.number, exists: json.exists })
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setChecking(false)
    }
  }

  const contacts = data?.contacts ?? []
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? contacts.filter(
        (c) => (c.name ?? "").toLowerCase().includes(needle) || (c.phone ?? "").includes(needle)
      )
    : contacts

  return (
    <div className="flex flex-col gap-4">
      {/* Number check ------------------------------------------------- */}
      {data?.can?.check !== false && (
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">Is this number on WhatsApp?</h3>
          <p className="text-xs text-muted-foreground">
            Check before you spend a message on it. Keeps campaign lists clean.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={checkNumber}
              onChange={(e) => setCheckNumber(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runCheck()}
              placeholder="+92 300 1234567"
              className="h-9 max-w-xs text-sm"
            />
            <Button size="sm" onClick={() => void runCheck()} disabled={checking || !checkNumber.trim()}>
              {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Check
            </Button>
          </div>
          {checkResult && (
            <p
              className={`flex items-center gap-1.5 text-xs font-medium ${
                checkResult.exists ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
              }`}
            >
              {checkResult.exists ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
              {checkResult.number} {checkResult.exists ? "is on WhatsApp" : "is not on WhatsApp"}
            </p>
          )}
        </div>
      )}

      {/* Directory ---------------------------------------------------- */}
      <div className="flex flex-col rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">Contacts</span>
            <span className="text-xs text-muted-foreground">
              {loading ? "Loading…" : `${contacts.length} on the connected number`}
            </span>
          </div>
          {contacts.length > 0 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 max-w-48 text-xs"
            />
          )}
        </div>

        {error && (
          <p className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive sm:mx-5">
            <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        )}

        {loading && (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-5">
            <Loader2 className="size-4 animate-spin" /> Loading contacts…
          </p>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
            {contacts.length === 0
              ? "No contacts yet. They appear once a number is connected and has synced."
              : `Nothing matches “${query}”.`}
          </p>
        )}

        {filtered.length > 0 && (
          <ul className="border-t border-foreground/10">
            {filtered.slice(0, 300).map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 border-b border-foreground/5 px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <UserRound className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 truncate text-sm text-foreground">
                      {c.name ?? c.phone ?? c.id}
                      {c.isBusiness && <Badge variant="outline">Business</Badge>}
                      {c.isBlocked && <Badge className="bg-destructive/10 text-destructive">Blocked</Badge>}
                    </span>
                    {c.name && c.phone && (
                      <span className="truncate text-xs tabular-nums text-muted-foreground">{c.phone}</span>
                    )}
                  </div>
                </div>

                {data?.can?.block && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === c.id}
                    onClick={() => void toggleBlock(c)}
                    className="shrink-0"
                  >
                    {busyId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
                    {c.isBlocked ? "Unblock" : "Block"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {filtered.length > 300 && (
          <p className="px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
            Showing the first 300 of {filtered.length}. Search to narrow it down.
          </p>
        )}
      </div>
    </div>
  )
}
