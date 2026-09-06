import { PROVIDER_REGISTRY, type ProviderId } from "./providers"
import { resolveCredentialValue } from "./credential-resolution"
import type { IntegrationConnectionRow } from "./repository"
import { computeReadiness } from "./readiness"

/**
 * What a client actually has to DO to turn an integration on, and whether
 * it is currently working.
 *
 * The product rule this file exists to enforce: the client should not be
 * doing technical work. They press one button. So each provider declares
 * how it is connected, and the card renders that one button - it never
 * shows a form of API keys, callback URLs and client secrets unless the
 * third party genuinely leaves no other way.
 */

export type ConnectMethod =
  /** Redirect to the provider, sign in, come back connected. */
  | "oauth"
  /** Scan a QR code with a phone (WhatsApp). */
  | "qr"
  /** Paste one key. The only technical step some AI providers allow. */
  | "api-key"
  /** The third party genuinely requires more than one value. */
  | "manual"

/**
 * One-click OAuth is only possible where EasyLife has registered its own
 * app with the provider and put its credentials in the server environment.
 * Without that, every client would have to create their own developer
 * project - exactly the technical work this is meant to remove.
 *
 * This is checked at runtime rather than assumed, so a deployment that has
 * set the variables gets the one-click path and one that has not is told
 * plainly what is missing, instead of sending the client to a Google Cloud
 * console they will never come back from.
 */
export function platformAppConfigured(provider: ProviderId): boolean {
  const oauth = PROVIDER_REGISTRY[provider].oauth
  if (!oauth?.platformAppEnvVars) return false
  const names = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value])
  const present = (value: string | string[]) => names(value).some((name) => (process.env[name] ?? "").trim().length > 0)
  return present(oauth.platformAppEnvVars.clientId) && present(oauth.platformAppEnvVars.clientSecret)
}

/** Providers whose connection is a phone pairing rather than a web login. */
const QR_PROVIDERS: ProviderId[] = ["openwa"]

export function connectMethodFor(provider: ProviderId): ConnectMethod {
  if (QR_PROVIDERS.includes(provider)) return "qr"

  const def = PROVIDER_REGISTRY[provider]
  if (def.requiresOAuth) return "oauth"

  // App-credential fields belong to the app, not the client: a provider
  // whose only OTHER required field is a single key is still a one-value
  // setup from the client's point of view.
  const clientFields = def.credentialFields.filter((f) => f.required && f.key !== "clientId" && f.key !== "clientSecret")
  if (clientFields.length === 1 && clientFields[0].key === "apiKey") return "api-key"
  return "manual"
}

/** Where the one button should send them, when it is not an inline form. */
export function connectHrefFor(provider: ProviderId): string | null {
  switch (connectMethodFor(provider)) {
    case "oauth":
      return `/api/oauth/${provider}/start`
    case "qr":
      return "/dashboard/whatsapp"
    default:
      return null
  }
}

/**
 * The traffic light. Three states, because a client deciding whether to do
 * something about an integration only ever has three answers: it is fine,
 * it needs me, or it was never set up.
 */
export type IntegrationHealth = "connected" | "attention" | "disconnected"

export interface ConnectView {
  method: ConnectMethod
  href: string | null
  /** False when one-click is impossible for a reason the client cannot fix
   * - the platform app is not registered. The card says so rather than
   * offering a button that leads nowhere. */
  oneClickAvailable: boolean
  /** What the single button should say right now. */
  actionLabel: "Integrate" | "Reconnect" | "Manage"
  health: IntegrationHealth
  /** Plain words for an amber or red light. Never a secret, never a stack
   * trace - something the business owner can act on. */
  healthReason: string | null
}

export function connectViewFor(row: IntegrationConnectionRow | null, provider: ProviderId): ConnectView {
  const method = connectMethodFor(provider)
  const readiness = computeReadiness(row, provider)
  const mode = row?.mode ?? "disabled"
  const status = row?.status ?? "not_configured"
  const authorized = !PROVIDER_REGISTRY[provider].requiresOAuth || resolveCredentialValue(row, "accessToken", provider).value !== null

  const oneClickAvailable = method !== "oauth" || platformAppConfigured(provider) || readiness.credentialsComplete

  let health: IntegrationHealth
  let healthReason: string | null = null

  // Whether this connection has ever actually worked. It decides what a
  // failure MEANS: something that used to work and has broken needs the
  // client's attention, while a first attempt that did not take is simply
  // still not connected. Calling both "Needs attention" made a card the
  // client had never touched look like a fault they had caused.
  const workedBefore = (row?.lastSuccessAt ?? null) !== null

  if (status === "expired") {
    health = "attention"
    healthReason = "The connection has expired. Reconnect to carry on."
  } else if (status === "error" && (workedBefore || mode === "live")) {
    health = "attention"
    // The provider's own last message, which is already safe to show - it
    // is recorded from an error body, never from a credential.
    healthReason = row?.lastErrorMessage ?? "The last check failed."
  } else if (status === "error") {
    health = "disconnected"
    healthReason = row?.lastErrorMessage ?? null
  } else if (mode === "live" && authorized && readiness.readyForLive) {
    health = "connected"
  } else if (authorized && (mode === "live" || status === "configured" || status === "connected")) {
    // Authorized but not finished - a missing sheet, an untested key.
    health = "attention"
    healthReason = readiness.missing.length ? `Still needed: ${readiness.missing.join(", ")}.` : "Not activated yet."
  } else {
    health = "disconnected"
    healthReason = null
  }

  const actionLabel: ConnectView["actionLabel"] =
    health === "disconnected"
      ? "Integrate"
      : health === "attention" && (status === "expired" || status === "error")
        ? // Only ever offered for something that genuinely was connected -
          // "Reconnect" on a card nobody has connected reads as an error
          // the client made.
          "Reconnect"
        : "Manage"

  return { method, href: connectHrefFor(provider), oneClickAvailable, actionLabel, health, healthReason }
}
