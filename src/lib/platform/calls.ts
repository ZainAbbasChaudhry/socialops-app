import { randomUUID } from "node:crypto"
import { and, eq, desc } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { calls } from "@/lib/db/schema"
import type { Call, CallStatus, CallSummary, CallTranscriptLine } from "@/types"

/** Maps a DB row onto the existing pre-built Call UI type - the Call Agent
 * page consumes this unchanged, same pattern as posts/automations/etc. */
function rowToCall(row: typeof calls.$inferSelect): Call {
  return {
    id: row.id,
    leadId: row.leadId ?? "",
    status: row.status as CallStatus,
    providerCallId: row.providerCallId ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    endedAt: row.endedAt?.toISOString(),
    durationSeconds: row.durationSeconds ?? undefined,
    transcript: (row.transcript as CallTranscriptLine[]) ?? [],
    summary: (row.summary as CallSummary | null) ?? undefined,
  }
}

export async function listCalls(workspaceId: string, limit = 100): Promise<Call[]> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(calls)
      .where(eq(calls.workspaceId, workspaceId))
      .orderBy(desc(calls.createdAt))
      .limit(limit)
    return rows.map(rowToCall)
  })
}

export async function getCall(workspaceId: string, id: string): Promise<Call | null> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.workspaceId, workspaceId)))
      .limit(1)
    return rows[0] ? rowToCall(rows[0]) : null
  })
}

export interface QueueCallInput {
  workspaceId: string
  leadId: string
  toNumber: string
  requestedByUserId: string
  /** "queued" for automatic/pre-approved runs, "pending-approval" when
   * manual sign-off is required before a job may dispatch it. */
  initialStatus: "queued" | "pending-approval"
}

export async function queueCall(input: QueueCallInput): Promise<Call> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(calls)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        toNumber: input.toNumber,
        requestedByUserId: input.requestedByUserId,
        status: input.initialStatus,
      })
      .returning()
    return rowToCall(row)
  })
}

/** Records why a call was never queued/dispatched (no live provider, no
 * permission, etc.) - a real, visible row explaining the block, never a
 * silent no-op. */
export async function recordBlockedCall(input: {
  workspaceId: string
  leadId: string
  toNumber: string
  requestedByUserId: string
  reason: string
}): Promise<Call> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(calls)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        toNumber: input.toNumber,
        requestedByUserId: input.requestedByUserId,
        status: "blocked",
        blockReason: input.reason,
      })
      .returning()
    return rowToCall(row)
  })
}

export async function approveCall(workspaceId: string, id: string): Promise<Call | null> {
  return withDb(async (db) => {
    const [row] = await db
      .update(calls)
      .set({ status: "queued", updatedAt: new Date() })
      .where(and(eq(calls.id, id), eq(calls.workspaceId, workspaceId), eq(calls.status, "pending-approval")))
      .returning()
    return row ? rowToCall(row) : null
  })
}

export async function markCallDispatched(id: string, providerCallId: string): Promise<void> {
  await withDb(async (db) => {
    await db
      .update(calls)
      .set({ status: "dispatched", providerCallId, dispatchedAt: new Date(), updatedAt: new Date() })
      .where(eq(calls.id, id))
  })
}

export async function markCallFailed(id: string, error: string): Promise<void> {
  await withDb(async (db) => {
    await db.update(calls).set({ status: "failed", lastError: error.slice(0, 2000), updatedAt: new Date() }).where(eq(calls.id, id))
  })
}

export interface ApplyWebhookResultInput {
  provider: string
  providerCallId: string
  status: CallStatus
  transcript?: CallTranscriptLine[]
  summary?: CallSummary
  sentiment?: string
  extractedVariables?: Record<string, unknown>
  durationSeconds?: number
}

/** Applies a post-call webhook result to the matching call row, resolved
 * purely by (provider, provider_call_id) - the unique index this relies on
 * is what makes this safe across every workspace sharing one webhook URL.
 * Returns the resolved workspaceId (or null if no matching call exists, e.g.
 * a stale/replayed webhook after the call row was somehow removed) so the
 * caller can fire workspace-scoped side effects like a notification. */
export async function applyCallWebhookResult(input: ApplyWebhookResultInput): Promise<{ id: string; workspaceId: string; leadId: string | null } | null> {
  return withDb(async (db) => {
    const [row] = await db
      .update(calls)
      .set({
        status: input.status,
        transcript: input.transcript ?? undefined,
        summary: input.summary ?? undefined,
        sentiment: input.sentiment,
        extractedVariables: input.extractedVariables ?? undefined,
        durationSeconds: input.durationSeconds,
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(calls.provider, input.provider), eq(calls.providerCallId, input.providerCallId)))
      .returning({ id: calls.id, workspaceId: calls.workspaceId, leadId: calls.leadId })
    return row ?? null
  })
}
