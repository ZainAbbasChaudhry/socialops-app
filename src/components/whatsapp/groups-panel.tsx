"use client"

import * as React from "react"
import { Copy, Link2, Loader2, LogOut, Plus, ShieldAlert, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

/**
 * WhatsApp groups the connected number belongs to.
 *
 * Two things here are irreversible from EasyLife's side and are treated as
 * such: creating a group messages everyone added to it, and leaving one loses
 * the number's place in it. Both ask for confirmation and neither reports
 * success until the gateway has confirmed it.
 */

interface Group {
  id: string
  subject: string | null
  description: string | null
  participantCount: number | null
  isAdmin: boolean
}

interface Response {
  groups?: Group[]
  can?: { create: boolean; invite: boolean; leave: boolean }
  error?: string
}

export function GroupsPanel() {
  const [data, setData] = React.useState<Response | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [invites, setInvites] = React.useState<Record<string, string>>({})
  const [confirmLeave, setConfirmLeave] = React.useState<string | null>(null)

  const [creating, setCreating] = React.useState(false)
  const [subject, setSubject] = React.useState("")
  const [numbers, setNumbers] = React.useState("")

  const read = React.useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/groups")
      const json: Response = await res.json()
      setData(json)
      setError(res.ok ? null : (json.error ?? "Could not load groups."))
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
        const res = await fetch("/api/whatsapp/groups")
        const json: Response = await res.json()
        if (cancelled) return
        setData(json)
        if (!res.ok) setError(json.error ?? "Could not load groups.")
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

  const parsedNumbers = numbers
    .split(/[\s,;\n]+/)
    .map((n) => n.replace(/[^\d+]/g, ""))
    .filter((n) => n.replace(/\D/g, "").length >= 5)

  async function create() {
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/whatsapp/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), participants: parsedNumbers }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not create the group.")
        return
      }
      setNotice(`Group “${subject.trim()}” created with ${parsedNumbers.length} participants.`)
      setSubject("")
      setNumbers("")
      await read()
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setCreating(false)
    }
  }

  async function fetchInvite(group: Group) {
    setBusy(group.id)
    setError(null)
    try {
      const res = await fetch(`/api/whatsapp/groups?invite=${encodeURIComponent(group.id)}`)
      const json = await res.json()
      if (!res.ok) setError(json.error ?? "Could not get the invite link.")
      else if (json.inviteUrl) setInvites((prev) => ({ ...prev, [group.id]: json.inviteUrl }))
      else setError("The gateway returned no invite link for that group.")
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setBusy(null)
    }
  }

  async function leave(group: Group) {
    setBusy(group.id)
    setError(null)
    try {
      const res = await fetch("/api/whatsapp/groups", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: group.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not leave the group.")
        return
      }
      setNotice(`Left “${group.subject ?? "the group"}”.`)
      setConfirmLeave(null)
      await read()
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setBusy(null)
    }
  }

  const groups = data?.groups ?? []

  return (
    <div className="flex flex-col gap-4">
      {data?.can?.create && (
        <div className="flex flex-col gap-2.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">Create a group</h3>
          <p className="text-xs text-muted-foreground">
            Everyone you add is messaged by WhatsApp straight away, so check the list before creating.
          </p>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Group name"
            className="h-9 max-w-sm text-sm"
          />
          <textarea
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            placeholder="Phone numbers, one per line or comma separated"
            rows={3}
            className="w-full rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void create()}
              disabled={creating || !subject.trim() || parsedNumbers.length === 0}
            >
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Create group
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {parsedNumbers.length} valid {parsedNumbers.length === 1 ? "number" : "numbers"}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="flex flex-col gap-0.5 px-4 py-3.5 sm:px-5">
          <span className="text-sm font-semibold text-foreground">Groups</span>
          <span className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${groups.length} on the connected number`}
          </span>
        </div>

        {error && (
          <p className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive sm:mx-5">
            <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mx-4 mb-3 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground sm:mx-5">{notice}</p>
        )}

        {loading && (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-5">
            <Loader2 className="size-4 animate-spin" /> Loading groups…
          </p>
        )}

        {!loading && !error && groups.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
            No groups yet on the connected number.
          </p>
        )}

        {groups.length > 0 && (
          <ul className="border-t border-foreground/10">
            {groups.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 border-b border-foreground/5 px-4 py-3 last:border-b-0 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                        {g.subject ?? "Untitled group"}
                        {g.isAdmin && <Badge variant="outline">Admin</Badge>}
                      </span>
                      {g.description && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">{g.description}</span>
                      )}
                      {g.participantCount !== null && (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {g.participantCount} participants
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {data?.can?.invite && (
                      <Button size="sm" variant="ghost" disabled={busy === g.id} onClick={() => void fetchInvite(g)}>
                        {busy === g.id ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
                        Invite link
                      </Button>
                    )}
                    {data?.can?.leave &&
                      (confirmLeave === g.id ? (
                        <>
                          <Button size="sm" variant="destructive" disabled={busy === g.id} onClick={() => void leave(g)}>
                            Confirm leave
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(g.id)}>
                          <LogOut className="size-3.5" />
                          Leave
                        </Button>
                      ))}
                  </div>
                </div>

                {invites[g.id] && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-foreground">{invites[g.id]}</code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void navigator.clipboard?.writeText(invites[g.id])}
                    >
                      <Copy className="size-3.5" />
                      Copy
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
