import { pgSchema, text, integer, timestamp, uuid, jsonb, boolean, date } from "drizzle-orm/pg-core"

/**
 * Drizzle schema mirroring migrations/0001_init.sql exactly. The raw SQL
 * migration is the reviewable source of truth for the actual DDL; this file
 * exists purely for type-safe querying at runtime via drizzle-orm.
 *
 * Isolated in its own `socialops` schema so it can never collide with any
 * other application's tables in the shared `easylife_prod` database.
 */
export const socialops = pgSchema("socialops")

export const schemaMigrations = socialops.table("schema_migrations", {
  version: text("version").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
})

export const users = socialops.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
})

export const workspaces = socialops.table("workspaces", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const workspaceMembers = socialops.table("workspace_members", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = socialops.table("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  workspaceId: uuid("workspace_id"),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ip: text("ip"),
})

export const leads = socialops.table("leads", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),

  name: text("name").notNull(),
  whatsappNumber: text("whatsapp_number"),
  email: text("email"),
  company: text("company"),
  city: text("city"),

  businessType: text("business_type"),
  location: text("location"),

  sourcePlatform: text("source_platform").notNull().default("direct"),
  sourceCampaign: text("source_campaign"),
  sourceOriginalPostId: text("source_original_post_id"),
  sourceOriginalPostExcerpt: text("source_original_post_excerpt"),
  sourceOriginalCommentId: text("source_original_comment_id"),
  sourceOriginalCommentExcerpt: text("source_original_comment_excerpt"),
  sourceOriginalConversationId: text("source_original_conversation_id"),

  serviceInterested: text("service_interested"),
  requirement: text("requirement"),
  painPoint: text("pain_point"),
  budget: text("budget"),
  timeline: text("timeline"),
  goal: text("goal"),
  decisionMaker: text("decision_maker"),
  preferredLanguage: text("preferred_language"),
  preferredCallTime: text("preferred_call_time"),

  leadScore: integer("lead_score").notNull().default(0),
  stage: text("stage").notNull().default("new"),
  status: text("status").notNull().default("cold"),
  callPermission: text("call_permission").notNull().default("unknown"),
  callStatus: text("call_status"),
  meetingStatus: text("meeting_status"),
  priority: text("priority"),

  assignedToUserId: uuid("assigned_to_user_id"),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),

  notes: text("notes").notNull().default(""),
  tags: text("tags").array().notNull().default([]),

  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const leadActivities = socialops.table("lead_activities", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  actorUserId: uuid("actor_user_id"),
  activityType: text("activity_type").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const loginAttempts = socialops.table("login_attempts", {
  id: uuid("id").primaryKey(),
  normalizedEmail: text("normalized_email").notNull(),
  ip: text("ip"),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Phase 3: APIs & Integrations Control Center + WhatsApp Cloud API pipeline
// ---------------------------------------------------------------------------

export const integrationConnections = socialops.table("integration_connections", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  provider: text("provider").notNull(),
  mode: text("mode").notNull().default("disabled"),
  status: text("status").notNull().default("not_configured"),
  displayName: text("display_name"),
  config: jsonb("config").notNull().default({}),
  secretDataEncrypted: jsonb("secret_data_encrypted").notNull().default({}),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const integrationAuditLog = socialops.table("integration_audit_log", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  provider: text("provider").notNull(),
  action: text("action").notNull(),
  actorUserId: uuid("actor_user_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const whatsappAccounts = socialops.table("whatsapp_accounts", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  integrationConnectionId: uuid("integration_connection_id"),
  // Nullable since migration 0012: an OpenWA (Baileys NOWEB) session is a
  // paired phone, not a Meta business asset, so it has neither identifier.
  phoneNumberId: text("phone_number_id"),
  wabaId: text("waba_id"),
  displayPhoneNumber: text("display_phone_number"),
  status: text("status").notNull().default("active"),
  /** Which transport this account speaks: 'cloud-api' | 'openwa'. */
  provider: text("provider").notNull().default("cloud-api"),
  /** OpenWA gateway session id. Server-derived from the workspace id -
   * never accepted from the browser. NULL for Cloud API accounts. */
  sessionId: text("session_id"),
  /** 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error'. Only
   * ever set from an observed gateway state, never assumed. */
  connectionStatus: text("connection_status").notNull().default("disconnected"),
  connectedNumber: text("connected_number"),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  lastDisconnectedAt: timestamp("last_disconnected_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const workspaceWhatsappFeatures = socialops.table("workspace_whatsapp_features", {
  workspaceId: uuid("workspace_id").primaryKey(),
  /** Enabled capability keys from the WhatsApp feature catalogue. */
  enabledKeys: text("enabled_keys").array().notNull().default([]),
  engine: text("engine").notNull().default("baileys"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const whatsappConversations = socialops.table("whatsapp_conversations", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  whatsappAccountId: uuid("whatsapp_account_id").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactName: text("contact_name"),
  leadId: uuid("lead_id"),
  status: text("status").notNull().default("bot"),
  botState: jsonb("bot_state").notNull().default({}),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const whatsappMessages = socialops.table("whatsapp_messages", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  externalMessageId: text("external_message_id"),
  direction: text("direction").notNull(),
  messageType: text("message_type").notNull().default("text"),
  body: text("body"),
  providerStatus: text("provider_status").notNull().default("received"),
  sender: text("sender").notNull().default("customer"),
  rawMetadata: jsonb("raw_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Phase 4: provider-ready platform architecture
// ---------------------------------------------------------------------------

export const oauthStates = socialops.table("oauth_states", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  provider: text("provider").notNull(),
  actorUserId: uuid("actor_user_id"),
  state: text("state").notNull().unique(),
  codeVerifier: text("code_verifier"),
  redirectPath: text("redirect_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
})

export const webhookEvents = socialops.table("webhook_events", {
  id: uuid("id").primaryKey(),
  provider: text("provider").notNull(),
  workspaceId: uuid("workspace_id"),
  externalEventId: text("external_event_id"),
  eventType: text("event_type"),
  processingStatus: text("processing_status").notNull().default("received"),
  payloadSummary: jsonb("payload_summary"),
  errorCode: text("error_code"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
})

export const jobs = socialops.table("jobs", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const socialAccounts = socialops.table("social_accounts", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  provider: text("provider").notNull(),
  integrationConnectionId: uuid("integration_connection_id"),
  externalAccountId: text("external_account_id").notNull(),
  accountName: text("account_name").notNull(),
  username: text("username"),
  avatarUrl: text("avatar_url"),
  accountType: text("account_type"),
  status: text("status").notNull().default("connected"),
  capabilities: text("capabilities").array().notNull().default([]),
  followers: integer("followers").notNull().default(0),
  followersDelta30d: integer("followers_delta_30d").notNull().default(0),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const posts = socialops.table("posts", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  authorUserId: uuid("author_user_id"),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("draft"),
  baseCaption: text("base_caption").notNull().default(""),
  baseHashtags: text("base_hashtags").notNull().default(""),
  media: jsonb("media").notNull().default([]),
  platforms: text("platforms").array().notNull().default([]),
  variants: jsonb("variants").notNull().default([]),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const postTargets = socialops.table("post_targets", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  socialAccountId: uuid("social_account_id").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("pending"),
  externalPostId: text("external_post_id"),
  errorMessage: text("error_message"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const automations = socialops.table("automations", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  platform: text("platform").notNull().default("all"),
  trigger: jsonb("trigger").notNull().default({}),
  condition: jsonb("condition").notNull().default({}),
  action: jsonb("action").notNull().default({}),
  rules: jsonb("rules").notNull().default({}),
  runsLast30d: integer("runs_last_30d").notNull().default(0),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const automationRuns = socialops.table("automation_runs", {
  id: uuid("id").primaryKey(),
  automationId: uuid("automation_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  triggerContext: jsonb("trigger_context"),
  status: text("status").notNull().default("running"),
  errorMessage: text("error_message"),
  dedupeKey: text("dedupe_key"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
})

export const notifications = socialops.table("notifications", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  userId: uuid("user_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = socialops.table("audit_log", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const comments = socialops.table("comments", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  socialAccountId: uuid("social_account_id"),
  provider: text("provider").notNull(),
  externalPostId: text("external_post_id"),
  externalCommentId: text("external_comment_id"),
  parentCommentId: uuid("parent_comment_id"),
  postExcerpt: text("post_excerpt"),
  authorName: text("author_name").notNull(),
  authorHandle: text("author_handle"),
  body: text("body").notNull(),
  sentiment: text("sentiment").notNull().default("neutral"),
  status: text("status").notNull().default("open"),
  leadId: uuid("lead_id"),
  markedAsLead: boolean("marked_as_lead").notNull().default(false),
  whatsappCtaSentAt: timestamp("whatsapp_cta_sent_at", { withTimezone: true }),
  dmSentAt: timestamp("dm_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const workspaceSettings = socialops.table("workspace_settings", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  defaultLanguage: text("default_language").notNull().default("en"),
  leadScoreThreshold: integer("lead_score_threshold").notNull().default(70),
  humanHandoffRules: jsonb("human_handoff_rules").notNull().default({}),
  notificationPreferences: jsonb("notification_preferences").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const providerAnalyticsSnapshots = socialops.table("provider_analytics_snapshots", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  socialAccountId: uuid("social_account_id"),
  provider: text("provider").notNull(),
  metricDate: date("metric_date").notNull(),
  followers: integer("followers"),
  impressions: integer("impressions"),
  reach: integer("reach"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  clicks: integer("clicks"),
  dmVolume: integer("dm_volume"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const calls = socialops.table("calls", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  leadId: uuid("lead_id"),
  provider: text("provider").notNull().default("omnidimension"),
  providerCallId: text("provider_call_id"),
  toNumber: text("to_number").notNull(),
  status: text("status").notNull().default("queued"),
  blockReason: text("block_reason"),
  requestedByUserId: uuid("requested_by_user_id"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  transcript: jsonb("transcript").notNull().default([]),
  summary: jsonb("summary"),
  sentiment: text("sentiment"),
  extractedVariables: jsonb("extracted_variables").notNull().default({}),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const mediaAssets = socialops.table("media_assets", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  storageKey: text("storage_key").notNull(),
  mediaType: text("media_type").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  originalFilename: text("original_filename").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const googleSheetsSelections = socialops.table("google_sheets_selections", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().unique(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  spreadsheetName: text("spreadsheet_name"),
  worksheetName: text("worksheet_name").notNull(),
  columnMapping: jsonb("column_mapping").notNull().default({}),
  selectedByUserId: uuid("selected_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const googleSheetsSyncedRows = socialops.table("google_sheets_synced_rows", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  worksheetName: text("worksheet_name").notNull(),
  rowNumber: integer("row_number").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastStatus: text("last_status").notNull().default("pending"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const meetings = socialops.table("meetings", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  leadId: uuid("lead_id"),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull(),
  attendeeEmails: text("attendee_emails").array().notNull().default([]),
  assignedToUserId: uuid("assigned_to_user_id"),
  status: text("status").notNull().default("scheduled"),
  calendarId: text("calendar_id"),
  externalEventId: text("external_event_id"),
  eventUrl: text("event_url"),
  meetLink: text("meet_link"),
  errorMessage: text("error_message"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
