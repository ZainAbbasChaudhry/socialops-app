/**
 * Shared domain types for the EasyLife dashboard.
 *
 * These model the multi-tenant shape of the product:
 * User -> Workspace -> Social Accounts -> Posts / Conversations / Comments / Automations / Analytics.
 *
 * Everything here is consumed through the mock data/service layer in
 * `src/lib/data` and the client-side stores in `src/lib/store` — no
 * component reaches into raw arrays directly, so swapping this for a real
 * backend later means rewriting those two layers, not the UI.
 */

export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "x"

export type ConnectionHealth = "connected" | "attention" | "expired" | "disconnected"

export interface User {
  id: string
  name: string
  email: string
  avatarUrl?: string
  role: "owner" | "admin" | "manager" | "sales"
}

export interface Workspace {
  id: string
  name: string
  slug: string
  plan: "starter" | "growth" | "scale"
  logoUrl?: string
}

export interface SocialAccount {
  id: string
  platform: SocialPlatform
  displayName: string
  handle: string
  followers: number
  followersDelta30d: number
  health: ConnectionHealth
  connectedAt: string | null
  lastSyncAt: string | null
  profileImageUrl?: string
}

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partially_failed" | "failed"

export type MediaType = "image" | "video"

export interface PostMedia {
  id: string
  type: MediaType
  /** Object URL (client-picked file, before upload finishes), a static
   * placeholder asset (demo mode), or /api/media/{mediaAssetId}/file (a
   * real, server-persisted upload) - only the last one is ever safe to
   * treat as publishable by a server-side job. */
  url: string
  name: string
  /** Set once this file has actually finished uploading to server-side
   * storage - undefined while still uploading, or for a demo/placeholder
   * entry that was never a real upload. A provider publish adapter must
   * never attempt to publish a PostMedia entry that lacks this. */
  mediaAssetId?: string
}

export interface PostVariant {
  platform: SocialPlatform
  /** Whether this platform is included when the post is saved/published. */
  enabled: boolean
  caption: string
  hashtags: string
  /** YouTube video title. */
  title?: string
  /** Instagram first-comment hashtag dump. */
  firstComment?: string
  /** YouTube/TikTok cover frame. */
  thumbnailUrl?: string
  /** Facebook/LinkedIn/X outbound link. */
  link?: string
}

export interface PostAnalytics {
  reach: number
  views: number
  likes: number
  comments: number
  shares: number
  engagementRate: number
}

export interface Post {
  id: string
  /** Internal label shown in lists — not published anywhere. */
  title: string
  status: PostStatus
  baseCaption: string
  baseHashtags: string
  media: PostMedia[]
  platforms: SocialPlatform[]
  variants: PostVariant[]
  scheduledFor?: string
  publishedAt?: string
  createdAt: string
  updatedAt: string
  author: Pick<User, "id" | "name">
  analytics?: PostAnalytics
  failureReason?: string
}

export type LeadStatus = "none" | "lead" | "customer"

export interface Conversation {
  id: string
  platform: SocialPlatform
  contactName: string
  contactHandle: string
  lastMessage: string
  lastMessageAt: string
  unread: boolean
  needsAttention: boolean
  resolved: boolean
  notes: string
  tags: string[]
  leadStatus: LeadStatus
  whatsappCtaSentAt?: string
}

export interface Message {
  id: string
  conversationId: string
  body: string
  sentAt: string
  direction: "inbound" | "outbound"
}

export type CommentSentiment = "positive" | "negative" | "question" | "neutral"
export type CommentStatus = "open" | "resolved" | "hidden"

export interface Comment {
  id: string
  platform: SocialPlatform
  postExcerpt: string
  postThumbnailColor: string
  authorName: string
  authorHandle: string
  body: string
  createdAt: string
  sentiment: CommentSentiment
  status: CommentStatus
  likedByMe: boolean
  markedAsLead?: boolean
  whatsappCtaSentAt?: string
  dmSentAt?: string
}

export type AutomationStatus = "active" | "paused" | "draft"
export type AutomationTriggerType =
  | "new-dm"
  | "new-comment"
  | "keyword"
  | "scheduled"
  | "lead-intent-detected"
  | "whatsapp-started"
  | "whatsapp-lead-qualified"
  | "lead-score-above"
  | "call-permission-received"
  | "call-completed"
  | "no-answer"
  | "meeting-booked"
  | "meeting-missed"
  | "qualified-lead-ready"
  | "human-sales-assigned"
export type AutomationConditionType = "contains-keyword" | "platform" | "sentiment" | "tag" | "none"
export type AutomationActionType =
  | "send-dm"
  | "reply"
  | "like"
  | "add-tag"
  | "mark-lead"
  | "assign-human"
  | "send-booking-link"
  | "send-whatsapp-cta"
  | "assign-lead"
  | "change-lead-status"
  | "queue-ai-call"
  | "schedule-ai-call"
  | "create-meeting"
  | "add-sheet-row"
  | "update-sheet-row"
  | "notify-team"
  | "escalate-human"
  | "schedule-follow-up"

export type AutomationRunMode = "manual-approval" | "automatic"

