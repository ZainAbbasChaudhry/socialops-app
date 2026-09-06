import { randomUUID } from "node:crypto"
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { leads, leadActivities } from "@/lib/db/schema"
import { leadRowToLead, activityRowToActivity } from "./mapper"
import type { Lead, LeadActivity, LeadActivityType } from "@/types"

export interface ListLeadsParams {
  workspaceId: string
  status?: string
  source?: string
  assignedTo?: string
  search?: string
  sort?: "created_at" | "updated_at" | "lead_score"
  order?: "asc" | "desc"
  limit?: number
  offset?: number
}

export async function listLeads(params: ListLeadsParams): Promise<{ leads: Lead[]; total: number }> {
  return withDb(async (db) => {
    const conditions = [eq(leads.workspaceId, params.workspaceId)]
    if (params.status) conditions.push(eq(leads.stage, params.status))
    if (params.source) conditions.push(eq(leads.sourcePlatform, params.source))
    if (params.assignedTo) conditions.push(eq(leads.assignedToUserId, params.assignedTo))
    if (params.search) {
      const term = `%${params.search}%`
      conditions.push(
        or(
          ilike(leads.name, term),
          ilike(leads.whatsappNumber, term),
          ilike(leads.email, term),
          ilike(leads.company, term)
        )!
      )
    }

    const where = and(...conditions)
    const limit = Math.min(params.limit ?? 50, 200)
    const offset = params.offset ?? 0

    const sortColumn = params.sort === "lead_score" ? leads.leadScore : params.sort === "created_at" ? leads.createdAt : leads.updatedAt
    const orderFn = params.order === "asc" ? sortColumn : desc(sortColumn)

    const [rows, countRows] = await Promise.all([
      db.select().from(leads).where(where).orderBy(orderFn).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(leads).where(where),
    ])

    return { leads: rows.map(leadRowToLead), total: Number(countRows[0]?.count ?? 0) }
  })
}

/** Used by the WhatsApp webhook pipeline to resolve an inbound message to
 * an existing lead before falling back to creating a new one. */
export async function findLeadByWhatsAppNumber(workspaceId: string, whatsappNumber: string): Promise<Lead | null> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(leads)
      .where(and(eq(leads.workspaceId, workspaceId), eq(leads.whatsappNumber, whatsappNumber)))
      .limit(1)
    const row = rows[0]
    return row ? leadRowToLead(row) : null
  })
}

export async function getLead(workspaceId: string, leadId: string): Promise<Lead | null> {
  return withDb(async (db) => {
    // Scoped by workspace_id + id together, per Phase 2's isolation rule —
    // a lead belonging to another workspace behaves as though it doesn't exist.
    const rows = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId))).limit(1)
    const row = rows[0]
    return row ? leadRowToLead(row) : null
  })
}

/** Batch equivalent of getLead - one query for many ids instead of one
 * query per id. Used anywhere a list of other rows (conversations, etc.)
 * needs each one's associated lead, to avoid an N+1 per row. */
export async function getLeadsByIds(workspaceId: string, leadIds: string[]): Promise<Map<string, Lead>> {
  if (leadIds.length === 0) return new Map()
  return withDb(async (db) => {
    const rows = await db.select().from(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.id, leadIds)))
    return new Map(rows.map((row) => [row.id, leadRowToLead(row)]))
  })
}

export interface CreateLeadInput {
  workspaceId: string
  actorUserId: string | null
  name: string
  whatsappNumber?: string
  email?: string
  company?: string
  city?: string
  businessType?: string
  location?: string
  sourcePlatform?: string
  sourceCampaign?: string
  serviceInterested?: string
  requirement?: string
  painPoint?: string
  budget?: string
  timeline?: string
  leadScore?: number
  stage?: string
  status?: string
  callPermission?: "yes" | "no" | "unknown"
  priority?: "low" | "medium" | "high"
  notes?: string
  tags?: string[]
}

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  return withDb(async (db) => {
    return db.transaction(async (tx) => {
      const id = randomUUID()
      const now = new Date()

      const [row] = await tx
        .insert(leads)
        .values({
          id,
          workspaceId: input.workspaceId,
          name: input.name,
          whatsappNumber: input.whatsappNumber,
          email: input.email,
          company: input.company,
          city: input.city,
          businessType: input.businessType,
          location: input.location,
          sourcePlatform: input.sourcePlatform ?? "direct",
          sourceCampaign: input.sourceCampaign,
          serviceInterested: input.serviceInterested,
          requirement: input.requirement,
          painPoint: input.painPoint,
          budget: input.budget,
          timeline: input.timeline,
          leadScore: input.leadScore ?? 0,
          stage: input.stage ?? "new",
          status: input.status ?? "cold",
          callPermission: input.callPermission ?? "unknown",
          priority: input.priority,
          notes: input.notes ?? "",
          tags: input.tags ?? [],
          lastInteractionAt: now,
        })
        .returning()

      await tx.insert(leadActivities).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        leadId: id,
        actorUserId: input.actorUserId,
        activityType: "created" satisfies LeadActivityType,
        description: `Lead created from ${row.sourcePlatform}`,
      })

      return leadRowToLead(row)
    })
  })
}

