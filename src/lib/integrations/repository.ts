import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { integrationConnections, integrationAuditLog } from "@/lib/db/schema"
import type { ProviderId, IntegrationMode, IntegrationStatus } from "./providers"

export interface IntegrationConnectionRow {
  id: string
  workspaceId: string
  provider: string
  mode: string
  status: string
  displayName: string | null
  config: Record<string, unknown>
  secretDataEncrypted: Record<string, string>
  lastTestedAt: Date | null
  lastSuccessAt: Date | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: Date
  updatedAt: Date
}

export async function getConnection(workspaceId: string, provider: ProviderId): Promise<IntegrationConnectionRow | null> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.provider, provider)))
      .limit(1)
    return (rows[0] as IntegrationConnectionRow) ?? null
  })
}

export async function listConnections(workspaceId: string): Promise<IntegrationConnectionRow[]> {
  return withDb(async (db) => {
    const rows = await db.select().from(integrationConnections).where(eq(integrationConnections.workspaceId, workspaceId))
    return rows as IntegrationConnectionRow[]
  })
}

export interface UpsertConnectionInput {
  workspaceId: string
  provider: ProviderId
  mode?: IntegrationMode
  status?: IntegrationStatus
  displayName?: string | null
  config?: Record<string, unknown>
  /** Already-encrypted blobs, merged over any existing ones (a field key
   * absent here leaves the previously-stored value untouched). */
  secretDataEncrypted?: Record<string, string>
  /** True whenever this call is actually writing new credential values.
   * A previous "Test Connection passed" is evidence about the credential
   * that was live at the time - it says nothing about a replacement
   * credential that has never itself been tested. Without this, changing
   * credentials on an already-live connection would silently leave it
   * reporting readyForLive/live with an entirely unverified value - a real
   * "No Fake Live Mode" gap. Clears the test-passed state and drops mode
   * out of "live" (the caller may re-request "live" in the same input,
   * which the API route is responsible for rejecting when fields also
   * changed - this only supplies the safe default for every other path,
   * e.g. a second, separate save call after the first). */
  resetTestState?: boolean
}

export async function upsertConnection(input: UpsertConnectionInput): Promise<IntegrationConnectionRow> {
  return withDb(async (db) => {
    const existing = await db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.workspaceId, input.workspaceId), eq(integrationConnections.provider, input.provider)))
      .limit(1)

    if (existing[0]) {
      const row = existing[0] as IntegrationConnectionRow
      const mergedConfig = { ...row.config, ...(input.config ?? {}) }
      const mergedSecrets = { ...row.secretDataEncrypted, ...(input.secretDataEncrypted ?? {}) }
      const [updated] = await db
        .update(integrationConnections)
        .set({
          mode: input.mode ?? (input.resetTestState && row.mode === "live" ? "demo" : row.mode),
          status: input.status ?? row.status,
          displayName: input.displayName !== undefined ? input.displayName : row.displayName,
          config: mergedConfig,
          secretDataEncrypted: mergedSecrets,
          ...(input.resetTestState
            ? { lastSuccessAt: null, lastTestedAt: null, lastErrorCode: null, lastErrorMessage: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(integrationConnections.id, row.id))
        .returning()
      return updated as IntegrationConnectionRow
    }

    const [created] = await db
      .insert(integrationConnections)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        provider: input.provider,
        mode: input.mode ?? "disabled",
        status: input.status ?? "not_configured",
        displayName: input.displayName ?? null,
        config: input.config ?? {},
        secretDataEncrypted: input.secretDataEncrypted ?? {},
      })
      .returning()
    return created as IntegrationConnectionRow
  })
}

export async function recordTestResult(
  workspaceId: string,
  provider: ProviderId,
  result: { ok: boolean; status: IntegrationStatus; errorCode?: string; errorMessage?: string }
): Promise<void> {
  await withDb(async (db) => {
    const now = new Date()
    await db
      .update(integrationConnections)
      .set({
        status: result.status,
        lastTestedAt: now,
        lastSuccessAt: result.ok ? now : undefined,
        lastErrorCode: result.ok ? null : (result.errorCode ?? "unknown"),
        lastErrorMessage: result.ok ? null : (result.errorMessage ?? null),
        updatedAt: now,
      })
      .where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.provider, provider)))
  })
}

export async function deleteConnection(workspaceId: string, provider: ProviderId): Promise<void> {
  await withDb(async (db) => {
    await db
      .delete(integrationConnections)
      .where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.provider, provider)))
  })
}

export type IntegrationAuditAction =
  | "integration_configured"
  | "integration_updated"
  | "integration_disabled"
  | "integration_deleted"
  | "connection_test_succeeded"
  | "connection_test_failed"
  /** An EasyLife platform operator changed which WhatsApp capabilities a
   * workspace is entitled to. Recorded because it changes what the client
   * can do, and "who turned bulk campaigns on for this client" is a question
   * that gets asked after something goes wrong, not before. */
  | "features_updated"

/** Never pass secret values in `metadata` — this is a durable log. */
export async function recordAuditEvent(
  workspaceId: string,
  provider: ProviderId,
  action: IntegrationAuditAction,
  actorUserId: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  await withDb(async (db) => {
    await db.insert(integrationAuditLog).values({
      id: randomUUID(),
      workspaceId,
      provider,
      action,
      actorUserId,
      metadata: metadata ?? null,
    })
  })
}