export interface AutomationRules {
  runMode: AutomationRunMode
  workingHoursOnly: boolean
  delayMinutes: number
  maxAttempts: number
  escalateAfterFailures: boolean
  assignedTo?: string
}

export interface AutomationStep<T extends string> {
  type: T
  label: string
  value?: string
}

export interface Automation {
  id: string
  name: string
  status: AutomationStatus
  platform: SocialPlatform | "all"
  trigger: AutomationStep<AutomationTriggerType>
  condition: AutomationStep<AutomationConditionType>
  action: AutomationStep<AutomationActionType>
  rules: AutomationRules
  runsLast30d: number
  lastRunAt: string | null
}

export type NotificationType =
  | "message"
  | "comment"
  | "publish-success"
  | "publish-failed"
  | "account-warning"
  | "automation"
  | "call-completed"

export interface Notification {
  id: string
  type: NotificationType
  title: string
  description: string
  createdAt: string
  read: boolean
}

export type ActivityStatus = "success" | "warning" | "error" | "info"

export interface ActivityItem {
  id: string
  type:
    | "post-published"
    | "message-received"
    | "account-connected"
    | "comment-received"
    | "automation-run"
    | "post-failed"
  status: ActivityStatus
  platform?: SocialPlatform
  title: string
  description: string
  timestamp: string
}

export type DateRangeOption = "today" | "7d" | "30d" | "90d"

export interface AnalyticsMetric {
  date: string
  likes: number
  comments: number
  shares: number
  views: number
  reach: number
}

export interface EngagementTotals {
  engagements: number
  engagementsDelta: number
  likes: number
  comments: number
  shares: number
  views: number
  reach: number
  likesDelta: number
  commentsDelta: number
  sharesDelta: number
  viewsDelta: number
  reachDelta: number
}

export interface EngagementPoint {
  date: string
  value: number
}

export interface FollowerGrowthPoint {
  date: string
  followers: number
}

export interface PlatformPerformance {
  platform: SocialPlatform
  reach: number
  engagementRate: number
  followers: number
}

export interface DashboardSummary {
  connectedAccounts: number
  totalAccounts: number
  postsPublished30d: number
  scheduledPosts: number
  totalFollowers: number
  totalFollowersDelta30d: number
  engagementRate30d: number
  engagementRateDelta30d: number
  newComments7d: number
  unreadDms: number
  pendingAutomationTasks: number
}

export type KnowledgeSourceType = "pdf" | "document" | "website" | "faq" | "product" | "service" | "pricing"
export type KnowledgeSourceStatus = "processing" | "ready" | "failed"

export interface KnowledgeSource {
  id: string
  name: string
  type: KnowledgeSourceType
  status: KnowledgeSourceStatus
  addedAt: string
}

export type AiCapability =
  | "caption"
  | "rewrite"
  | "hashtags"
  | "ideas"
  | "dm-reply"
  | "comment-reply"
  | "intent"
  | "repurpose"

export interface AiChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  /** Only set on assistant messages - "gemini" for a genuine AI reply,
   * "error" for the honest unavailable-message bubble shown when Gemini
   * couldn't be reached (never presented as if it were a real answer). */
  source?: "gemini" | "error"
}

/** Matches the real (platform/team.ts) TeamRole vocabulary exactly, so the
 * demo store and the real Team API describe roles the same way. */
export type TeamRole = "owner" | "admin" | "manager" | "sales"

export interface TeamMember {
  id: string
  name: string
  email: string
  role: TeamRole
  status: "active" | "invited"
}

export type IntegrationStatus = "connected" | "not-connected" | "coming-soon"

