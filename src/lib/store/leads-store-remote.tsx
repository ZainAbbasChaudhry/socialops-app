"use client"

import * as React from "react"
import type {
  CallPermission,
  CallStatus,
  Lead,
  LeadActivity,
  LeadStage,
  LeadIntentStatus,
  LeadPriority,
  MeetingStatus,
} from "@/types"
import { LeadsContext, type LeadsContextValue } from "./leads-context"

/** Database-backed Leads provider — same public shape as the demo store
 * (see leads-store.tsx), so no consuming component changes. Every mutation
 * goes through the real /api/leads* routes; the server independently
 * re-verifies auth + workspace on each call, this file has no authority of
 * its own. */
export function DatabaseLeadsProvider({ children }: { children: React.ReactNode }) {
  const [leads, setLeads] = React.useState<Lead[]>([])
  const [activities, setActivities] = React.useState<LeadActivity[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const loadedActivityLeadIds = React.useRef(new Set<string>())

  const refetchLeads = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/leads", { credentials: "same-origin" })
      if (!res.ok) throw new Error("Failed to load leads")
      const data = await res.json()
      setLeads(data.leads)
    } catch {
      setError("Couldn't load leads. Check your connection and try again.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Inlined (rather than calling refetchLeads directly) so the initial fetch
  // is scoped to this effect and can be cancelled on unmount; refetchLeads
  // itself stays available separately for the retry button and addLead.
  React.useEffect(() => {
    let cancelled = false

    async function loadInitialLeads() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/leads", { credentials: "same-origin" })
        if (cancelled) return
        if (!res.ok) throw new Error("Failed to load leads")
        const data = await res.json()
        if (cancelled) return
        setLeads(data.leads)
      } catch {
        if (!cancelled) setError("Couldn't load leads. Check your connection and try again.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadInitialLeads()
    return () => {
      cancelled = true
    }
  }, [])

  const ensureActivitiesLoaded = React.useCallback(async (leadId: string) => {
    if (loadedActivityLeadIds.current.has(leadId)) return
    loadedActivityLeadIds.current.add(leadId)
    try {
      const res = await fetch(`/api/leads/${leadId}/activities`, { credentials: "same-origin" })
      if (!res.ok) return
      const data = await res.json()
      setActivities((prev) => {
        const withoutThisLead = prev.filter((a) => a.leadId !== leadId)
        return [...withoutThisLead, ...data.activities]
      })
    } catch {
      loadedActivityLeadIds.current.delete(leadId) // allow a retry later
    }
  }, [])

  const patchLead = React.useCallback(async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    })
    if (!res.ok) return
    const data = await res.json()
    setLeads((prev) => prev.map((l) => (l.id === id ? data.lead : l)))
    loadedActivityLeadIds.current.delete(id) // patch may have added activities — refetch next time it's viewed
  }, [])

  const addLead = React.useCallback(async (input: Partial<Lead> & { name: string }) => {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        name: input.name,
        whatsappNumber: input.whatsappNumber,
        email: input.email,
        company: input.company,
        city: input.city,
        sourcePlatform: input.source?.platform,
        sourceCampaign: input.source?.campaign,
        stage: input.stage,
        status: input.status,
        callPermission: input.callPermission,
        notes: input.notes,
        tags: input.tags,
      }),
    })
    if (res.ok) await refetchLeads()
  }, [refetchLeads])

  const updateLead = React.useCallback((id: string, patch: Partial<Lead>) => {
    patchLead(id, patch)
  }, [patchLead])

  const setStage = React.useCallback((id: string, stage: LeadStage) => patchLead(id, { stage }), [patchLead])
  const setStatus = React.useCallback((id: string, status: LeadIntentStatus) => patchLead(id, { status }), [patchLead])
  const setScore = React.useCallback((id: string, score: number) => patchLead(id, { leadScore: score }), [patchLead])
  const setCallPermission = React.useCallback(
    (id: string, callPermission: CallPermission) => patchLead(id, { callPermission }),
    [patchLead]
  )
  const setCallStatus = React.useCallback((id: string, callStatus: CallStatus) => patchLead(id, { callStatus }), [patchLead])
  const setMeetingStatus = React.useCallback(
    (id: string, meetingStatus: MeetingStatus) => patchLead(id, { meetingStatus }),
    [patchLead]
  )
  const assignTo = React.useCallback((id: string, memberId: string) => patchLead(id, { assignedToUserId: memberId }), [patchLead])
  const addNote = React.useCallback((id: string, note: string) => patchLead(id, { notes: note }), [patchLead])
  const setPriority = React.useCallback((id: string, priority: LeadPriority) => patchLead(id, { priority }), [patchLead])
  const setNextFollowUp = React.useCallback((id: string, iso: string) => patchLead(id, { nextFollowUpAt: iso }), [patchLead])
  const sendToHumanSales = React.useCallback((id: string) => patchLead(id, { stage: "ready-for-sales" }), [patchLead])
  const markContacted = React.useCallback((id: string) => patchLead(id, { stage: "human-followup" }), [patchLead])
  const markWon = React.useCallback((id: string) => patchLead(id, { stage: "won", status: "existing-customer" }), [patchLead])
  const markLost = React.useCallback((id: string) => patchLead(id, { stage: "lost" }), [patchLead])

  const addTag = React.useCallback(
    (id: string, tag: string) => {
      const lead = leads.find((l) => l.id === id)
      if (!lead || lead.tags.includes(tag)) return
      patchLead(id, { tags: [...lead.tags, tag] })
    },
    [leads, patchLead]
  )
  const removeTag = React.useCallback(
    (id: string, tag: string) => {
      const lead = leads.find((l) => l.id === id)
      if (!lead) return
      patchLead(id, { tags: lead.tags.filter((t) => t !== tag) })
    },
    [leads, patchLead]
  )

  const removeLead = React.useCallback(async (id: string) => {
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE", credentials: "same-origin" })
    if (!res.ok) return false
    setLeads((prev) => prev.filter((l) => l.id !== id))
    return true
  }, [])

  const markSheetSynced = React.useCallback(async (id: string) => {
    await fetch(`/api/leads/${id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type: "sheet-synced", description: "Lead synced to Google Sheet (simulated)" }),
    })
    loadedActivityLeadIds.current.delete(id)
  }, [])

  const activitiesForLead = React.useCallback(
    (leadId: string) => {
      ensureActivitiesLoaded(leadId)
      return activities.filter((a) => a.leadId === leadId).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    },
    [activities, ensureActivitiesLoaded]
  )

  const value = React.useMemo<LeadsContextValue>(
    () => ({
      leads,
      activities,
      isLoading,
      error,
      addLead: addLead as LeadsContextValue["addLead"],
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
      refetch: refetchLeads,
    }),
    [
      leads,
      activities,
      isLoading,
      error,
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
      refetchLeads,
    ]
  )

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>
}
