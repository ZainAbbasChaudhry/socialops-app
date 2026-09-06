import { randomUUID } from "node:crypto"
import { and, asc, desc, eq } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { knowledgeEntries } from "@/lib/db/schema"

/**
 * The client's own answers - what they sell, what it costs, what they get
 * asked all day. This is the difference between a bot that interrogates a
 * customer and one that actually helps them.
 *
 * Everything here is scoped by workspace on both read and write. A knowledge
 * entry is a thing the bot will say out loud in the client's name, so one
 * workspace's prices must never be reachable from another's.
 */

export const KNOWLEDGE_KINDS = ["service", "price", "faq", "policy"] as const
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number]

export interface KnowledgeEntry {
  id: string
  kind: KnowledgeKind
  title: string
  body: string
  price: string | null
  keywords: string[]
  active: boolean
  sortOrder: number
  updatedAt: string
}

export interface KnowledgeEntryInput {
  id?: string
  kind: KnowledgeKind
  title: string
  body: string
  price?: string | null
  keywords?: string[]
  active?: boolean
  sortOrder?: number
}

type Row = typeof knowledgeEntries.$inferSelect

function rowToEntry(row: Row): KnowledgeEntry {
  return {
    id: row.id,
    kind: (KNOWLEDGE_KINDS as readonly string[]).includes(row.kind) ? (row.kind as KnowledgeKind) : "faq",
    title: row.title,
    body: row.body,
    price: row.price ?? null,
    keywords: row.keywords ?? [],
    active: row.active,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Everything in the workspace, including entries switched off - this is the
 * admin view, where seeing what is disabled is the point. */
export async function listKnowledgeEntries(workspaceId: string): Promise<KnowledgeEntry[]> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.workspaceId, workspaceId))
      .orderBy(desc(knowledgeEntries.sortOrder), asc(knowledgeEntries.title))
    return rows.map(rowToEntry)
  })
}

/** Only what the bot is allowed to say. Separate from the admin list on
 * purpose: switching an entry off must take it out of the bot's mouth
 * immediately, without depending on a caller remembering to filter. */
export async function listActiveKnowledgeEntries(workspaceId: string): Promise<KnowledgeEntry[]> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(knowledgeEntries)
      .where(and(eq(knowledgeEntries.workspaceId, workspaceId), eq(knowledgeEntries.active, true)))
      .orderBy(desc(knowledgeEntries.sortOrder), asc(knowledgeEntries.title))
    return rows.map(rowToEntry)
  })
}

function clean(input: KnowledgeEntryInput) {
  return {
    kind: input.kind,
    title: input.title.trim(),
    body: input.body.trim(),
    price: input.price?.trim() ? input.price.trim() : null,
    keywords: (input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 20),
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
  }
}

export async function saveKnowledgeEntry(
  workspaceId: string,
  userId: string | null,
  input: KnowledgeEntryInput
): Promise<KnowledgeEntry | null> {
  const values = clean(input)
  if (!values.title || !values.body) return null

  return withDb(async (db) => {
    if (input.id) {
      // Scoped update: an id from another workspace matches no row and
      // returns nothing, rather than editing someone else's prices.
      const rows = await db
        .update(knowledgeEntries)
        .set({ ...values, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(knowledgeEntries.id, input.id), eq(knowledgeEntries.workspaceId, workspaceId)))
        .returning()
      const row = rows[0]
      return row ? rowToEntry(row) : null
    }

    const rows = await db
      .insert(knowledgeEntries)
      .values({ id: randomUUID(), workspaceId, updatedBy: userId, ...values })
      .returning()
    const row = rows[0]
    return row ? rowToEntry(row) : null
  })
}

export async function deleteKnowledgeEntry(workspaceId: string, id: string): Promise<boolean> {
  return withDb(async (db) => {
    const rows = await db
      .delete(knowledgeEntries)
      .where(and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.workspaceId, workspaceId)))
      .returning({ id: knowledgeEntries.id })
    return rows.length > 0
  })
}
