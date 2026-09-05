import { randomUUID } from "node:crypto"
import { and, eq, desc, sql } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { automations, automationRuns } from "@/lib/db/schema"
import type { Automation, AutomationStatus, AutomationStep, AutomationTriggerType, AutomationConditionType, AutomationActionType, AutomationRules, SocialPlatform } from "@/types"

function rowToAutomation(row: typeof automations.$inferSelect): Automation {
  return {
    id: row.id,
    name: row.name,
    status: row.status as AutomationStatus,
    platform: row.platform as SocialPlatform | "all",
    trigger: row.trigger as AutomationStep<AutomationTriggerType>,
    condition: row.condition as AutomationStep<AutomationConditionType>,
    action: row.action as AutomationStep<AutomationActionType>,
    rules: row.rules as AutomationRules,
    runsLast30d: row.runsLast30d,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
  }
}

export async function listAutomations(workspaceId: string): Promise<Automation[]> {
  return withDb(async (db) => {
    const rows = await db.select().from(automations).where(eq(automations.workspaceId, workspaceId))
    return rows.map(rowToAutomation)
  })
}

export interface CreateAutomationInput {
  workspaceId: string
  name: string
  platform: SocialPlatform | "all"
  trigger: AutomationStep<AutomationTriggerType>
  condition: AutomationStep<AutomationConditionType>
  action: AutomationStep<AutomationActionType>
  rules: AutomationRules
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(automations)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        platform: input.platform,
        trigger: input.trigger,
        condition: input.condition,
        action: input.action,
        rules: input.rules,
      })
      .returning()
    return rowToAutomation(row)
  })
}

export interface UpdateAutomationInput {
  name?: string
  status?: AutomationStatus
  platform?: SocialPlatform | "all"
  trigger?: AutomationStep<AutomationTriggerType>
  condition?: AutomationStep<AutomationConditionType>
  action?: AutomationStep<AutomationActionType>
  rules?: AutomationRules
}

export async function updateAutomation(workspaceId: string, id: string, patch: UpdateAutomationInput): Promise<Automation | null> {
  return withDb(async (db) => {
    const [row] = await db
      .update(automations)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(automations.id, id), eq(automations.workspaceId, workspaceId)))
      .returning()
    return row ? rowToAutomation(row) : null
  })
}

export async function deleteAutomation(workspaceId: string, id: string): Promise<void> {
  await withDb(async (db) => {
    await db.delete(automations).where(and(eq(automations.id, id), eq(automations.workspaceId, workspaceId)))
  })
}

export interface AutomationRun {
  id: string
  automationId: string
  status: string
  errorMessage: string | null
  triggerContext: Record<string, unknown> | null
  startedAt: string
  completedAt: string | null
}

function rowToRun(row: typeof automationRuns.$inferSelect): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    status: row.status,
    errorMessage: row.errorMessage,
    triggerContext: row.triggerContext as Record<string, unknown> | null,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

/** True if this exact automation has already recorded a run for this
 * dedupe key - the engine's guard against firing the same automation
 * twice for the same underlying event (a retried job, a duplicate
 * webhook delivery, etc). A dedupe key is caller-supplied and should
 * identify the *event*, not the automation - e.g. an inbound message's
 * own id, not a random uuid generated per dispatch. */
export async function hasRunForDedupeKey(automationId: string, dedupeKey: string): Promise<boolean> {
  return withDb(async (db) => {
    const rows = await db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.dedupeKey, dedupeKey)))
      .limit(1)
    return rows.length > 0
  })
}

/**
 * Records an automation run. Before ANY provider-facing action executes,
 * the caller must have already confirmed the relevant provider is
 * connected/live - a run against a provider that isn't ready gets recorded
 * as "blocked" with a clear reason, never silently treated as if the
 * external action happened. "pending-approval" is a real, incomplete state
 * (manual-approval mode automations stop here until a human approves) -
 * only "completed" counts toward runsLast30d/lastRunAt.
 */
