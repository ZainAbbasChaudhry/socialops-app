/**
 * Central provider registry for the APIs & Integrations Control Center.
 * Every provider the UI/API knows about is defined exactly once here -
 * nothing downstream should hardcode a provider id/name/field list.
 *
 * Adding a future provider should mostly mean adding an entry here plus a
 * small adapter (see src/lib/integrations/adapter.ts), not touching the UI
 * or the credential-storage plumbing.
 */

export type ProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "groq"
  | "openrouter"
  | "ollama"
  | "whatsapp"
  | "openwa"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "x"
  | "youtube"
  | "omnidimension"
  | "google-sheets"
  | "google-calendar"
  | "gmail"
  | "custom-api"

export type ProviderCategory = "ai" | "messaging" | "social" | "calling" | "productivity"

export type IntegrationMode = "disabled" | "demo" | "live"

/** `not_configured`/`configured` describe credential presence; `connecting`
 * covers an in-flight OAuth handshake; the rest describe the last known
 * connection outcome. Never inferred as "connected" from mode alone - only
 * a successful test (or live send/receive) sets it. */
export type IntegrationStatus =
  | "not_configured"
  | "configured"
  | "connecting"
  | "connected"
  | "error"
  | "expired"
  | "disabled"

/** What a provider actually lets the platform do - dashboard modules can
 * query these instead of hardcoding provider names. */
export type ProviderCapability =
  | "oauth"
  | "api_key"
  | "webhook"
  | "publishing"
  | "messages"
  | "comments"
  | "analytics"
  | "calendar"
  | "spreadsheets"
  | "calling"
  | "ai"
  | "token_refresh"

export type CredentialFieldType = "text" | "password" | "url" | "number" | "select" | "boolean"

export interface CredentialField {
  key: string
  label: string
  description?: string
  type: CredentialFieldType
  /** Secret fields are encrypted at rest and never echoed back to the client. */
  secret: boolean
  required: boolean
  placeholder?: string
  /** Where to obtain this value - official docs, never a credential itself. */
  helpUrl?: string
  /** Groups related fields under one heading in the credential form. */
  group?: string
  /** Regex the value must match, checked server-side before saving. */
  validationPattern?: string
  /** For type "select". */
  options?: { value: string; label: string }[]
}

export interface OAuthConfig {
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  usesPkce?: boolean
  /** True if the app's own Client ID/Secret are entered per-workspace
   * (agency reselling under their own app) rather than shared platform-wide. */
  perWorkspaceAppCredentials: boolean
  /** If EasyLife registers and operates its own OAuth app for this provider,
   * these env vars supply the Client ID/secret platform-wide so a client
   * only ever has to click Connect Account - the simplest legitimate
   * onboarding path, preferred over asking every business client to
   * register their own developer app. Unset in this deployment (no
   * platform-level provider app has been created); `resolveCredentialValue`
   * checks these before falling through to a workspace's own saved
   * clientId/clientSecret, so setting them later requires no code change or
   * redeploy - purely an env/config addition.
   *
   * A single field may list more than one env var name, checked in order -
   * this is how an older/shorter alias (e.g. GOOGLE_CLIENT_ID, already set
   * in a real production environment before the *_PLATFORM_* naming existed)
   * keeps working without forcing a secret-value migration. The first
   * variable name in the list is the canonical one to document going
   * forward; later entries exist only for backward compatibility. */
  platformAppEnvVars?: { clientId: string | string[]; clientSecret: string | string[] }
}

export interface ProviderDefinition {
  id: ProviderId
  name: string
  category: ProviderCategory
  description: string
  capabilities: ProviderCapability[]
  credentialFields: CredentialField[]
  supportedModes: IntegrationMode[]
  requiresOAuth: boolean
  oauth?: OAuthConfig
  requiresWebhook: boolean
  webhookPath?: string
  /** Whether a server environment variable can supply this provider's
   * credentials as a fallback when no workspace-level record exists. */
  envFallback?: { envVar: string; describes: string }
  /** Official setup documentation - shown in the UI, never a credential. */
  setupDocsUrl?: string
}

const META_GRAPH_VERSION = "v21.0"
const META_OAUTH: OAuthConfig = {
  authorizationUrl: `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
  tokenUrl: `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
  scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
  perWorkspaceAppCredentials: true,
}

