import { randomUUID } from "node:crypto"
import { and, eq, desc, lte, asc } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import {
  integrationConnections,
  whatsappAccounts,
  whatsappConversations,
  whatsappMessages,
  whatsappConversationNotes,
  whatsappQuickReplies,
  users,
  leads,
} from "@/lib/db/schema"

/**
 * Webhook deliveries arrive with no session/cookie — the workspace has to
 * be resolved from data IN the (still-unverified) payload, then the
 * signature is checked using that workspace's own stored secret before
 * anything is trusted. These lookups intentionally scan across all
 * workspaces (there is no authenticated caller yet to scope by).
 */
export interface WhatsAppWorkspaceContext {
  workspaceId: string
  wabaId: string
  phoneNumberId: string
  accessTokenEncrypted: string | null
  appSecretEncrypted: string | null
  verifyTokenEncrypted: string | null
}

export async function findWhatsAppContextByWaba(wabaId: string): Promise<WhatsAppWorkspaceContext | null> {
  return withDb(async (db) => {
    const rows = await db.select().from(integrationConnections).where(eq(integrationConnections.provider, "whatsapp"))
    const match = rows.find((r) => (r.config as Record<string, unknown>)?.wabaId === wabaId)
    if (!match) return null
    const config = match.config as Record<string, unknown>
    const secrets = match.secretDataEncrypted as Record<string, string>
    return {
      workspaceId: match.workspaceId,
      wabaId,
      phoneNumberId: (config.phoneNumberId as string) ?? "",
      accessTokenEncrypted: secrets.accessToken ?? null,
      appSecretEncrypted: secrets.appSecret ?? null,
      verifyTokenEncrypted: secrets.verifyToken ?? null,
    }
  })
}

export async function findWhatsAppContextByVerifyToken(verifyTokenPlaintext: string, decrypt: (blob: string) => string | null): Promise<boolean> {
  return withDb(async (db) => {
    const rows = await db.select().from(integrationConnections).where(eq(integrationConnections.provider, "whatsapp"))
    return rows.some((r) => {
      const secrets = r.secretDataEncrypted as Record<string, string>
      const blob = secrets.verifyToken
      if (!blob) return false
      const decrypted = decrypt(blob)
      return decrypted !== null && decrypted === verifyTokenPlaintext
    })
  })
}

export async function ensureWhatsAppAccount(
  workspaceId: string,
  integrationConnectionId: string | null,
  phoneNumberId: string,
  wabaId: string,
  displayPhoneNumber: string | null
) {
  return withDb(async (db) => {
    const existing = await db
      .select()
      .from(whatsappAccounts)
      .where(and(eq(whatsappAccounts.workspaceId, workspaceId), eq(whatsappAccounts.phoneNumberId, phoneNumberId)))
      .limit(1)
    if (existing[0]) return existing[0]

    const [created] = await db
      .insert(whatsappAccounts)
      .values({
        id: randomUUID(),
        workspaceId,
        integrationConnectionId,
        phoneNumberId,
        wabaId,
        displayPhoneNumber,
      })
      .returning()
    return created
  })
}

export async function ensureConversation(workspaceId: string, whatsappAccountId: string, contactPhone: string) {
  return withDb(async (db) => {
    const existing = await db
      .select()
      .from(whatsappConversations)
      .where(and(eq(whatsappConversations.whatsappAccountId, whatsappAccountId), eq(whatsappConversations.contactPhone, contactPhone)))
      .limit(1)
    if (existing[0]) return existing[0]

    const [created] = await db
      .insert(whatsappConversations)
      .values({ id: randomUUID(), workspaceId, whatsappAccountId, contactPhone })
      .returning()
    return created
  })
}

export async function getConversationById(workspaceId: string, conversationId: string) {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(whatsappConversations)
      .where(and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.workspaceId, workspaceId)))
      .limit(1)
    return rows[0] ?? null
  })
}

/** Permanently deletes a conversation and everything scoped to it (its
 * messages and internal notes) - for cleaning up test/demo threads before
 * go-live, not a routine action (no undo). The linked lead, if any, is left
 * alone - only this conversation and its own child rows go. */
export async function deleteConversation(workspaceId: string, conversationId: string): Promise<boolean> {
  return withDb(async (db) => {
    return db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: whatsappConversations.id })
        .from(whatsappConversations)
        .where(and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.workspaceId, workspaceId)))
        .limit(1)
      if (!existing[0]) return false

      await tx.delete(whatsappMessages).where(eq(whatsappMessages.conversationId, conversationId))
      await tx.delete(whatsappConversationNotes).where(eq(whatsappConversationNotes.conversationId, conversationId))
      const [deleted] = await tx
        .delete(whatsappConversations)
        .where(and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.workspaceId, workspaceId)))
        .returning({ id: whatsappConversations.id })
      return Boolean(deleted)
    })
  })
}

