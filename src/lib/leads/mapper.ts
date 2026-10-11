import type { Lead, LeadActivity } from "@/types"
import type { leads, leadActivities } from "@/lib/db/schema"

type LeadRow = typeof leads.$inferSelect
type LeadActivityRow = typeof leadActivities.$inferSelect

/** Maps a flat DB row to the existing nested `Lead` shape the Kanban/table
 * UI already consumes, so no component needs to change. */
export function leadRowToLead(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    whatsappNumber: row.whatsappNumber ?? undefined,
    email: row.email ?? undefined,
    company: row.company ?? undefined,
    city: row.city ?? undefined,
    stage: row.stage as Lead["stage"],
    status: row.status as Lead["status"],
    score: row.leadScore,
    source: {
      platform: row.sourcePlatform as Lead["source"]["platform"],
      campaign: row.sourceCampaign ?? undefined,
      originalPostId: row.sourceOriginalPostId ?? undefined,
      originalPostExcerpt: row.sourceOriginalPostExcerpt ?? undefined,
      originalCommentId: row.sourceOriginalCommentId ?? undefined,
      originalCommentExcerpt: row.sourceOriginalCommentExcerpt ?? undefined,
      originalConversationId: row.sourceOriginalConversationId ?? undefined,
    },
    qualification: {
      businessType: row.businessType ?? undefined,
      location: row.location ?? undefined,
      serviceInterested: row.serviceInterested ?? undefined,
      requirement: row.requirement ?? undefined,
      budget: row.budget ?? undefined,
      timeline: row.timeline ?? undefined,
      painPoint: row.painPoint ?? undefined,
      goal: row.goal ?? undefined,
      decisionMaker: (row.decisionMaker as "yes" | "no" | "unknown" | null) ?? undefined,
      preferredLanguage: row.preferredLanguage ?? undefined,
      preferredCallTime: row.preferredCallTime ?? undefined,
    },
    callPermission: row.callPermission as Lead["callPermission"],
    callStatus: (row.callStatus as Lead["callStatus"]) ?? undefined,
    meetingStatus: (row.meetingStatus as Lead["meetingStatus"]) ?? undefined,
    assignedTo: row.assignedToUserId ?? undefined,
    priority: (row.priority as Lead["priority"]) ?? undefined,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastInteractionAt: row.lastInteractionAt.toISOString(),
    notes: row.notes,
    tags: row.tags,
    scoreFactors: (row.scoreFactors as Lead["scoreFactors"]) ?? undefined,
  }
}

export function activityRowToActivity(row: LeadActivityRow): LeadActivity {
  return {
    id: row.id,
    leadId: row.leadId,
    type: row.activityType as LeadActivity["type"],
    description: row.description,
    timestamp: row.createdAt.toISOString(),
  }
}
