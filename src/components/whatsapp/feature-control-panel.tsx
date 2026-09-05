"use client"

import * as React from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Lock,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"

/**
 * EasyLife's WhatsApp capability control panel.
 *
 * This is where an EasyLife platform operator decides, per client workspace,
 * which WhatsApp capabilities that client may use. Every switch here maps to
 * real gateway routes: turning one off removes the capability server-side,
 * it does not merely hide a button. That is why the screen is deliberately
 * plain about consequences - the risk badge, the destructive warning and the
 * "not saved yet" state all exist so an operator is never surprised by what
 * a toggle actually did.
 *
 * A client's own team may open this screen and see exactly what their plan
 * includes, but every control is read-only for them: the save button is
 * absent and the switches do not move. Entitlements are sold by EasyLife,
 * not self-granted.
 */

type Risk = "standard" | "elevated" | "high" | "destructive"
type Engine = "baileys" | "whatsapp-web"

interface FeatureView {
  key: string
  label: string
  description: string
  category: string
  engine: "any" | Engine
  risk: Risk
  routes: string[]
  defaultEnabled: boolean
  platformOnly?: boolean
  note?: string
  enabled: boolean
  availableOnEngine: boolean
}

interface CategoryView {
  id: string
  label: string
  description: string
}

interface FeaturesResponse {
  workspace: { id: string; name: string }
  engine: Engine
  usingDefaults: boolean
  updatedAt: string | null
  categories: CategoryView[]
  features: FeatureView[]
  canEdit: boolean
  platformAdminConfigured: boolean
  error?: string
}

