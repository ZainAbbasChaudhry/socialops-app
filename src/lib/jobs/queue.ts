import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { getPool, withDb } from "@/lib/db/client"
import { jobs } from "@/lib/db/schema"

/**
 * PostgreSQL-backed job queue - no Redis, since this runs on shared
 * hosting with no guarantee of one being available. Claiming uses
 * `FOR UPDATE SKIP LOCKED` so two concurrent workers (or two overlapping
 * cron invocations) can never grab the same job.
 */

export type JobType =
  | "provider_webhook"
  | "send_message"
  | "publish_post"
  | "refresh_token"
  | "fetch_analytics"
  | "sync_comments"
  | "sync_messages"
  | "schedule_post"
  | "qualification"
  | "lead_followup"
  | "dispatch_call"
  | "instagram_poll_publish"
  | "tiktok_poll_publish"

/** Thrown by a handler for a failure that no amount of retrying will ever
 * fix - malformed job payload, missing/invalid credentials, a config that
 * requires human action (connect a provider, fix an Agent ID). The worker
 * (see /api/cron/run-jobs) fails the job immediately on this, skipping the
 * exponential backoff a generic Error still gets - that backoff exists for
 * genuinely transient failures (rate limits, 5xx, timeouts, network
 * blips), not for errors where attempt 2 would fail for the exact same
 * reason as attempt 1. */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NonRetryableJobError"
  }
}

export interface EnqueueJobInput {
  workspaceId: string
  type: JobType
  payload?: Record<string, unknown>
  availableAt?: Date
  maxAttempts?: number
}

export async function enqueueJob(input: EnqueueJobInput): Promise<string> {
  const id = randomUUID()
  await withDb(async (db) => {
    await db.insert(jobs).values({
      id,
      workspaceId: input.workspaceId,
      type: input.type,
      payload: input.payload ?? {},
      availableAt: input.availableAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 3,
    })
  })
  return id
}

export interface ClaimedJob {
  id: string
  workspaceId: string
  type: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
}

/**
 * How long a worker may hold a job before another worker may take it over.
 *
 * This is a crash-recovery lease, not a timeout: a worker that dies mid-job
 * (container recycled, deploy, OOM) leaves the row at status 'running' with
 * nobody working on it. Nothing else would ever move it, so before this the
 * job was stuck forever - `locked_at`/`locked_by` were written on every claim
 * and then never read by anything.
 *
 * It must be comfortably LONGER than the slowest legitimate job, because a
 * lease that expires while a worker is still running means the job runs
 * twice. Fifteen minutes is far past anything in `handlers.ts` (the longest
 * are provider API calls with their own much shorter timeouts).
 */
const LEASE_MINUTES = 15

/** Atomically claims and locks up to `limit` due jobs for this worker -
 * pending ones, plus any whose lease has expired because the worker holding
 * them died. Uses a raw query (rather than the query builder) specifically
 * for `FOR UPDATE SKIP LOCKED`, which Drizzle's builder doesn't expose
 * cleanly combined with a correlated subquery + row lock. */
export async function claimJobs(workerId: string, limit = 5): Promise<ClaimedJob[]> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query(
      `UPDATE socialops.jobs
       SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM socialops.jobs
         WHERE (status = 'pending' AND available_at <= now())
            -- A job left 'running' by a worker that died. Taking it over
            -- costs an attempt, exactly as a crash should, so a job that
            -- keeps killing its worker exhausts its attempts and stops
            -- instead of cycling forever.
            OR (status = 'running' AND locked_at IS NOT NULL
                AND locked_at < now() - ($3 || ' minutes')::interval
                AND attempts < max_attempts)
         ORDER BY available_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, workspace_id, type, payload, attempts, max_attempts`,
      [workerId, limit, String(LEASE_MINUTES)]
    )
    await client.query("COMMIT")
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      type: r.type,
      payload: r.payload,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
    }))
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/**
 * Fails jobs whose lease expired and whose attempts are exhausted.
 *
 * `claimJobs` deliberately refuses to retake those - otherwise a job that
 * kills its worker every time would cycle forever - which would leave them
 * sitting at 'running' looking active. This gives them the honest ending:
 * permanently failed, with a reason that says what actually happened rather
 * than a provider error that never occurred.
 *
 * Returns how many it closed, so the worker can report it.
 */
export async function expireDeadJobs(): Promise<number> {
  const pool = getPool()
  const { rowCount } = await pool.query(
    `UPDATE socialops.jobs
     SET status = 'failed',
         last_error = 'Worker stopped responding; no attempts left.',
         updated_at = now()
     WHERE status = 'running'
       AND locked_at IS NOT NULL
       AND locked_at < now() - ($1 || ' minutes')::interval
       AND attempts >= max_attempts`,
    [String(LEASE_MINUTES)]
  )
  return rowCount ?? 0
}

export async function completeJob(id: string): Promise<void> {
  await withDb(async (db) => {
    await db.update(jobs).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, id))
  })
}

/** Marks a job failed. Retries with exponential-ish backoff (2^attempts
 * minutes, capped) if attempts remain, otherwise marks it permanently
 * failed - never silently retries forever. `nonRetryable` (see
 * NonRetryableJobError) skips straight to permanently failed regardless of
 * attempts remaining - retrying a config error on the same schedule as a
 * rate limit just delays the failure notification for no benefit. */
export async function failJob(id: string, attempts: number, maxAttempts: number, error: string, nonRetryable = false): Promise<void> {
  const exhausted = nonRetryable || attempts >= maxAttempts
  const backoffMinutes = Math.min(60, 2 ** attempts)
  await withDb(async (db) => {
    await db
      .update(jobs)
      .set({
        status: exhausted ? "failed" : "pending",
        lastError: error.slice(0, 2000),
        availableAt: exhausted ? undefined : new Date(Date.now() + backoffMinutes * 60000),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id))
  })
}
