"use client"

import * as React from "react"
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"

/**
 * What the business actually sells, and for how much.
 *
 * This is the screen that decides whether the WhatsApp bot can answer a
 * customer or only interrogate them. Everything here is quoted back to
 * customers verbatim, so it is written to be edited by the business owner,
 * not by a developer: no JSON, no schema, one row per thing you might be
 * asked about.
 *
 * Empty is a real state with real consequences, and the panel says so rather
 * than showing a blank list: with nothing here the bot will not quote a
 * price at all - it says it will check with the team.
 */

const KINDS = ["service", "price", "faq", "policy"] as const
type Kind = (typeof KINDS)[number]

const KIND_LABEL: Record<Kind, string> = {
  service: "Service",
  price: "Price",
  faq: "FAQ",
  policy: "Policy",
}

const KIND_HINT: Record<Kind, string> = {
  service: "Something you offer. Title is its name, body is what it includes.",
  price: "What something costs. The bot quotes this exactly as written.",
  faq: "A question customers ask, and the answer you want given.",
  policy: "Refunds, delivery times, working hours - anything you commit to.",
}

interface Entry {
  id: string
  kind: Kind
  title: string
  body: string
  price: string | null
  keywords: string[]
  active: boolean
  sortOrder: number
  updatedAt: string
}

interface Draft {
  id?: string
  kind: Kind
  title: string
  body: string
  price: string
  keywords: string
  active: boolean
  sortOrder: number
}

const EMPTY_DRAFT: Draft = { kind: "price", title: "", body: "", price: "", keywords: "", active: true, sortOrder: 0 }

function draftFrom(entry: Entry): Draft {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    price: entry.price ?? "",
    keywords: entry.keywords.join(", "),
    active: entry.active,
    sortOrder: entry.sortOrder,
  }
}

export function KnowledgeBasePanel() {
  const [entries, setEntries] = React.useState<Entry[]>([])
  const [canEdit, setCanEdit] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const read = React.useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge")
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not load the knowledge base.")
        return
      }
      setEntries(json.entries ?? [])
      setCanEdit(json.canEdit === true)
      setError(null)
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      await read()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [read])

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          price: draft.price || null,
          keywords: draft.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          active: draft.active,
          sortOrder: draft.sortOrder,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not save that entry.")
        return
      }
      setDraft(null)
      await read()
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch("/api/knowledge", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? "Could not delete that entry.")
        return
      }
      await read()
    } catch {
      setError("Could not reach EasyLife.")
    } finally {
      setBusyId(null)
    }
  }

  async function toggleActive(entry: Entry) {
    setBusyId(entry.id)
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...entry, price: entry.price, active: !entry.active }),
      })
      await read()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your knowledge base…
      </div>
    )
  }

  const activeCount = entries.filter((e) => e.active).length

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <h3 className="font-medium">Your services, prices and answers</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                The WhatsApp bot answers customers from exactly what is here — nothing else. Prices are
                quoted word for word. If a customer asks something this list does not cover, the bot says
                it will check with your team instead of guessing.
              </p>
            </div>
          </div>
          {canEdit ? (
            <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })} disabled={draft !== null}>
              <Plus className="mr-1.5 h-4 w-4" /> Add entry
            </Button>
          ) : null}
        </div>

        {!canEdit ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Only a workspace owner or admin can change these — an entry here is a price your business
            commits to in public.
          </p>
        ) : null}

        {entries.length > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {activeCount} of {entries.length} {entries.length === 1 ? "entry is" : "entries are"} switched on
            and being used by the bot right now.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {draft ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant={draft.kind === kind ? "default" : "outline"}
                onClick={() => setDraft({ ...draft, kind })}
              >
                {KIND_LABEL[kind]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{KIND_HINT[draft.kind]}</p>

          <Input
            placeholder={draft.kind === "faq" ? "The question, as a customer would ask it" : "Name of the service or item"}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            maxLength={200}
          />
          <Textarea
            placeholder="What the bot should say. Write it the way you would say it to a customer."
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            rows={4}
            maxLength={4000}
          />
          <Input
            placeholder='Price (optional) — e.g. "PKR 30,000", "from $50/month", "depends on scope"'
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            maxLength={120}
          />
          <Input
            placeholder="Other words customers use for this, comma separated — rate, charges, fees"
            value={draft.keywords}
            onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
          />

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} />
              Bot can use this
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Order
              <Input
                type="number"
                className="h-8 w-20"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
              />
              <span className="text-xs">higher shows first</span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !draft.title.trim() || !draft.body.trim()}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {draft.id ? "Save changes" : "Add to knowledge base"}
            </Button>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {entries.length === 0 && !draft ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing here yet. Until you add your services and prices, the bot can ask customers questions but
          cannot answer them — it will offer to check with your team instead.
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`rounded-lg border p-3 ${entry.active ? "" : "opacity-60"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{KIND_LABEL[entry.kind]}</Badge>
                  <span className="font-medium">{entry.title}</span>
                  {entry.price ? <Badge>{entry.price}</Badge> : null}
                  {!entry.active ? <Badge variant="secondary">Off</Badge> : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{entry.body}</p>
                {entry.keywords.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Also matches: {entry.keywords.join(", ")}</p>
                ) : null}
              </div>

              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={entry.active}
                    disabled={busyId === entry.id}
                    onCheckedChange={() => void toggleActive(entry)}
                  />
                  <Button size="sm" variant="outline" onClick={() => setDraft(draftFrom(entry))}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === entry.id}
                    onClick={() => void remove(entry.id)}
                    aria-label={`Delete ${entry.title}`}
                  >
                    {busyId === entry.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
