"use client"

import * as React from "react"
import type { CallPermission, CallStatus, Lead, LeadActivity, LeadStage, LeadIntentStatus, LeadPriority, MeetingStatus } from "@/types"

/** Shared context shape for both the demo (in-memory) and database-backed
 * Leads providers, so `useLeads()` and every consuming component work
 * identically regardless of which one is mounted. */
export interface LeadsContextValue {
  leads: Lead[]
  activities: LeadActivity[]
  /** Only meaningful for the database-backed provider — always false/null
   * in demo mode, where data is already in memory. */
  isLoading: boolean
  error: string | null
  addLead: (lead: Lead) => void
  updateLead: (id: string, patch: Partial<Lead>) => void
  setStage: (id: string, stage: LeadStage) => void
  setStatus: (id: string, status: LeadIntentStatus) => void
  setScore: (id: string, score: number) => void
  setCallPermission: (id: string, callPermission: CallPermission) => void
  setCallStatus: (id: string, callStatus: CallStatus) => void
  setMeetingStatus: (id: string, meetingStatus: MeetingStatus) => void
  assignTo: (id: string, memberId: string) => void
  addNote: (id: string, note: string) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  activitiesForLead: (leadId: string) => LeadActivity[]
  setPriority: (id: string, priority: LeadPriority) => void
  setNextFollowUp: (id: string, iso: string) => void
  sendToHumanSales: (id: string) => void
  markContacted: (id: string) => void
  markWon: (id: string) => void
  markLost: (id: string) => void
  markSheetSynced: (id: string) => void
  /** Permanently deletes the lead - no undo. No-op in demo mode (there's
   * nothing real to delete); calls DELETE /api/leads/:id in database mode.
   * Resolves true if the lead was actually removed. */
  removeLead: (id: string) => Promise<boolean>
  /** No-op in demo mode; re-fetches from the server in database mode. */
  refetch: () => void
}

export const LeadsContext = React.createContext<LeadsContextValue | null>(null)

export function useLeads(): LeadsContextValue {
  const context = React.useContext(LeadsContext)
  if (!context) {
    throw new Error("useLeads must be used within a LeadsProvider")
  }
  return context
}
