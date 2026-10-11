import type { ConversationResolutionStatus } from "./repository"

export interface ConversationAnalyticsInput {
  id: string
  resolutionStatus: ConversationResolutionStatus
  firstInboundMessageAt: Date | null
  firstResponseAt: Date | null
  // Proxy for "resolved at" - there's no dedicated timestamp for when a
  // conversation was marked resolved, but every status-changing update
  // already touches `updatedAt`, so for a resolved conversation this is
  // "last touched", which in practice means "resolved" (nothing else
  // changes a conversation once it's done). Good enough for a reporting
  // tab; not a substitute for an audit trail.
  updatedAt: Date
  assignedToUserId: string | null
}

export interface AgentStats {
  userId: string | null
  name: string
  assigned: number
  resolved: number
  avgFirstResponseMinutes: number | null
  responseSampleSize: number
}

export interface WhatsAppAnalytics {
  totals: { conversations: number; open: number; pending: number; resolved: number; snoozed: number }
  responseTime: { avgMinutes: number | null; sampleSize: number }
  resolvedCounts: { today: number; last7Days: number; last30Days: number }
  byAgent: AgentStats[]
  unassigned: AgentStats
}

const DAY_MS = 24 * 60 * 60 * 1000

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
}

/** Pure aggregation, deliberately decoupled from the DB so it's cheap to
 * unit-test - all the actual querying lives in repository.ts. */
export function computeWhatsAppAnalytics(
  conversations: ConversationAnalyticsInput[],
  teamMembers: { userId: string; name: string }[],
  now: Date = new Date()
): WhatsAppAnalytics {
  const totals = { conversations: conversations.length, open: 0, pending: 0, resolved: 0, snoozed: 0 }
  const responseMinutesAll: number[] = []
  const resolvedCounts = { today: 0, last7Days: 0, last30Days: 0 }

  type Bucket = { assigned: number; resolved: number; minutes: number[] }
  const buckets = new Map<string, Bucket>()
  const bucketFor = (key: string): Bucket => {
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { assigned: 0, resolved: 0, minutes: [] }
      buckets.set(key, bucket)
    }
    return bucket
  }

  for (const c of conversations) {
    totals[c.resolutionStatus] += 1

    let responseMinutes: number | null = null
    if (c.firstInboundMessageAt && c.firstResponseAt) {
      const minutes = (c.firstResponseAt.getTime() - c.firstInboundMessageAt.getTime()) / 60000
      // Guard against clock skew/bad data producing a negative gap rather
      // than letting it silently drag the average down.
      if (minutes >= 0) {
        responseMinutes = minutes
        responseMinutesAll.push(minutes)
      }
    }

    if (c.resolutionStatus === "resolved") {
      const ageMs = now.getTime() - c.updatedAt.getTime()
      if (ageMs <= DAY_MS) resolvedCounts.today += 1
      if (ageMs <= 7 * DAY_MS) resolvedCounts.last7Days += 1
      if (ageMs <= 30 * DAY_MS) resolvedCounts.last30Days += 1
    }

    const bucket = bucketFor(c.assignedToUserId ?? "unassigned")
    bucket.assigned += 1
    if (c.resolutionStatus === "resolved") bucket.resolved += 1
    if (responseMinutes !== null) bucket.minutes.push(responseMinutes)
  }

  const nameById = new Map(teamMembers.map((m) => [m.userId, m.name]))
  const byAgent: AgentStats[] = Array.from(buckets.entries())
    .filter(([key]) => key !== "unassigned")
    .map(([userId, bucket]) => ({
      userId,
      // A conversation can stay assigned to someone who's since left the
      // team - still worth counting, just without a name to show.
      name: nameById.get(userId) ?? "Former team member",
      assigned: bucket.assigned,
      resolved: bucket.resolved,
      avgFirstResponseMinutes: average(bucket.minutes),
      responseSampleSize: bucket.minutes.length,
    }))
    .sort((a, b) => b.assigned - a.assigned)

  const unassignedBucket = buckets.get("unassigned")
  const unassigned: AgentStats = {
    userId: null,
    name: "Unassigned",
    assigned: unassignedBucket?.assigned ?? 0,
    resolved: unassignedBucket?.resolved ?? 0,
    avgFirstResponseMinutes: average(unassignedBucket?.minutes ?? []),
    responseSampleSize: unassignedBucket?.minutes.length ?? 0,
  }

  return {
    totals,
    responseTime: { avgMinutes: average(responseMinutesAll), sampleSize: responseMinutesAll.length },
    resolvedCounts,
    byAgent,
    unassigned,
  }
}