export type ConversationResolutionStatus = "open" | "pending" | "resolved" | "snoozed"
export type ConversationAiMode = "auto" | "suggest" | "off"

export async function updateConversation(
  workspaceId: string,
  conversationId: string,
  patch: Partial<{
    leadId: string | null
    status: string
    resolutionStatus: ConversationResolutionStatus
    snoozedUntil: Date | null
    botState: Record<string, unknown>
    lastMessageAt: Date
    lastInboundMessageAt: Date
    lastOutboundMessageAt: Date
    firstInboundMessageAt: Date
    firstResponseAt: Date
    aiMode: ConversationAiMode
    pendingAiReply: string | null
  }>
) {
  return withDb(async (db) => {
    const [updated] = await db
      .update(whatsappConversations)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.workspaceId, workspaceId)))
      .returning()
    return updated ?? null
  })
}

/** Sets the resolution workflow status. Resolving or marking pending always
 * clears any snooze; snoozing requires an explicit wake time. */
export async function setConversationResolutionStatus(
  workspaceId: string,
  conversationId: string,
  resolutionStatus: ConversationResolutionStatus,
  snoozedUntil?: Date | null
) {
  return updateConversation(workspaceId, conversationId, {
    resolutionStatus,
    snoozedUntil: resolutionStatus === "snoozed" ? (snoozedUntil ?? null) : null,
  })
}

/** Sets the standing AI reply mode. Switching away from 'suggest' clears
 * any unacted-on draft so a stale suggestion never lingers once the agent
 * has changed how they want this conversation handled. */
export async function setConversationAiMode(workspaceId: string, conversationId: string, aiMode: ConversationAiMode) {
  return updateConversation(workspaceId, conversationId, {
    aiMode,
    ...(aiMode === "suggest" ? {} : { pendingAiReply: null }),
  })
}

/** Returns `null` if this external message ID was already recorded for this
 * conversation — the caller's cue to skip reprocessing (idempotency). */
export async function insertInboundMessageIfNew(
  workspaceId: string,
  conversationId: string,
  externalMessageId: string,
  messageType: string,
  body: string | null,
  rawMetadata: Record<string, unknown>
) {
  return withDb(async (db) => {
    const existing = await db
      .select({ id: whatsappMessages.id })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.conversationId, conversationId), eq(whatsappMessages.externalMessageId, externalMessageId)))
      .limit(1)
    if (existing[0]) return null

    const [created] = await db
      .insert(whatsappMessages)
      .values({
        id: randomUUID(),
        workspaceId,
        conversationId,
        externalMessageId,
        direction: "inbound",
        messageType,
        body,
        providerStatus: "received",
        sender: "customer",
        rawMetadata,
      })
      .returning()
    return created
  })
}

export async function insertOutboundMessage(
  workspaceId: string,
  conversationId: string,
  body: string,
  sender: "bot" | "agent" | "automation",
  externalMessageId: string | null,
  providerStatus: "sent" | "failed"
) {
  return withDb(async (db) => {
    const [created] = await db
      .insert(whatsappMessages)
      .values({
        id: randomUUID(),
        workspaceId,
        conversationId,
        externalMessageId,
        direction: "outbound",
        messageType: "text",
        body,
        providerStatus,
        sender,
      })
      .returning()
    return created
  })
}

export async function insertOutboundMediaMessage(
  workspaceId: string,
  conversationId: string,
  messageType: string,
  body: string | null,
  sender: "agent" | "automation",
  externalMessageId: string | null,
  providerStatus: "sent" | "failed",
  media: { storageKey: string; mimeType: string; filename: string | null; sizeBytes: number }
) {
  return withDb(async (db) => {
    const [created] = await db
      .insert(whatsappMessages)
      .values({
        id: randomUUID(),
        workspaceId,
        conversationId,
        externalMessageId,
        direction: "outbound",
        messageType,
        body,
        providerStatus,
        sender,
        mediaStorageKey: media.storageKey,
        mediaMimeType: media.mimeType,
        mediaFilename: media.filename,
        mediaSizeBytes: media.sizeBytes,
      })
      .returning()
    return created
  })
}

/** Attaches a stored attachment to an already-inserted INBOUND message -
 * split from insertion because downloading from Meta's CDN happens after
 * the message row is created (and the row must exist either way, download
 * success or not). */
