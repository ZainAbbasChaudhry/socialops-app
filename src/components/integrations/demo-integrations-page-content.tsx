"use client"

import * as React from "react"
import { Sparkles, X as XIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { CATEGORY_LABELS, PROVIDER_REGISTRY, type ProviderCategory, type ProviderId } from "@/lib/integrations/providers"

const CATEGORY_ORDER: ProviderCategory[] = ["ai", "messaging", "social", "calling", "productivity"]

/** Showcase copy only - deliberately doesn't reuse the real ProviderCard's
 * credential-field/readiness display or its "Live mode" language, so this
 * page can never be mistaken for real integration configuration. No OAuth
 * setup, no credential fields, no Connect/Test Connection action exists
 * anywhere on this page - it is pure, static, read-only showcase content. */
const DEMO_COPY: Record<ProviderId, { status: string; subtitle: string }> = {
  facebook: { status: "Connected", subtitle: "Demo Account" },
  instagram: { status: "Connected", subtitle: "Demo Account" },
  whatsapp: { status: "Connected", subtitle: "Demo Number" },
  openwa: { status: "Connected", subtitle: "Demo Paired Phone" },
  gemini: { status: "Active", subtitle: "Demo AI Engine" },
  // Demo mode shows every provider the product supports, including the ones
  // a workspace has not chosen - the point of the screen is to show what is
  // available, and "Not connected" is the honest state for those.
  openai: { status: "Not connected", subtitle: "Bring your own model" },
  anthropic: { status: "Not connected", subtitle: "Bring your own model" },
  groq: { status: "Not connected", subtitle: "Free tier available" },
  openrouter: { status: "Not connected", subtitle: "Many models, one key" },
  ollama: { status: "Not connected", subtitle: "Runs on your own server" },
  omnidimension: { status: "Active", subtitle: "Demo Calling Agent" },
  "google-sheets": { status: "Connected", subtitle: "Demo CRM Sheet" },
  "google-calendar": { status: "Connected", subtitle: "Demo Calendar" },
  linkedin: { status: "Connected", subtitle: "Demo Company Page" },
  tiktok: { status: "Connected", subtitle: "Demo Creator Account" },
  youtube: { status: "Connected", subtitle: "Demo Channel" },
  x: { status: "Connected", subtitle: "Demo Account" },
}

const PROVIDER_IDS = Object.keys(PROVIDER_REGISTRY) as ProviderId[]

/** Demo Mode Integrations - a pure showcase of what a fully set-up
 * EasyLife workspace looks like, with zero dependency on any real
 * provider account, credential, or OAuth connection. Nothing here reads
 * or writes a real integration_connections row, and nothing on this page
 * can reach a real provider - see requireClientMode for the server-side
 * backstop on every route that could. */
export function DemoIntegrationsPageContent() {
  const [selected, setSelected] = React.useState<ProviderId | null>(null)
  const provider = selected ? PROVIDER_REGISTRY[selected] : null
  const copy = selected ? DEMO_COPY[selected] : null

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: PROVIDER_IDS.filter((id) => PROVIDER_REGISTRY[id].category === category),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">APIs & Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Demo workspace - every card below is a fabricated example for showcasing EasyLife. No real account, credential, or
          OAuth connection is required or used.
        </p>
      </div>

      {grouped.map((group) => (
        <div key={group.category} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">{CATEGORY_LABELS[group.category as ProviderCategory]}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((id) => {
              const def = PROVIDER_REGISTRY[id]
              const itemCopy = DEMO_COPY[id]
              return (
                <Card key={id} interactive className="gap-3 px-4 py-4" onClick={() => setSelected(id)}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{def.name}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning-foreground dark:text-warning">
                      <Sparkles className="size-2.5" strokeWidth={2} />
                      DEMO
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{def.description}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{itemCopy.subtitle}</span>
                    <StatusBadge tone="success">{itemCopy.status}</StatusBadge>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      ))}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {provider && copy && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {provider.name}
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground dark:text-warning">
                    <Sparkles className="size-3" strokeWidth={2} />
                    Demo connection
                  </span>
                </DialogTitle>
                <DialogDescription>{provider.description}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <p className="text-muted-foreground">
                  This is a fabricated example showing what a configured, active {provider.name} connection looks like — it
                  isn&apos;t connected to a real account and can&apos;t send, publish, or fetch anything from the real{" "}
                  {provider.name}. No real setup, credentials, or approval are needed to see this. Switch to Client Mode to
                  connect a real {provider.name} account for your workspace.
                </p>
                <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                  <span className="text-muted-foreground">{copy.subtitle}</span>
                  <StatusBadge tone="success">{copy.status}</StatusBadge>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mt-1 flex items-center justify-center gap-1.5 self-end text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
                Close
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