export interface Integration {
  id: string
  name: string
  description: string
  status: IntegrationStatus
  category: "crm" | "messaging" | "productivity" | "automation" | "ai"
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export type WhatsAppConnectionStatus = "connected" | "disconnected" | "expired" | "attention"

export interface WhatsAppAccount {
  id: string
  businessName: string
  /** The single EasyLife WhatsApp Business number. Display format, e.g. "+92 300 1234567". */
  number: string
  status: WhatsAppConnectionStatus
  connectedAt: string | null
  lastSyncAt: string | null
}

export type SendToWhatsAppMode = "manual" | "interested-only" | "all-new"

export const WHATSAPP_MESSAGE_VARIABLES = ["name", "platform", "campaign", "post", "service", "source"] as const
export type WhatsAppMessageVariable = (typeof WHATSAPP_MESSAGE_VARIABLES)[number]

// ---------------------------------------------------------------------------
// Leads / CRM
// ---------------------------------------------------------------------------

export type LeadStage =
  | "new"
  | "social-dm"
  | "whatsapp-started"
  | "qualifying"
  | "interested"
  | "qualified"
  | "call-scheduled"
  | "called"
  | "ready-for-sales"
  | "human-followup"
  | "meeting-booked"
  | "won"
  | "lost"

export type LeadPriority = "low" | "medium" | "high"

export type LeadIntentStatus =
  | "cold"
  | "warm"
  | "interested"
  | "qualified"
  | "not-interested"
  | "existing-customer"
  | "support"
  | "spam"
  | "human-review"

export interface LeadSource {
  platform: SocialPlatform | "direct" | "referral" | "website"
  campaign?: string
  originalPostId?: string
  originalPostExcerpt?: string
  originalCommentId?: string
  originalCommentExcerpt?: string
  originalConversationId?: string
}

export type CallPermission = "yes" | "no" | "unknown"

export interface LeadQualification {
  businessType?: string
  location?: string
  serviceInterested?: string
  requirement?: string
  budget?: string
  timeline?: string
  painPoint?: string
  goal?: string
  decisionMaker?: "yes" | "no" | "unknown"
  preferredLanguage?: string
  preferredCallTime?: string
}
export interface Lead {
  id: string
  name: string
  whatsappNumber?: string
  email?: string
  company?: string
  city?: string
  stage: LeadStage
  status: LeadIntentStatus
  score: number
  source: LeadSource
  qualification: LeadQualification
  callPermission: CallPermission
  callStatus?: CallStatus
  meetingStatus?: MeetingStatus
  assignedTo?: string
  priority?: LeadPriority
  nextFollowUpAt?: string
  createdAt: string
  updatedAt: string
  lastInteractionAt: string
  notes: string
  tags: string[]
}

export type LeadActivityType =
  | "created"
  | "dm-received"
  | "comment-received"
  | "whatsapp-cta-sent"
  | "whatsapp-started"
  | "whatsapp-message"
  | "qualification-updated"
  | "score-updated"
  | "status-changed"
  | "call-queued"
  | "call-attempted"
  | "call-completed"
  | "meeting-booked"
  | "meeting-completed"
  | "note-added"
  | "assigned"
  | "contacted"
  | "sheet-synced"

export interface LeadActivity {
  id: string
  leadId: string
  type: LeadActivityType
  description: string
  timestamp: string
}
export interface LeadScoreFactors {
  buyingIntent: number
  budget: number
  urgency: number
  serviceMatch: number
  decisionAuthority: number
  willingnessToMeet: number
  sentiment: number
  engagement: number
}

// ---------------------------------------------------------------------------
// Call Agent
// ---------------------------------------------------------------------------

export type CallStatus =
  | "ready"
  | "scheduled"
  | "calling"
  | "connected"
  | "no-answer"
  | "busy"
  | "call-back"
  | "interested"
  | "meeting-booked"
  | "not-interested"
  | "failed"
  // Real provider-dispatch lifecycle states (added alongside the OmniDimension
  // backend) - distinct from the outcome states above, which describe how a
  // completed call went, not whether it was ever placed.
  | "queued"
  | "pending-approval"
  | "dispatched"
  | "in-progress"
  | "completed"
  | "blocked"

export type CallMode = "manual" | "auto-qualified" | "scheduled"

export interface CallQueueItem {
  id: string
  leadId: string
  status: CallStatus
  preferredTime?: string
  scheduledFor?: string
  attempts: number
  maxAttempts: number
  createdAt: string
}

export interface CallTranscriptLine {
  id: string
  speaker: "agent" | "lead"
  text: string
  timestamp: string
}

export interface CallSummary {
  requirements?: string
  painPoints?: string
  budget?: string
  timeline?: string
  interestedService?: string
  objections?: string
  buyingIntent?: "low" | "medium" | "high"
  recommendedNextAction?: string
  updatedScore?: number
  meetingStatus?: "not-booked" | "booked" | "declined"
  followUpRequired?: boolean
}

export interface Call {
  id: string
  leadId: string
  status: CallStatus
  /** The provider's own id for this call, once it has accepted one. Its
   * presence is the proof the call was actually placed - job retries check
   * it so a worker crash can never dial the same person twice. */
  providerCallId?: string
  startedAt?: string
  endedAt?: string
  durationSeconds?: number
  transcript: CallTranscriptLine[]
  summary?: CallSummary
}

export interface CallAgentConfig {
  agentName: string
  companyName: string
  language: string
  voice: string
  greeting: string
  objective: string
  qualificationQuestions: string[]
  minimumLeadScore: number
  mode: CallMode
  humanApproval: boolean
  callingHoursStart: string
  callingHoursEnd: string
  timezone: string
  maxAttempts: number
  assignedSalesPerson?: string
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export type MeetingStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no-show"

export interface Meeting {
  id: string
  leadId: string
  date: string
  time: string
  timezone: string
  customerName: string
  phone?: string
  email?: string
  service?: string
  assignedTo?: string
  meetingLink?: string
  status: MeetingStatus
  notes?: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Google Sheets sync
// ---------------------------------------------------------------------------

export type SyncStatus = "connected" | "not-connected" | "error"

export interface GoogleSheetSync {
  status: SyncStatus
  sheetUrl?: string
  lastSyncAt: string | null
  rowsAdded: number
  errors: number
}

// ---------------------------------------------------------------------------
// Usage & costs (demo tracking)
// ---------------------------------------------------------------------------

export interface UsageMetric {
  label: string
  used: number
  unit: string
  estimatedCost: number
}

export interface UsageSummary {
  metrics: UsageMetric[]
  estimatedMonthlyCost: number
  budgetThreshold: number
}