export async function setInboundMessageMedia(
  workspaceId: string,
  messageId: string,
  media: { storageKey: string; mimeType: string; filename: string | null; sizeBytes: number }
) {
  return withDb(async (db) => {
    const [updated] = await db
      .update(whatsappMessages)
      .set({
        mediaStorageKey: media.storageKey,
        mediaMimeType: media.mimeType,
        mediaFilename: media.filename,
        mediaSizeBytes: media.sizeBytes,
      })
      .where(and(eq(whatsappMessages.id, messageId), eq(whatsappMessages.workspaceId, workspaceId)))
      .returning()
    return updated ?? null
  })
}

/** Scoped by conversation AND workspace, like every other per-message
 * lookup here, so the media-serving route can't be used to pull a message
 * from a conversation the caller doesn't own by guessing an id. */
export async function getMessageInConversation(workspaceId: string, conversationId: string, messageId: string) {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.id, messageId),
          eq(whatsappMessages.conversationId, conversationId),
          eq(whatsappMessages.workspaceId, workspaceId)
        )
      )
      .limit(1)
    return rows[0] ?? null
  })
}

/** Applies a Meta delivery/read-receipt callback (`value.statuses[]`) to the
 * matching outbound message, keyed by the Cloud API's own message id. Only
 * advances status forward (read implies delivered implies sent) so an
 * out-of-order delivery receipt can never downgrade an already-read tick -
 * Meta does not guarantee callback ordering. No-ops (returns null) if the
 * message isn't found, which just means it predates this feature or belongs
 * to another workspace's delivery. */
const STATUS_RANK: Record<string, number> = { sent: 0, delivered: 1, read: 2, failed: 3 }

export async function applyMessageStatusUpdate(
  workspaceId: string,
  externalMessageId: string,
  status: "sent" | "delivered" | "read" | "failed"
) {
  return withDb(async (db) => {
    const existing = await db
      .select({ id: whatsappMessages.id, providerStatus: whatsappMessages.providerStatus })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.externalMessageId, externalMessageId)))
      .limit(1)
    const current = existing[0]
    if (!current) return null

    // "failed" always applies; otherwise only move forward in the lifecycle.
    const currentRank = STATUS_RANK[current.providerStatus] ?? -1
    if (status !== "failed" && STATUS_RANK[status] <= currentRank) return null

    const [updated] = await db
      .update(whatsappMessages)
      .set({ providerStatus: status })
      .where(eq(whatsappMessages.id, current.id))
      .returning()
    return updated ?? null
  })
}

export async function listMessages(workspaceId: string, conversationId: string, limit = 50) {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.conversationId, conversationId), eq(whatsappMessages.workspaceId, workspaceId)))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(limit)
    return rows.reverse()
  })
}

export interface ConversationNoteView {
  id: string
  body: string
  authorName: string | null
  createdAt: Date
}

/** Agent-only note on a conversation - never sent to the customer, never
 * touches the Cloud API. Confirms the conversation belongs to this
 * workspace before writing, same pattern as createActivity for leads. */
export async function addConversationNote(
  workspaceId: string,
  conversationId: string,
  authorUserId: string | null,
  body: string
): Promise<ConversationNoteView | null> {
  return withDb(async (db) => {
    const conv = await db
      .select({ id: whatsappConversations.id })
      .from(whatsappConversations)
      .where(and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.workspaceId, workspaceId)))
      .limit(1)
    if (!conv[0]) return null

    const [row] = await db
      .insert(whatsappConversationNotes)
      .values({ id: randomUUID(), workspaceId, conversationId, authorUserId, body })
      .returning()

    let authorName: string | null = null
    if (authorUserId) {
      const authorRows = await db.select({ name: users.name }).from(users).where(eq(users.id, authorUserId)).limit(1)
      authorName = authorRows[0]?.name ?? null
    }
    return { id: row.id, body: row.body, authorName, createdAt: row.createdAt }
  })
}

export async function listConversationNotes(workspaceId: string, conversationId: string): Promise<ConversationNoteView[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({
        id: whatsappConversationNotes.id,
        body: whatsappConversationNotes.body,
        createdAt: whatsappConversationNotes.createdAt,
        authorName: users.name,
      })
      .from(whatsappConversationNotes)
      .leftJoin(users, eq(users.id, whatsappConversationNotes.authorUserId))
      .where(
        and(eq(whatsappConversationNotes.conversationId, conversationId), eq(whatsappConversationNotes.workspaceId, workspaceId))
      )
      .orderBy(whatsappConversationNotes.createdAt)
    return rows
  })
}