export async function recordAutomationRun(
  workspaceId: string,
  automationId: string,
  status: "completed" | "blocked" | "failed" | "skipped" | "pending-approval",
  errorMessage?: string,
  triggerContext?: Record<string, unknown>,
  dedupeKey?: string
): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(automationRuns)
      .values({
        id: randomUUID(),
        automationId,
        workspaceId,
        triggerContext: triggerContext ?? null,
        status,
        errorMessage,
        dedupeKey,
        completedAt: status === "pending-approval" ? undefined : new Date(),
      })
      .returning({ id: automationRuns.id })

    if (status === "completed") {
      // Atomic - see the note in resolveAutomationRun. Two automations
      // completing concurrently both read the same value and both wrote
      // value+1, so the counter advanced by one for two runs.
      await db
        .update(automations)
        .set({ runsLast30d: sql`${automations.runsLast30d} + 1`, lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(automations.id, automationId))
    }

    return row.id
  })
}

export async function resolveAutomationRun(
  runId: string,
  status: "completed" | "blocked" | "failed",
  errorMessage?: string
): Promise<AutomationRun | null> {
  return withDb(async (db) => {
    // Only a run still awaiting approval can be resolved. The approve route
    // reads the run, executes the action, then calls this - a check-then-act
    // pair. Without this predicate two concurrent approvals (a double-click,
    // or two managers) both passed the read and both landed here, so the
    // action ran twice: two queued calls, two dispatch jobs, the lead phoned
    // twice, and runsLast30d incremented twice for one run. Now the second
    // resolver updates zero rows and gets null back.
    const [row] = await db
      .update(automationRuns)
      .set({ status, errorMessage, completedAt: new Date() })
      .where(and(eq(automationRuns.id, runId), eq(automationRuns.status, "pending-approval")))
      .returning()
    if (!row) return null

    if (status === "completed") {
      // Atomic increment - a read-then-write here lost updates whenever two
      // runs of the same automation completed concurrently.
      await db
        .update(automations)
        .set({ runsLast30d: sql`${automations.runsLast30d} + 1`, lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(automations.id, row.automationId))
    }

    return rowToRun(row)
  })
}

export async function getAutomationRun(workspaceId: string, runId: string): Promise<AutomationRun | null> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(automationRuns)
      .where(and(eq(automationRuns.id, runId), eq(automationRuns.workspaceId, workspaceId)))
      .limit(1)
    return rows[0] ? rowToRun(rows[0]) : null
  })
}

export async function listAutomationRuns(workspaceId: string, automationId: string, limit = 50): Promise<AutomationRun[]> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(automationRuns)
      .where(and(eq(automationRuns.workspaceId, workspaceId), eq(automationRuns.automationId, automationId)))
      .orderBy(desc(automationRuns.startedAt))
      .limit(limit)
    return rows.map(rowToRun)
  })
}

export async function getAutomation(workspaceId: string, id: string): Promise<Automation | null> {
  return withDb(async (db) => {
    const rows = await db.select().from(automations).where(and(eq(automations.id, id), eq(automations.workspaceId, workspaceId))).limit(1)
    return rows[0] ? rowToAutomation(rows[0]) : null
  })
}

/** All active automations for a workspace matching a given trigger type -
 * the engine's entry point for finding candidates to evaluate against a
 * real event. Paused/draft automations never match. */
export async function listActiveAutomationsForTrigger(workspaceId: string, triggerType: AutomationTriggerType): Promise<Automation[]> {
  return withDb(async (db) => {
    const rows = await db.select().from(automations).where(and(eq(automations.workspaceId, workspaceId), eq(automations.status, "active")))
    return rows.map(rowToAutomation).filter((a) => a.trigger.type === triggerType)
  })
}

/** Cross-workspace variant for the cron-driven "scheduled" trigger, which
 * has no single triggering workspace request to scope the lookup to - the
 * worker has to sweep every workspace's active automations of this type
 * each tick. */
export async function listAllActiveAutomationsByTriggerType(
  triggerType: AutomationTriggerType
): Promise<{ workspaceId: string; automation: Automation }[]> {
  return withDb(async (db) => {
    const rows = await db.select().from(automations).where(eq(automations.status, "active"))
    return rows
      .filter((row) => (row.trigger as AutomationStep<AutomationTriggerType>).type === triggerType)
      .map((row) => ({ workspaceId: row.workspaceId, automation: rowToAutomation(row) }))
  })
}