export interface UpdateLeadInput {
  name?: string
  whatsappNumber?: string | null
  email?: string | null
  company?: string | null
  city?: string | null
  businessType?: string | null
  location?: string | null
  serviceInterested?: string | null
  requirement?: string | null
  painPoint?: string | null
  budget?: string | null
  timeline?: string | null
  leadScore?: number
  stage?: string
  status?: string
  callPermission?: "yes" | "no" | "unknown"
  callStatus?: string | null
  meetingStatus?: string | null
  assignedToUserId?: string | null
  priority?: "low" | "medium" | "high" | null
  nextFollowUpAt?: string | null
  notes?: string
  tags?: string[]
  /** Set when the update is itself a contact with the lead - an inbound
   * WhatsApp message, a call, a reply. It was previously only ever written
   * at creation, so "last interaction" on a conversation months old still
   * showed the day the lead first appeared. */
  lastInteractionAt?: Date
}

/** Applies a patch inside a transaction and writes matching Lead Activity
 * rows for the fields Phase 2 calls out (status/score/assignment/notes),
 * so the timeline stays meaningful without every field edit becoming noise. */
export async function updateLead(
  workspaceId: string,
  leadId: string,
  actorUserId: string | null,
  patch: UpdateLeadInput
): Promise<Lead | null> {
  return withDb(async (db) => {
    return db.transaction(async (tx) => {
      const existingRows = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId))).limit(1)
      const existing = existingRows[0]
      if (!existing) return null

      const updateValues: Record<string, unknown> = { ...patch, updatedAt: new Date() }
      if (patch.nextFollowUpAt !== undefined) {
        updateValues.nextFollowUpAt = patch.nextFollowUpAt ? new Date(patch.nextFollowUpAt) : null
      }

      const [row] = await tx
        .update(leads)
        .set(updateValues)
        .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
        .returning()

      const activityInserts: (typeof leadActivities.$inferInsert)[] = []
      const logActivity = (type: LeadActivityType, description: string) =>
        activityInserts.push({ id: randomUUID(), workspaceId, leadId, actorUserId, activityType: type, description })

      if (patch.stage !== undefined && patch.stage !== existing.stage) {
        logActivity("status-changed", `Stage changed to "${patch.stage}"`)
      }
      if (patch.status !== undefined && patch.status !== existing.status) {
        logActivity("status-changed", `Status changed to "${patch.status}"`)
      }
      if (patch.leadScore !== undefined && patch.leadScore !== existing.leadScore) {
        logActivity("score-updated", `Lead score set to ${patch.leadScore}`)
      }
      if (patch.assignedToUserId !== undefined && patch.assignedToUserId !== existing.assignedToUserId) {
        logActivity("assigned", "Lead assignment changed")
      }
      if (patch.notes !== undefined && patch.notes !== existing.notes) {
        logActivity("note-added", "Note updated")
      }

      if (activityInserts.length > 0) {
        await tx.insert(leadActivities).values(activityInserts)
      }

      return leadRowToLead(row)
    })
  })
}

export async function listActivities(workspaceId: string, leadId: string): Promise<LeadActivity[]> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(leadActivities)
      .where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.workspaceId, workspaceId)))
      .orderBy(leadActivities.createdAt)
    return rows.map(activityRowToActivity)
  })
}

export async function createActivity(
  workspaceId: string,
  leadId: string,
  actorUserId: string | null,
  type: LeadActivityType,
  description: string
): Promise<LeadActivity | null> {
  return withDb(async (db) => {
    // Confirm the lead actually belongs to this workspace before writing —
    // never trust a leadId from the URL alone.
    const leadRows = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId))).limit(1)
    if (!leadRows[0]) return null

    const [row] = await db
      .insert(leadActivities)
      .values({ id: randomUUID(), workspaceId, leadId, actorUserId, activityType: type, description })
      .returning()
    return activityRowToActivity(row)
  })
}
