"use client"

import * as React from "react"
import { Loader2, CircleAlert, CircleCheck, Copy, Check, X, ExternalLink, Link2 } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { ProviderConnectionView, IntegrationMode } from "./types"
import { PROVIDER_REGISTRY } from "@/lib/integrations/providers"
import { cn } from "@/lib/utils"
import { FacebookPageSelector } from "./facebook-page-selector"
import { GoogleSheetsPicker } from "./google-sheets-picker"
import { GoogleCalendarSelector } from "./google-calendar-selector"
import { LinkedInIdentitySelector } from "./linkedin-identity-selector"

interface ProviderDetailSheetProps {
  provider: ProviderConnectionView | null
  canManage: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: ProviderConnectionView) => void
}

export function ProviderDetailSheet({ provider, canManage, open, onOpenChange, onSaved }: ProviderDetailSheetProps) {
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [mode, setMode] = React.useState<IntegrationMode>("disabled")
  // Tracks whether the person actually touched the Mode select this time.
  // The PUT route rejects any request where mode is "live" AND credential
  // fields are changing in the same call (it wants a fresh Test Connection
  // between "save new creds" and "flip to live"). `mode` state is always
  // populated from the current provider so the <Select> has a value, so it
  // must NOT be sent on every save — only when the person deliberately
  // changed it — otherwise an ordinary credential update while already in
  // "live" mode gets silently rejected (nothing persists, no obvious cause).
  const [modeTouched, setModeTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [message, setMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null)

  // Resets local form state when a different provider is opened — done
  // during render (React's documented pattern for adjusting state in
  // response to a prop change) rather than in an effect, which would
  // trigger an extra, avoidable render pass.
  const [syncedProvider, setSyncedProvider] = React.useState(provider)
  if (provider !== syncedProvider) {
    setSyncedProvider(provider)
    setFields({})
    setMode(provider?.mode ?? "disabled")
    setModeTouched(false)
    setMessage(null)
  }

  if (!provider) return null
  const def = PROVIDER_REGISTRY[provider.provider]

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/integrations/${provider!.provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        // Only include `mode` when the person deliberately changed it via
        // the Mode select — see the `modeTouched` comment above.
        body: JSON.stringify(modeTouched ? { mode, fields } : { fields }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error ?? "Failed to save." })
        return
      }
      setMessage({ tone: "success", text: "Saved." })
      setFields({})
      setModeTouched(false)
      if (data.provider?.mode) setMode(data.provider.mode)
      onSaved(data.provider)
    } catch {
      setMessage({ tone: "error", text: "Couldn't reach the server." })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/integrations/${provider!.provider}/test`, {
        method: "POST",
        credentials: "same-origin",
      })
      const data = await res.json()
      setMessage({ tone: data.ok ? "success" : "error", text: data.message ?? (data.ok ? "Connected." : "Test failed.") })
      if (data.provider) onSaved(data.provider)
    } catch {
      setMessage({ tone: "error", text: "Couldn't reach the server." })
    } finally {
      setTesting(false)
    }
  }

  const webhookUrl = def.requiresWebhook && def.webhookPath ? `${typeof window !== "undefined" ? window.location.origin : ""}${def.webhookPath}` : null

  const checklist: { label: string; done: boolean }[] = [
    { label: "Required credentials saved", done: provider.readiness.credentialsComplete },
    ...(def.requiresOAuth ? [{ label: "Account connected (OAuth)", done: provider.readiness.oauthComplete }] : []),
    ...(def.requiresWebhook ? [{ label: "Webhook verified", done: provider.readiness.webhookComplete }] : []),
    { label: "Test Connection passed", done: provider.readiness.testPassed },
  ]

  function handleConnectAccount() {
    // Deliberate full navigation, not client-side routing: this hits a
    // route handler that itself issues a redirect to an external OAuth
    // provider's domain, which router.push() isn't meant for.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/oauth/${provider!.provider}/start`
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{provider.name}</SheetTitle>
          <SheetDescription>{provider.description}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Status</span>
            <StatusBadge tone={provider.status === "connected" ? "success" : provider.status === "error" ? "error" : "neutral"}>
              {provider.status.replace("_", " ")}
            </StatusBadge>
          </div>

          {provider.usingEnvFallback && (
            <Alert>
              <CircleCheck />
              <AlertDescription>Using the server-configured default credential for this provider.</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <span className="text-xs font-medium text-muted-foreground">Setup checklist</span>
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-sm">
                {item.done ? (
                  <Check className="size-3.5 shrink-0 text-success" />
                ) : (
                  <X className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={cn(item.done ? "text-foreground" : "text-muted-foreground")}>{item.label}</span>
              </div>
            ))}
          </div>

          {def.setupDocsUrl && (
            <a
              href={def.setupDocsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="flex w-fit items-center gap-1.5 text-xs text-brand hover:underline"
            >
              <ExternalLink className="size-3" />
              Official setup documentation
            </a>
          )}

          {canManage && def.supportedModes.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label>Mode</Label>
              <Select
                value={mode}
                onValueChange={(v) => {
                  setMode(v as IntegrationMode)
                  setModeTouched(true)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {def.supportedModes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === "live" ? "Live" : m === "demo" ? "Demo" : "Disabled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {def.credentialFields.length > 0 && (
            <div className="flex flex-col gap-4">
              <span className="text-sm font-medium text-foreground">
                {def.requiresOAuth ? "App credentials" : "Credentials"}
              </span>
              {provider.credentialFields.map((field) => {
                const meta = def.credentialFields.find((f) => f.key === field.key)
                return (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </Label>
                    {meta?.description && <p className="text-xs text-muted-foreground">{meta.description}</p>}
                    {canManage ? (
                      <Input
                        id={field.key}
                        type={field.secret ? "password" : "text"}
                        placeholder={field.configured ? field.maskedValue ?? "Configured" : `Enter ${field.label.toLowerCase()}`}
                        value={fields[field.key] ?? ""}
                        onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      />
                    ) : (
                      <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                        {field.configured ? (field.maskedValue ?? "Configured") : "Not configured"}
                      </div>
                    )}
                    {meta?.helpUrl && (
                      <a href={meta.helpUrl} target="_blank" rel="noreferrer noopener" className="flex w-fit items-center gap-1 text-xs text-brand hover:underline">
                        <ExternalLink className="size-3" />
                        Where to find this
                      </a>
                    )}
                  </div>
                )
              })}
              {canManage && (
                <p className="text-xs text-muted-foreground">Leave a field blank to keep its current saved value.</p>
              )}
            </div>
          )}

          {def.requiresOAuth && canManage && (
            <div className="flex flex-col gap-1.5">
              <Label>Account connection</Label>
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={handleConnectAccount}
                disabled={!provider.readiness.credentialsComplete}
              >
                <Link2 className="size-4" />
                {provider.readiness.oauthComplete ? "Reconnect account" : "Connect Account"}
              </Button>
              {!provider.readiness.credentialsComplete && (
                <p className="text-xs text-muted-foreground">Save the app credentials above first.</p>
              )}
            </div>
          )}

          {provider.provider === "facebook" && provider.readiness.oauthComplete && (
            <FacebookPageSelector canManage={canManage} />
          )}

          {provider.provider === "google-sheets" && provider.readiness.oauthComplete && (
            <GoogleSheetsPicker canManage={canManage} />
          )}

          {provider.provider === "google-calendar" && provider.readiness.oauthComplete && (
            <GoogleCalendarSelector canManage={canManage} />
          )}

          {provider.provider === "linkedin" && provider.readiness.oauthComplete && (
            <LinkedInIdentitySelector canManage={canManage} />
          )}

          {webhookUrl && (
            <div className="flex flex-col gap-1.5">
              <Label>Webhook URL</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={webhookUrl} className="text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  aria-label="Copy webhook URL"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {message && (
            <Alert variant={message.tone === "error" ? "destructive" : "default"}>
              {message.tone === "error" ? <CircleAlert /> : <CircleCheck />}
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}
        </div>

        {canManage && (
          <SheetFooter className="flex-row gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={handleTest} disabled={testing || saving}>
              {testing && <Loader2 className="size-4 animate-spin" />}
              Test Connection
            </Button>
            <Button type="button" className="flex-1" onClick={handleSave} disabled={saving || testing}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
