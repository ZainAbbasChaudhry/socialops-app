"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import type { ProviderConnectionView } from "./types"

/**
 * One integration, one button.
 *
 * The client should never meet an API key, a callback URL or a token on
 * this screen. The card says whether the thing is working, and offers the
 * single action that changes that. Everything technical - the credential
 * form, the raw status history - lives behind "Manage", for the rare case
 * where a third party genuinely leaves no simpler route.
 */

const HEALTH: Record<
  ProviderConnectionView["connect"]["health"],
  { dot: string; label: string; text: string }
> = {
  connected: { dot: "bg-emerald-500", label: "Connected", text: "text-emerald-600 dark:text-emerald-400" },
  attention: { dot: "bg-amber-500", label: "Needs attention", text: "text-amber-600 dark:text-amber-400" },
  disconnected: { dot: "bg-rose-500", label: "Not connected", text: "text-rose-600 dark:text-rose-400" },
}

const METHOD_HINT: Record<ProviderConnectionView["connect"]["method"], string> = {
  oauth: "Sign in with your account — nothing else to set up.",
  qr: "Scan a QR code with your phone.",
  "api-key": "Paste one key and it is done.",
  manual: "A few details this provider insists on.",
}

interface ProviderCardProps {
  provider: ProviderConnectionView
  canManage: boolean
  busy?: boolean
  onConnect: () => void
  onManage: () => void
}

export function ProviderCard({ provider, canManage, busy, onConnect, onManage }: ProviderCardProps) {
  const { connect } = provider
  const health = HEALTH[connect.health]
  // "Manage" is the only thing left to offer on a healthy integration, and
  // it is also the honest label for the advanced form.
  const primaryIsManage = connect.actionLabel === "Manage"

  return (
    <Card className="gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{provider.name}</span>
          {provider.displayName ? (
            <span className="truncate text-xs text-muted-foreground">{provider.displayName}</span>
          ) : null}
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${health.text}`}>
          <span className={`h-2 w-2 rounded-full ${health.dot}`} aria-hidden />
          {health.label}
        </span>
      </div>

      <p className="line-clamp-2 text-xs text-muted-foreground">
        {connect.healthReason ?? provider.description}
      </p>

      {connect.health === "disconnected" ? (
        <p className="text-xs text-muted-foreground">{METHOD_HINT[connect.method]}</p>
      ) : null}

      {!connect.oneClickAvailable && connect.health === "disconnected" ? (
        // Said plainly rather than hidden: this is the one case where the
        // client genuinely cannot press one button, and pretending
        // otherwise would send them to a developer console.
        <p className="text-xs text-amber-600 dark:text-amber-400">
          EasyLife has not registered its app with this provider yet, so this one still needs its own credentials.
        </p>
      ) : null}

      <div className="mt-1 flex items-center gap-2">
        <Button
          size="sm"
          variant={primaryIsManage ? "outline" : "default"}
          disabled={!canManage || busy}
          onClick={primaryIsManage ? onManage : onConnect}
          className="min-w-24"
        >
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {connect.actionLabel}
        </Button>
        {!primaryIsManage ? (
          <Button size="sm" variant="ghost" disabled={!canManage} onClick={onManage}>
            Advanced
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
