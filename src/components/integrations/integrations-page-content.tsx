"use client"

import * as React from "react"
import { Loader2, ShieldOff, CircleCheck, CircleAlert } from "lucide-react"
import { useAuth } from "@/lib/auth/auth-context"
import { ProviderCard } from "./provider-card"
import { ProviderDetailSheet } from "./provider-detail-sheet"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { ProviderConnectionView } from "./types"
import { CATEGORY_LABELS, isProviderId, type ProviderCategory } from "@/lib/integrations/providers"

const CATEGORY_ORDER: ProviderCategory[] = ["ai", "messaging", "social", "calling", "productivity"]

const OAUTH_RESULT_MESSAGE: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Connected and set up — nothing else to do." },
  connected_partial: {
    tone: "error",
    text: "Your account is connected, but setup didn't finish. Open the card to see what's left.",
  },
  denied: { tone: "error", text: "Authorization was cancelled or denied." },
  invalid: { tone: "error", text: "That connection attempt expired or was invalid. Try again." },
  not_configured: { tone: "error", text: "Save the app credentials before connecting." },
  failed: { tone: "error", text: "The provider couldn't confirm the connection. Try again." },
}

export function IntegrationsPageContent() {
  const { user } = useAuth()
  const [providers, setProviders] = React.useState<ProviderConnectionView[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const [selected, setSelected] = React.useState<ProviderConnectionView | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [oauthResult, setOauthResult] = React.useState<{ tone: "success" | "error"; text: string } | null>(null)
  const [pendingOAuthProvider, setPendingOAuthProvider] = React.useState<string | null>(null)
  const [connecting, setConnecting] = React.useState<string | null>(null)

  const canManage = user?.role === "owner" || user?.role === "admin"

  /**
   * The one button. Where the provider allows it, this is the whole
   * interaction: a redirect to sign in, or a jump to the QR screen. Where
   * it does not, the same button opens the form rather than dead-ending -
   * the client still only ever presses one thing.
   */
  async function handleConnect(provider: ProviderConnectionView) {
    const { method, href, oneClickAvailable } = provider.connect
    if (!oneClickAvailable || method === "api-key" || method === "manual" || !href) {
      setSelected(provider)
      setSheetOpen(true)
      return
    }
    setConnecting(provider.provider)
    // A full navigation, not a fetch: the provider's own sign-in screen has
    // to be shown in the browser, and that is the point of the redirect.
    window.location.assign(href)
  }

  React.useEffect(() => {
    function readOAuthRedirectParams() {
      const params = new URLSearchParams(window.location.search)
      const oauthStatus = params.get("oauth")
      const oauthProvider = params.get("provider")
      if (oauthStatus && OAUTH_RESULT_MESSAGE[oauthStatus]) {
        setOauthResult(OAUTH_RESULT_MESSAGE[oauthStatus])
        if (oauthProvider && isProviderId(oauthProvider)) setPendingOAuthProvider(oauthProvider)
        window.history.replaceState({}, "", window.location.pathname)
      }
    }
    readOAuthRedirectParams()
  }, [])

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/integrations", { credentials: "same-origin" })
        if (cancelled) return
        if (res.status === 403) {
          setForbidden(true)
          return
        }
        if (!res.ok) throw new Error("Failed to load")
        const data = await res.json()
        if (cancelled) return
        setProviders(data.providers)
        if (pendingOAuthProvider) {
          const match = (data.providers as ProviderConnectionView[]).find((p) => p.provider === pendingOAuthProvider)
          if (match) {
            setSelected(match)
            setSheetOpen(true)
          }
          setPendingOAuthProvider(null)
        }
      } catch {
        if (!cancelled) setError("Couldn't load integrations. Check your connection and try again.")
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [pendingOAuthProvider])

  function handleUpdated(updated: ProviderConnectionView) {
    setProviders((prev) => (prev ? prev.map((p) => (p.provider === updated.provider ? updated : p)) : prev))
    setSelected(updated)
  }

  if (forbidden) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <ShieldOff className="size-8 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-base font-semibold text-foreground">Access restricted</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          APIs & Integrations is only available to workspace owners, admins, and managers.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (!providers) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: providers.filter((p) => p.category === category),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">APIs & Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect and manage the providers that power EasyLife — AI, WhatsApp, social platforms, calling, and Google.
        </p>
      </div>

      {oauthResult && (
        <Alert variant={oauthResult.tone === "error" ? "destructive" : "default"}>
          {oauthResult.tone === "error" ? <CircleAlert /> : <CircleCheck />}
          <AlertDescription>{oauthResult.text}</AlertDescription>
        </Alert>
      )}

      {grouped.map((group) => (
        <div key={group.category} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">{CATEGORY_LABELS[group.category]}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((provider) => (
              <ProviderCard
                key={provider.provider}
                provider={provider}
                canManage={canManage}
                busy={connecting === provider.provider}
                onConnect={() => void handleConnect(provider)}
                onManage={() => {
                  setSelected(provider)
                  setSheetOpen(true)
                }}
              />
            ))}
          </div>
        </div>
      ))}

      <ProviderDetailSheet
        provider={selected}
        canManage={canManage}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={handleUpdated}
      />
    </div>
  )
}