export async function listConversations(workspaceId: string, limit = 100) {
  return withDb(async (db) => {
    // Lazily wake expired snoozes on read rather than running a cron job -
    // nothing else depends on the wake happening at the exact instant, only
    // on the list screen reflecting it by the next time someone looks.
    await db
      .update(whatsappConversations)
      .set({ resolutionStatus: "open", snoozedUntil: null, updatedAt: new Date() })
      .where(
        and(
          eq(whatsappConversations.workspaceId, workspaceId),
          eq(whatsappConversations.resolutionStatus, "snoozed"),
          lte(whatsappConversations.snoozedUntil, new Date())
        )
      )

    return db
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.workspaceId, workspaceId))
      .orderBy(desc(whatsappConversations.lastMessageAt))
      .limit(limit)
  })
}

// ---------------------------------------------------------------------------
// Quick replies - saved templates with a `/shortcut`, shared workspace-wide.
// See migrations/0016_quick_replies.sql.
// ---------------------------------------------------------------------------

export async function listQuickReplies(workspaceId: string) {
  return withDb(async (db) => {
    return db
      .select()
      .from(whatsappQuickReplies)
      .where(eq(whatsappQuickReplies.workspaceId, workspaceId))
      .orderBy(asc(whatsappQuickReplies.shortcut))
  })
}

/** Returns `null` on a duplicate shortcut (case-insensitive) within the
 * workspace, rather than letting the DB's unique index throw - the API
 * route turns that into a normal 409 instead of a 500. */
export async function createQuickReply(
  workspaceId: string,
  createdByUserId: string | null,
  shortcut: string,
  title: string,
  body: string
) {
  return withDb(async (db) => {
    const normalized = shortcut.toLowerCase()
    const existing = await db.select({ shortcut: whatsappQuickReplies.shortcut }).from(whatsappQuickReplies).where(eq(whatsappQuickReplies.workspaceId, workspaceId))
    if (existing.some((r) => r.shortcut.toLowerCase() === normalized)) return null

    const [created] = await db
      .insert(whatsappQuickReplies)
      .values({ id: randomUUID(), workspaceId, shortcut, title, body, createdByUserId })
      .returning()
    return created
  })
}

export async function updateQuickReply(
  workspaceId: string,
  id: string,
  patch: Partial<{ shortcut: string; title: string; body: string }>
) {
  return withDb(async (db) => {
    const [updated] = await db
      .update(whatsappQuickReplies)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(whatsappQuickReplies.id, id), eq(whatsappQuickReplies.workspaceId, workspaceId)))
      .returning()
    return updated ?? null
  })
}

export async function deleteQuickReply(workspaceId: string, id: string) {
  return withDb(async (db) => {
    const [deleted] = await db
      .delete(whatsappQuickReplies)
      .where(and(eq(whatsappQuickReplies.id, id), eq(whatsappQuickReplies.workspaceId, workspaceId)))
      .returning({ id: whatsappQuickReplies.id })
    return Boolean(deleted)
  })
}

// ---------------------------------------------------------------------------
// Reporting - raw per-conversation rows for the WhatsApp dashboard's
// Reports tab. Aggregation itself lives in ./analytics.ts (kept pure/
// testable, no DB access) - this just gets the rows, joining in the
// assignee straight from the linked lead rather than requiring a second
// round trip, same join leads-by-id already does for the live list.
// ---------------------------------------------------------------------------

export interface ConversationAnalyticsRow {
  id: string
  resolutionStatus: ConversationResolutionStatus
  firstInboundMessageAt: Date | null
  firstResponseAt: Date | null
  updatedAt: Date
  assignedToUserId: string | null
}

export async function listConversationsForAnalytics(workspaceId: string): Promise<ConversationAnalyticsRow[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({
        id: whatsappConversations.id,
        resolutionStatus: whatsappConversations.resolutionStatus,
        firstInboundMessageAt: whatsappConversations.firstInboundMessageAt,
        firstResponseAt: whatsappConversations.firstResponseAt,
        updatedAt: whatsappConversations.updatedAt,
        assignedToUserId: leads.assignedToUserId,
      })
      .from(whatsappConversations)
      .leftJoin(leads, eq(leads.id, whatsappConversations.leadId))
      .where(eq(whatsappConversations.workspaceId, workspaceId))
    return rows.map((r) => ({
      ...r,
      resolutionStatus: r.resolutionStatus as ConversationResolutionStatus,
      assignedToUserId: r.assignedToUserId ?? null,
    }))
  })
}
