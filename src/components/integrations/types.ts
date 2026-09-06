import type { IntegrationMode, IntegrationStatus, ProviderId } from "@/lib/integrations/providers"
import type { ConnectView } from "@/lib/integrations/connect"

export type { IntegrationMode, IntegrationStatus, ProviderId }

export interface ProviderCredentialFieldView {
  key: string
  label: string
  secret: boolean
  required: boolean
  configured: boolean
  maskedValue: string | null
  source: "workspace" | "environment" | "none"
}

export interface ProviderReadinessView {
  configured: boolean
  credentialsComplete: boolean
  oauthComplete: boolean
  webhookComplete: boolean
  testPassed: boolean
  readyForLive: boolean
  missing: string[]
}

export interface ProviderConnectionView {
  provider: ProviderId
  name: string
  category: string
  description: string
  mode: IntegrationMode
  status: IntegrationStatus
  displayName: string | null
  config: Record<string, unknown>
  credentialFields: ProviderCredentialFieldView[]
  usingEnvFallback: boolean
  lastTestedAt: string | null
  lastSuccessAt: string | null
  lastErrorMessage: string | null
  updatedAt: string | null
  readiness: ProviderReadinessView
  connect: ConnectView
}