const GOOGLE_OAUTH_BASE: Omit<OAuthConfig, "scopes"> = {
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  perWorkspaceAppCredentials: true,
}

const OAUTH_APP_FIELDS: CredentialField[] = [
  { key: "clientId", label: "Client ID", type: "text", secret: false, required: true, group: "App credentials" },
  { key: "clientSecret", label: "Client secret", type: "password", secret: true, required: true, group: "App credentials" },
]

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderDefinition> = {
  gemini: {
    id: "gemini",
    name: "Gemini",
    category: "ai",
    description: "Powers AI Assistant captions/replies and the WhatsApp sales-qualification chatbot.",
    capabilities: ["api_key", "ai"],
    credentialFields: [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        secret: true,
        required: true,
        helpUrl: "https://ai.google.dev/gemini-api/docs/api-key",
      },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: false,
    envFallback: { envVar: "GEMINI_API_KEY", describes: "server-configured Gemini API key" },
    setupDocsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
  },

  // ---- Bring your own model ------------------------------------------
  //
  // Everything below speaks the OpenAI chat-completions shape except
  // Anthropic, so they cost one adapter between them (see
  // src/lib/services/llm). A workspace activates whichever it wants and the
  // whole app - qualification bot, assistant, inbox helper - switches to it
  // without a code change.
  //
  // `model` is a field on every one of them because pinning a model is how
  // a client controls both cost and behaviour; leaving it blank uses the
  // provider's sensible default.
  openai: {
    id: "openai",
    name: "OpenAI",
    category: "ai",
    description: "Use OpenAI's models for the qualification bot, the assistant and the WhatsApp inbox helper.",
    capabilities: ["api_key", "ai"],
    credentialFields: [
      { key: "apiKey", label: "API key", type: "password", secret: true, required: true, helpUrl: "https://platform.openai.com/api-keys" },
      { key: "model", label: "Model", type: "text", secret: false, required: false, description: "Leave blank for gpt-4o-mini." },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: false,
    envFallback: { envVar: "OPENAI_API_KEY", describes: "server-configured OpenAI API key" },
    setupDocsUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    category: "ai",
    description: "Use Claude for the qualification bot, the assistant and the WhatsApp inbox helper.",
    capabilities: ["api_key", "ai"],
    credentialFields: [
      { key: "apiKey", label: "API key", type: "password", secret: true, required: true, helpUrl: "https://console.anthropic.com/settings/keys" },
      { key: "model", label: "Model", type: "text", secret: false, required: false, description: "Leave blank for the current Sonnet." },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: false,
    envFallback: { envVar: "ANTHROPIC_API_KEY", describes: "server-configured Anthropic API key" },
    setupDocsUrl: "https://console.anthropic.com/settings/keys",
  },
  groq: {
    id: "groq",
    name: "Groq",
    category: "ai",
    description:
      "Fast open models with a free tier. Strong enough for customer replies and costs nothing until the daily limit - the practical alternative to running your own server.",
    capabilities: ["api_key", "ai"],
    credentialFields: [
      { key: "apiKey", label: "API key", type: "password", secret: true, required: true, helpUrl: "https://console.groq.com/keys" },
      { key: "model", label: "Model", type: "text", secret: false, required: false, description: "Leave blank for Llama 3.3 70B." },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: false,
    envFallback: { envVar: "GROQ_API_KEY", describes: "server-configured Groq API key" },
    setupDocsUrl: "https://console.groq.com/keys",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    category: "ai",
    description: "One key, many models - including free ones. Useful for trying a model before committing to its provider.",
    capabilities: ["api_key", "ai"],
    credentialFields: [
      { key: "apiKey", label: "API key", type: "password", secret: true, required: true, helpUrl: "https://openrouter.ai/keys" },
      { key: "model", label: "Model", type: "text", secret: false, required: false, description: "e.g. meta-llama/llama-3.3-70b-instruct" },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: false,
    envFallback: { envVar: "OPENROUTER_API_KEY", describes: "server-configured OpenRouter API key" },
    setupDocsUrl: "https://openrouter.ai/keys",
  },
  ollama: {
    id: "ollama",
    name: "Self-hosted model (Ollama / vLLM / LM Studio)",
    category: "ai",
    description:
      "A model running on your own server, so nothing is billed per message and no customer data leaves your infrastructure. Needs 8GB+ RAM and a process that stays up - it cannot run on cPanel hosting, for the same reason the WhatsApp gateway cannot.",
    capabilities: ["api_key", "ai"],
    credentialFields: [
      {
        key: "baseUrl",
        label: "Server URL",
        type: "url",
        secret: false,
        required: true,
        description: "The OpenAI-compatible endpoint, e.g. http://your-server:11434/v1",
      },
      { key: "model", label: "Model", type: "text", secret: false, required: false, description: "e.g. llama3.2, qwen2.5. Leave blank for llama3.2." },
      { key: "apiKey", label: "API key", type: "password", secret: true, required: false, description: "Only if your server requires one." },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: false,
    setupDocsUrl: "https://ollama.com/download",
  },

  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp Cloud API",
    category: "messaging",
    description: "Official Meta WhatsApp Business Cloud API for real customer conversations.",
    capabilities: ["api_key", "webhook", "messages"],
    credentialFields: [
      { key: "wabaId", label: "WhatsApp Business Account ID", type: "text", secret: false, required: true },
      { key: "phoneNumberId", label: "Phone Number ID", type: "text", secret: false, required: true },
      { key: "accessToken", label: "Access token", type: "password", secret: true, required: true },
      { key: "verifyToken", label: "Webhook verify token", type: "password", secret: true, required: true, description: "Any string you choose - entered identically in Meta's webhook configuration." },
      { key: "appSecret", label: "Meta App secret", type: "password", secret: true, required: true, description: "Used to verify inbound webhook signatures." },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: true,
    webhookPath: "/api/webhooks/whatsapp",
    setupDocsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
  },
  openwa: {
    id: "openwa",
    name: "WhatsApp (OpenWA / Baileys NOWEB)",
    category: "messaging",
    description:
      "Self-hosted WhatsApp gateway. A phone is paired by QR once and the gateway holds the session, so there is no Meta Business verification, no per-message fee and no WABA. Runs as its own persistent service (OpenWA, MIT-licensed - see deploy/openwa/README.md) because a paired WhatsApp socket cannot live inside a request-scoped web app.",
    capabilities: ["api_key", "webhook", "messages"],
    credentialFields: [
      {
        key: "baseUrl",
        label: "Gateway base URL",
        type: "url",
        secret: false,
        required: true,
        description: "e.g. https://wa.easylife.com.pk - the OpenWA gateway this workspace sends through.",
      },
      {
        key: "apiKey",
        label: "Gateway API key",
        type: "password",
        secret: true,
        required: true,
        description: "Sent as X-Api-Key on every call to the gateway.",
      },
      {
        key: "webhookSecret",
        label: "Webhook signing secret",
        type: "password",
        secret: true,
        required: true,
        description: "Shared with the gateway; every inbound delivery is HMAC-signed with it and rejected if it doesn't match.",
      },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: true,
    webhookPath: "/api/webhooks/openwa",
    setupDocsUrl: "https://baileys.wiki/",
  },
  facebook: {
    id: "facebook",
    name: "Facebook Page",
    category: "social",
    description: "Facebook Page text, photo, and video publishing are live, along with real comment ingestion and reply through a webhook this app registers automatically once you select a Page. Carousel/multi-photo posts and resumable large-video upload aren't implemented yet.",
    capabilities: ["oauth", "publishing", "comments", "analytics"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      ...META_OAUTH,
      scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "pages_manage_engagement", "pages_manage_metadata"],
      platformAppEnvVars: { clientId: "META_PLATFORM_CLIENT_ID", clientSecret: "META_PLATFORM_CLIENT_SECRET" },
    },
    requiresWebhook: true,
    webhookPath: "/api/webhooks/meta",
  },
  instagram: {
    id: "instagram",
    name: "Instagram Business",
    category: "social",
    description: "Instagram image and video (Reels) publishing, plus real comment ingestion and reply, are live automatically once Facebook is connected and its selected Page has a linked Instagram professional account - this separate connection isn't required. Carousel posts aren't implemented yet.",
    capabilities: ["oauth", "publishing", "comments", "analytics"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      ...META_OAUTH,
      scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "pages_show_list"],
      platformAppEnvVars: { clientId: "META_PLATFORM_CLIENT_ID", clientSecret: "META_PLATFORM_CLIENT_SECRET" },
    },
    requiresWebhook: false,
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    category: "social",
    description:
      "TikTok video and photo publishing is real, but until this app passes TikTok's content audit, every publish lands as private-only (SELF_ONLY) regardless of the privacy level requested - a provider restriction, not a software gap.",
    capabilities: ["oauth", "publishing"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/",
      tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
      scopes: ["video.publish", "user.info.basic"],
      perWorkspaceAppCredentials: true,
      platformAppEnvVars: { clientId: "TIKTOK_PLATFORM_CLIENT_ID", clientSecret: "TIKTOK_PLATFORM_CLIENT_SECRET" },
    },
    requiresWebhook: false,
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    category: "social",
    description:
      "LinkedIn text/image/video publishing (member profile or a company Page you administer) is real, but requires LinkedIn to approve this app for Community Management API access first - w_member_social and w_organization_social are both gated behind that review, not self-serve.",
    capabilities: ["oauth", "publishing"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
      // openid+profile resolve the member's own person URN (identity
      // discovery); w_member_social/w_organization_social are the actual
      // publish permissions; rw_organization_admin is needed for
      // organizationAcls (discovering which company Pages this member
      // administers). All of the w_*/rw_* scopes here are only ever
      // granted once LinkedIn has approved this app for Community
      // Management API access - see providers.ts's description field.
      scopes: ["openid", "profile", "w_member_social", "w_organization_social", "rw_organization_admin"],
      perWorkspaceAppCredentials: true,
      platformAppEnvVars: { clientId: "LINKEDIN_PLATFORM_CLIENT_ID", clientSecret: "LINKEDIN_PLATFORM_CLIENT_SECRET" },
    },
    requiresWebhook: false,
  },
  x: {
    id: "x",
    name: "X (Twitter)",
    category: "social",
    description:
      "X text and media publishing is real, but X's API has no free tier for posting - this app's X developer account needs billing/credits configured before any publish will succeed.",
    capabilities: ["oauth", "publishing"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      authorizationUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
      scopes: ["tweet.read", "tweet.write", "users.read"],
      usesPkce: true,
      perWorkspaceAppCredentials: true,
      platformAppEnvVars: { clientId: "X_PLATFORM_CLIENT_ID", clientSecret: "X_PLATFORM_CLIENT_SECRET" },
    },
    requiresWebhook: false,
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    category: "social",
    description: "Real YouTube video upload (resumable protocol) via the same Google OAuth connection as Sheets and Calendar.",
    capabilities: ["oauth", "publishing", "analytics"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      ...GOOGLE_OAUTH_BASE,
      scopes: ["https://www.googleapis.com/auth/youtube.upload"],
      platformAppEnvVars: { clientId: ["GOOGLE_PLATFORM_CLIENT_ID", "GOOGLE_CLIENT_ID"], clientSecret: ["GOOGLE_PLATFORM_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"] },
    },
    requiresWebhook: false,
  },
  omnidimension: {
    id: "omnidimension",
    name: "OmniDimension",
    category: "calling",
    description: "AI voice calling agent for qualified leads. Requires an OmniDimension account, an agent built in their dashboard, and a Post-Call webhook pointed at the URL below.",
    capabilities: ["api_key", "webhook", "calling"],
    credentialFields: [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        secret: true,
        required: true,
        helpUrl: "https://omnidim.io/api-management",
        description: "From the OmniDimension API management dashboard.",
      },
      {
        key: "agentId",
        label: "Agent ID",
        type: "text",
        secret: false,
        required: true,
        description: "The numeric ID of the agent (built in the OmniDimension dashboard) that should handle these calls.",
      },
      {
        key: "fromNumberId",
        label: "From-number ID",
        type: "text",
        secret: false,
        required: false,
        description: "Optional - the ID of a phone number on your OmniDimension account to place calls from.",
      },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: true,
    webhookPath: "/api/webhooks/omnidimension",
    envFallback: { envVar: "OMNIDIM_API_KEY", describes: "server-configured OmniDimension API key" },
    setupDocsUrl: "https://docs.omnidim.io/docs/get-started/quickstart",
  },
  "google-sheets": {
    id: "google-sheets",
    name: "Google Sheets",
    category: "productivity",
    description: "Secondary lead export/sync to Google Sheets - PostgreSQL remains the source of truth.",
    capabilities: ["oauth", "spreadsheets"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      ...GOOGLE_OAUTH_BASE,
      // drive.metadata.readonly lists which spreadsheets exist in the
      // connected account (for the client to pick from) without granting
      // read access to file contents; spreadsheets is the actual read/
      // write scope, needed once a specific sheet is selected.
      scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.metadata.readonly"],
      platformAppEnvVars: { clientId: ["GOOGLE_PLATFORM_CLIENT_ID", "GOOGLE_CLIENT_ID"], clientSecret: ["GOOGLE_PLATFORM_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"] },
    },
    requiresWebhook: false,
  },
  "google-calendar": {
    id: "google-calendar",
    name: "Google Calendar",
    category: "productivity",
    description: "Real meeting scheduling: list calendars, check availability, create events with Google Meet links, and update/cancel them.",
    capabilities: ["oauth", "calendar"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      ...GOOGLE_OAUTH_BASE,
      // The full calendar scope, not just calendar.events - listing which
      // calendars exist (calendarList) and checking availability
      // (freeBusy) aren't covered by calendar.events alone.
      scopes: ["https://www.googleapis.com/auth/calendar"],
      platformAppEnvVars: { clientId: ["GOOGLE_PLATFORM_CLIENT_ID", "GOOGLE_CLIENT_ID"], clientSecret: ["GOOGLE_PLATFORM_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"] },
    },
    requiresWebhook: false,
  },
  "custom-api": {
    id: "custom-api",
    name: "Custom API",
    category: "productivity",
    description:
      "Connect any other service EasyLife doesn't have a card for. Paste the address, choose how it authenticates, and EasyLife checks it works - no webhook wiring, no callback URLs.",
    capabilities: ["api_key"],
    credentialFields: [
      {
        key: "baseUrl",
        label: "Address",
        type: "url",
        secret: false,
        required: true,
        placeholder: "https://api.example.com",
        description: "The base address of the service, as its documentation gives it.",
      },
      {
        key: "authStyle",
        label: "How it authenticates",
        type: "select",
        secret: false,
        required: true,
        description: "Almost every API uses one of these. If you are not sure, the service's own docs say which.",
        options: [
          { value: "bearer", label: "Bearer token (most common)" },
          { value: "api-key-header", label: "X-Api-Key header" },
          { value: "none", label: "No key needed" },
        ],
      },
      {
        key: "apiKey",
        label: "Key",
        type: "password",
        secret: true,
        // Not required, because "No key needed" is a real answer - and a
        // required field the client cannot fill is exactly the dead end
        // this whole design exists to avoid.
        required: false,
        description: "Leave empty if the service needs no key.",
      },
      {
        key: "testPath",
        label: "A path to check (optional)",
        type: "text",
        secret: false,
        required: false,
        placeholder: "/health",
        description: "Somewhere harmless EasyLife can call to confirm the connection works. Defaults to the address itself.",
      },
    ],
    supportedModes: ["demo", "live"],
    requiresOAuth: false,
    requiresWebhook: false,
  },
  gmail: {
    id: "gmail",
    name: "Gmail",
    category: "productivity",
    description:
      "Send email from the business's own address and log what customers write back against their lead - so an email conversation is part of the CRM record rather than sitting in one person's inbox.",
    capabilities: ["oauth", "messages"],
    credentialFields: OAUTH_APP_FIELDS,
    supportedModes: ["demo", "live"],
    requiresOAuth: true,
    oauth: {
      ...GOOGLE_OAUTH_BASE,
      // gmail.send is write-only and cannot read anything - deliberately
      // narrower than the blanket mail scope. gmail.readonly is what makes
      // logging a customer's replies possible; gmail.modify would also
      // allow deleting their mail, which nothing here needs.
      scopes: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      platformAppEnvVars: { clientId: ["GOOGLE_PLATFORM_CLIENT_ID", "GOOGLE_CLIENT_ID"], clientSecret: ["GOOGLE_PLATFORM_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"] },
    },
    requiresWebhook: false,
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDER_REGISTRY) as ProviderId[]

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDER_REGISTRY
}

export function providersWithCapability(capability: ProviderCapability): ProviderId[] {
  return PROVIDER_IDS.filter((id) => PROVIDER_REGISTRY[id].capabilities.includes(capability))
}

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  ai: "AI",
  messaging: "Messaging",
  social: "Social",
  calling: "Calling",
  productivity: "Productivity",
}
