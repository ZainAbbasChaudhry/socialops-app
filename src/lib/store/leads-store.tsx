"use client"

import * as React from "react"
import type { CallPermission, CallStatus, Lead, LeadActivity, LeadStage, LeadIntentStatus, LeadPriority, MeetingStatus } from "@/types"
import { LEADS, LEAD_ACTIVITIES } from "@/lib/data/leads"
import { nowIso } from "@/lib/data/constants"
import { bandForScore } from "@/lib/leads/scoring"
import { createListStore } from "./create-list-store"
import { LeadsContext, type LeadsContextValue, useLeads } from "./leads-context"
import { DatabaseLeadsProvider } from "./leads-store-remote"

export { useLeads }

const leadsStore = createListStore<Lead>(LEADS)
const activitiesStore = createListStore<LeadActivity>(LEAD_ACTIVITIES)

let idCounter = 0
export function generateLeadId() {
  idCounter += 1
  return `lead_new_${Date.now()}_${idCounter}`
}
function generateActivityId(leadId: string) {
  idCounter += 1
  return `${leadId}_act_new_${idCounter}`
}

/** In-memory demo implementation — unchanged behavior from before Phase 2,
 * just now feeding the shared LeadsContext instead of its own hook. */
function DemoLeadsBridge({ children }: { children: React.ReactNode }) {
  const { items: leads, setItems: setLeads } = leadsStore.useRawStore()
  const { items: activities, setItems: setActivities } = activitiesStore.useRawStore()

  const logActivity = React.useCallback(
    (leadId: string, type: LeadActivity["type"], description: string) => {
      setActivities((prev) => [
        ...prev,
        { id: generateActivityId(leadId), leadId, type, description, timestamp: nowIso() },
      ])
    },
    [setActivities]
  )

  const addLead = React.useCallback(
    (lead: Lead) => {
      setLeads((prev) => [lead, ...prev])
      logActivity(lead.id, "created", `Lead created from ${lead.source.platform}`)
    },
    [setLeads, logActivity]
  )

  const updateLead = React.useCallback(
    (id: string, patch: Partial<Lead>) => {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: nowIso() } : l)))
    },
    [setLeads]
  )

  const setStage = React.useCallback(
    (id: string, stage: LeadStage) => {
      updateLead(id, { stage })
      logActivity(id, "status-changed", `Stage changed to "${stage}"`)
    },
    [updateLead, logActivity]
  )

  const setStatus = React.useCallback(
    (id: string, status: LeadIntentStatus) => {
      updateLead(id, { status })
      logActivity(id, "status-changed", `Status changed to "${status}"`)
    },
    [updateLead, logActivity]
  )

  const setScore = React.useCallback(
    (id: string, score: number) => {
      const band = bandForScore(score)
      updateLead(id, { score })
      logActivity(id, "score-updated", `Lead score set to ${score} (${band.label})`)
    },
    [updateLead, logActivity]
  )

  const setCallPermission = React.useCallback(
    (id: string, callPermission: CallPermission) => {
      updateLead(id, { callPermission })
      logActivity(id, "qualification-updated", `Call permission set to "${callPermission}"`)
    },
    [updateLead, logActivity]
  )

  const setCallStatus = React.useCallback(
    (id: string, callStatus: CallStatus) => {
      updateLead(id, { callStatus })
    },
    [updateLead]
  )

  const setMeetingStatus = React.useCallback(
    (id: string, meetingStatus: MeetingStatus) => {
      updateLead(id, { meetingStatus })
      logActivity(id, "meeting-booked", `Meeting status set to "${meetingStatus}"`)
    },
    [updateLead, logActivity]
  )

  const assignTo = React.useCallback(
    (id: string, memberId: string) => {
      updateLead(id, { assignedTo: memberId })
      logActivity(id, "assigned", `Assigned to team member`)
    },
    [updateLead, logActivity]
  )

  const addNote = React.useCallback(
    (id: string, note: string) => {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, notes: note, updatedAt: nowIso() } : l)))
      logActivity(id, "note-added", "Note updated")
    },
    [setLeads, logActivity]
  )

  const addTag = React.useCallback(
    (id: string, tag: string) => {
      setLeads((prev) => prev.map((l) => (l.id === id && !l.tags.includes(tag) ? { ...l, tags: [...l.tags, tag] } : l)))
    },
    [setLeads]
  )

  const removeTag = React.useCallback(
    (id: string, tag: string) => {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, tags: l.tags.filter((t) => t !== tag) } : l)))
    },
    [setLeads]
  )

  const activitiesForLead = React.useCallback(
    (leadId: string) => activities.filter((a) => a.leadId === leadId).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [activities]
  )

  const setPriority = React.useCallback(
    (id: string, priority: LeadPriority) => {
      updateLead(id, { priority })
      logActivity(id, "status-changed", `Priority set to "${priority}"`)
    },
    [updateLead, logActivity]
  )

  const setNextFollowUp = React.useCallback(
    (id: string, iso: string) => {
      updateLead(id, { nextFollowUpAt: iso })
      logActivity(id, "status-changed", `Next follow-up scheduled for ${new Date(iso).toLocaleDateString()}`)
    },
    [updateLead, logActivity]
  )

  /** The deliberate, human-triggered handoff moment — the AI never does this
   * on its own, per the "AI qualifies, humans close" rule. */
  const sendToHumanSales = React.useCallback(
    (id: string) => {
      updateLead(id, { stage: "ready-for-sales" })
      logActivity(id, "status-changed", "Handed off to human sales — ready for outreach")
    },
    [updateLead, logActivity]
  )

  const markContacted = React.useCallback(
    (id: string) => {
      updateLead(id, { stage: "human-followup" })
      logActivity(id, "contacted", "Sales team made contact with the lead")
    },
    [updateLead, logActivity]
  )

  const markWon = React.useCallback(
    (id: string) => {
      updateLead(id, { stage: "won", status: "existing-customer" })
      logActivity(id, "status-changed", "Marked as won")
    },
    [updateLead, logActivity]
  )

  const markLost = React.useCallback(
    (id: string) => {
      updateLead(id, { stage: "lost" })
      logActivity(id, "status-changed", "Marked as lost")
    },
    [updateLead, logActivity]
  )

  const markSheetSynced = React.useCallback(
    (id: string) => {
      logActivity(id, "sheet-synced", "Lead synced to Google Sheet (simulated)")
    },
    [logActivity]
  )

  // Demo data lives only in memory for this tab - "deleting" it is just
  // removing it from local state, no server round trip.
  const removeLead = React.useCallback(
    async (id: string) => {
      setLeads((prev) => prev.filter((l) => l.id !== id))
      return true
    },
    [setLeads]
  )

  const value = React.useMemo<LeadsContextValue>(
    () => ({
      leads,
      activities,
      isLoading: false,
      error: null,
      addLead,
      updateLead,
      setStage,
      setStatus,
      setScore,
      setCallPermission,
      setCallStatus,
      setMeetingStatus,
      assignTo,
      addNote,
      addTag,
      removeTag,
      activitiesForLead,
      setPriority,
      setNextFollowUp,
      sendToHumanSales,
      markContacted,
      markWon,
      markLost,
      markSheetSynced,
      removeLead,
      refetch: () => {},
    }),
    [
      leads,
      activities,
      addLead,
      updateLead,
      setStage,
      setStatus,
      setScore,
      setCallPermission,
      setCallStatus,
      setMeetingStatus,
      assignTo,
      addNote,
      addTag,
      removeTag,
      activitiesForLead,
      setPriority,
      setNextFollowUp,
      sendToHumanSales,
      markContacted,
      markWon,
      markLost,
      markSheetSynced,
      removeLead,
    ]
  )

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>
}

function DemoLeadsProvider({ children }: { children: React.ReactNode }) {
  return (
    <leadsStore.Provider>
      <activitiesStore.Provider>
        <DemoLeadsBridge>{children}</DemoLeadsBridge>
      </activitiesStore.Provider>
    </leadsStore.Provider>
  )
}

/** Picks the in-memory demo store or the real database-backed store. Kept
 * separate from DEMO_MODE (which governs WhatsApp/calling/etc. simulation)
 * — a workspace can run CRM_MODE=database while other integrations stay
 * simulated. */
export function LeadsProvider({ children, crmMode = "demo" }: { children: React.ReactNode; crmMode?: "demo" | "database" }) {
  if (crmMode === "database") {
    return <DatabaseLeadsProvider>{children}</DatabaseLeadsProvider>
  }
  return <DemoLeadsProvider>{children}</DemoLeadsProvider>
}
