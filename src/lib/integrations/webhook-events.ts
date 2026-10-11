import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { webhookEvents } from "@/lib/db/schema"

/**
 * Centralized webhook-event log shared by every webhook-capable provider.
 * This sits alongside (not instead of) a provider's own domain-specific
 * idempotency check (e.g. WhatsApp's UNIQUE(conversation_id,
 * external_message_id) on whatsapp_messages, which is the authoritative
 * dedupe for message content) - this table exists for cross-provider
 * observability/debugging without storing full raw payloads long-term.
 */

export interface RecordWebhookEventInput {
  provider: string
  workspaceId: string | null
  externalEventId?: string
  eventType?: string
  /** Small, sanitized summary only (e.g. message type + ids) - never the
   * full raw payload, and never a value that could contain a secret. */
  payloadSummary?: Record<string, unknown>
}

/** Returns the new row, or `null` if this (provider, externalEventId) pair
 * was already recorded - the caller's cue to skip reprocessing. Relies on
 * the partial unique index on (provider, external_event_id) (see migration
 * 0010) for atomicity under concurrent redelivery - `onConflictDoNothing`
 * makes this safe even if two deliveries for the same event race each
 * other, unlike a plain select-then-insert. Safe to call even when
 * externalEventId is absent (each such call is treated as unique, since
 * there's nothing to dedupe against - the partial index excludes NULLs). */
export async function recordWebhookEvent(input: RecordWebhookEventInput): Promise<{ id: string } | null> {
  return withDb(async (db) => {
    const [created] = await db
      .insert(webhookEvents)
      .values({
        id: randomUUID(),
        provider: input.provider,
        workspaceId: input.workspaceId,
        externalEventId: input.externalEventId ?? null,
        eventType: input.eventType ?? null,
        payloadSummary: input.payloadSummary ?? null,
      })
      .onConflictDoNothing({
        target: [webhookEvents.provider, webhookEvents.externalEventId],
        // Must be an unqualified column reference to match the partial
        // unique index's own predicate (migration 0010). Drizzle's
        // isNotNull(webhookEvents.externalEventId) here renders a
        // schema-qualified "socialops"."webhook_events"."external_event_id"
        // reference, which Postgres rejects in this clause position with
        // "invalid reference to FROM-clause entry for table
        // 'webhook_events'" (42P01) - the insert's own target table isn't
        // addressable that way inside its own ON CONFLICT predicate. This
        // was silently crashing every single inbound WhatsApp webhook
        // delivery before a conversation row could ever be created.
        where: sql`external_event_id is not null`,
      })
      .returning({ id: webhookEvents.id })
    return created ?? null
  })
}

export async function markWebhookEventProcessed(id: string): Promise<void> {
  await withDb(async (db) => {
    await db
      .update(webhookEvents)
      .set({ processingStatus: "processed", processedAt: new Date() })
      .where(eq(webhookEvents.id, id))
  })
}

export async function markWebhookEventFailed(id: string, errorCode: string): Promise<void> {
  await withDb(async (db) => {
    await db
      .update(webhookEvents)
      .set({ processingStatus: "failed", errorCode, processedAt: new Date() })
      .where(eq(webhookEvents.id, id))
  })
}