const RISK_STYLE: Record<Risk, { label: string; className: string }> = {
  standard: { label: "Standard", className: "bg-muted text-muted-foreground" },
  elevated: { label: "Elevated", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  high: { label: "High risk", className: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  destructive: { label: "Destructive", className: "bg-destructive/10 text-destructive" },
}

const ENGINE_LABEL: Record<Engine, string> = {
  baileys: "Baileys (NOWEB)",
  "whatsapp-web": "WhatsApp Web",
}

export function FeatureControlPanel() {
  const [data, setData] = React.useState<FeaturesResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  // The edited selection lives here; `data` keeps the last saved answer from
  // the server. Comparing the two is what makes "unsaved changes" honest
  // rather than a flag someone forgot to clear.
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [engine, setEngine] = React.useState<Engine>("baileys")

  /** Reads the workspace's entitlements. `showSpinner` is false when
   * re-reading after a save, so the whole panel doesn't blank out over a
   * refresh the operator didn't ask for. */
  const load = React.useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/whatsapp/features")
      const json: FeaturesResponse = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not load WhatsApp capabilities.")
        return
      }
      setData(json)
      setSelected(new Set(json.features.filter((f) => f.enabled).map((f) => f.key)))
      setEngine(json.engine)
    } catch {
      setError("Could not reach EasyLife to load WhatsApp capabilities.")
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [])

  // The first read is started from the effect but never writes state
  // synchronously inside it - state lands only once the request resolves,
  // and a late response from an unmounted panel is discarded.
  React.useEffect(() => {
    let cancelled = false
    async function first() {
      try {
        const res = await fetch("/api/whatsapp/features")
        const json: FeaturesResponse = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error ?? "Could not load WhatsApp capabilities.")
          return
        }
        setData(json)
        setSelected(new Set(json.features.filter((f) => f.enabled).map((f) => f.key)))
        setEngine(json.engine)
      } catch {
        if (!cancelled) setError("Could not reach EasyLife to load WhatsApp capabilities.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void first()
    return () => {
      cancelled = true
    }
  }, [])

  const savedKeys = React.useMemo(
    () => new Set(data?.features.filter((f) => f.enabled).map((f) => f.key) ?? []),
    [data]
  )

  const dirty =
    engine !== data?.engine ||
    selected.size !== savedKeys.size ||
    [...selected].some((k) => !savedKeys.has(k))

  const canEdit = data?.canEdit === true

  function toggle(feature: FeatureView, on: boolean) {
    if (!canEdit) return
    setNotice(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(feature.key)
      else next.delete(feature.key)
      return next
    })
  }

  /** Switching engine cannot silently keep a capability the new engine can't
   * perform - the server would reject the save anyway, so the incompatible
   * ones are dropped here and the operator is told which. */
  function changeEngine(next: Engine) {
    if (!canEdit || !data) return
    const incompatible = data.features.filter(
      (f) => selected.has(f.key) && f.engine !== "any" && f.engine !== next
    )
    setEngine(next)
    if (incompatible.length) {
      setSelected((prev) => {
        const s = new Set(prev)
        for (const f of incompatible) s.delete(f.key)
        return s
      })
      setNotice(
        `${incompatible.map((f) => f.label).join(", ")} turned off — not available on ${ENGINE_LABEL[next]}.`
      )
    }
  }

  function resetToSaved() {
    if (!data) return
    setSelected(new Set(data.features.filter((f) => f.enabled).map((f) => f.key)))
    setEngine(data.engine)
    setNotice(null)
    setError(null)
  }

  function applyDefaults() {
    if (!canEdit || !data) return
    setSelected(
      new Set(
        data.features
          .filter((f) => f.defaultEnabled && (f.engine === "any" || f.engine === engine))
          .map((f) => f.key)
      )
    )
    setNotice("Reset to EasyLife's recommended set. Nothing is saved until you press Save.")
  }

  async function save() {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/whatsapp/features", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledKeys: [...selected], engine }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Could not save. Nothing was changed.")
        return
      }
      // Re-reading is what confirms the save; the screen never congratulates
      // itself on a write it hasn't seen the server accept.
      await load(false)
      setNotice("Saved. These capabilities are live for this workspace now.")
    } catch {
      setError("Could not reach EasyLife to save. Nothing was changed.")
    } finally {
      setSaving(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const groups = React.useMemo(() => {
    if (!data) return []
    return data.categories
      .map((category) => ({
        category,
        features: data.features.filter(
          (f) =>
            f.category === category.id &&
            (needle === "" ||
              f.label.toLowerCase().includes(needle) ||
              f.description.toLowerCase().includes(needle) ||
              f.key.toLowerCase().includes(needle))
        ),
      }))
      .filter((g) => g.features.length > 0)
  }, [data, needle])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-6 text-sm text-muted-foreground ring-1 ring-foreground/10">
        <Loader2 className="size-4 animate-spin" />
        Loading WhatsApp capabilities…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-card px-4 py-6 ring-1 ring-foreground/10">
        <p className="text-sm text-destructive">{error ?? "Could not load WhatsApp capabilities."}</p>
        <Button variant="outline" size="sm" className="w-fit" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }

  const enabledCount = selected.size
  const totalCount = data.features.length

  return (
    <div className="flex flex-col gap-4">
      {/* Header ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SlidersHorizontal className="size-4 text-muted-foreground" strokeWidth={1.75} />
              WhatsApp capabilities
            </h3>
            <p className="max-w-xl text-xs text-muted-foreground">
              What <span className="font-medium text-foreground">{data.workspace.name}</span> can do with
              WhatsApp through EasyLife. Turning a capability off removes it entirely — not just its
              button.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{enabledCount}</span> of {totalCount} on
            </span>
          </div>
        </div>

        {/* Who may change this ---------------------------------------- */}
        {!canEdit && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <Lock className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            <p>
              This is a read-only view of your plan. Only an EasyLife administrator can change which
              WhatsApp capabilities are enabled — contact EasyLife to add or remove one.
            </p>
          </div>
        )}

        {canEdit && !data.platformAdminConfigured && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            <p>Platform administration is not configured on this server.</p>
          </div>
        )}

        {data.usingDefaults && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            <p>
              Nobody has configured this workspace yet — it is running on EasyLife&apos;s recommended
              defaults. Saving once makes the choice explicit.
            </p>
          </div>
        )}

        {/* Engine ------------------------------------------------------ */}
        <div className="flex flex-wrap items-center gap-2 border-t border-foreground/10 pt-3">
          <span className="text-xs font-medium text-foreground">Engine</span>
          {(Object.keys(ENGINE_LABEL) as Engine[]).map((value) => (
            <button
              key={value}
              type="button"
              disabled={!canEdit}
              onClick={() => changeEngine(value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                engine === value
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-background text-muted-foreground ring-foreground/15 hover:text-foreground"
              }`}
            >
              {ENGINE_LABEL[value]}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">
            Some capabilities exist on only one engine.
          </span>
        </div>

        {/* Search ------------------------------------------------------ */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search capabilities…"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Messages ---------------------------------------------------- */}
        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <Check className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            {notice}
          </p>
        )}

        {/* Actions ----------------------------------------------------- */}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-foreground/10 pt-3">
            <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={resetToSaved} disabled={!dirty || saving}>
              <RotateCcw className="size-3.5" />
              Discard changes
            </Button>
            <Button size="sm" variant="ghost" onClick={applyDefaults} disabled={saving}>
              Use recommended set
            </Button>
            {dirty && (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Unsaved — nothing has changed for this client yet.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Groups --------------------------------------------------------- */}
      {groups.length === 0 && (
        <p className="rounded-xl bg-card px-4 py-6 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
          No capability matches “{query}”.
        </p>
      )}

      {groups.map(({ category, features }) => {
        const isCollapsed = collapsed.has(category.id)
        const onCount = features.filter((f) => selected.has(f.key)).length
        return (
          <section key={category.id} className="rounded-xl bg-card ring-1 ring-foreground/10">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(category.id)) next.delete(category.id)
                  else next.add(category.id)
                  return next
                })
              }
              className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left sm:px-5"
            >
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {category.label}
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {onCount}/{features.length}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{category.description}</span>
              </div>
              <ChevronDown
                className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                  isCollapsed ? "-rotate-90" : ""
                }`}
                strokeWidth={1.75}
              />
            </button>

            {!isCollapsed && (
              <ul className="border-t border-foreground/10">
                {features.map((feature) => {
                  const on = selected.has(feature.key)
                  const engineOk = feature.engine === "any" || feature.engine === engine
                  return (
                    <li
                      key={feature.key}
                      className="flex items-start justify-between gap-4 border-b border-foreground/5 px-4 py-3 last:border-b-0 sm:px-5"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">{feature.label}</span>
                          {feature.risk !== "standard" && (
                            <Badge className={RISK_STYLE[feature.risk].className}>
                              {RISK_STYLE[feature.risk].label}
                            </Badge>
                          )}
                          {feature.platformOnly && (
                            <Badge variant="outline" className="gap-1">
                              <Lock className="size-2.5" />
                              EasyLife only
                            </Badge>
                          )}
                          {!engineOk && (
                            <Badge variant="outline">Needs {ENGINE_LABEL[feature.engine as Engine]}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{feature.description}</p>
                        {feature.note && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">{feature.note}</p>
                        )}
                        <p className="text-[11px] tabular-nums text-muted-foreground/70">
                          {feature.routes.length} gateway{" "}
                          {feature.routes.length === 1 ? "operation" : "operations"}
                        </p>
                      </div>

                      <Switch
                        checked={on}
                        disabled={!canEdit || !engineOk}
                        onCheckedChange={(next: boolean) => toggle(feature, next)}
                        aria-label={feature.label}
                        className="mt-0.5 shrink-0"
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
