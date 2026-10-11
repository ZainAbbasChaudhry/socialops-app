"use client"

import * as React from "react"
import { PhoneCall, Calendar, Trash2, Loader2 } from "lucide-react"
import { LeadScoreBadge } from "@/components/leads/lead-score-badge"
import { LeadProfileDrawer } from "@/components/leads/lead-profile-drawer"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { PlatformIcon, PLATFORM_LABEL } from "@/components/dashboard/platform-icon"
import {
  LEAD_STAGE_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_TONE,
  CALL_STATUS_LABEL,
  CALL_STATUS_TONE,
  MEETING_STATUS_LABEL,
  MEETING_STATUS_TONE,
} from "@/lib/lead-status"
import { formatRelativeTime } from "@/lib/format"
import { MOCK_NOW } from "@/lib/data/constants"
import { TEAM_MEMBERS } from "@/lib/data/settings"
import { useLeads } from "@/lib/store/leads-store"
import type { Lead, SocialPlatform } from "@/types"

const SOCIAL_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "x"]
function isSocialPlatform(platform: Lead["source"]["platform"]): platform is SocialPlatform {
  return (SOCIAL_PLATFORMS as string[]).includes(platform)
}

export function LeadsTable({ leads }: { leads: Lead[] }) {
  const { leads: allLeads, removeLead } = useLeads()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const selected = allLeads.find((l) => l.id === selectedId) ?? null
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  async function handleDelete(lead: Lead) {
    if (!window.confirm(`Permanently delete "${lead.name}"? This can't be undone. Any linked WhatsApp conversation is kept, just unlinked.`)) {
      return
    }
    setDeleteError(null)
    setDeletingId(lead.id)
    const ok = await removeLead(lead.id)
    setDeletingId(null)
    if (!ok) setDeleteError(`Couldn't delete "${lead.name}".`)
  }

  if (leads.length === 0) {
    return <div className="rounded-xl border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">Nothing matches these filters.</div>
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-foreground/10">
      <table className="w-full min-w-215 border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3.5 py-2.5 font-medium">Lead</th>
            <th className="px-3.5 py-2.5 font-medium">Source</th>
            <th className="px-3.5 py-2.5 font-medium">Stage</th>
            <th className="px-3.5 py-2.5 font-medium">Status</th>
            <th className="px-3.5 py-2.5 font-medium">Score</th>
            <th className="px-3.5 py-2.5 font-medium">Call / Meeting</th>
            <th className="px-3.5 py-2.5 font-medium">Assigned</th>
            <th className="px-3.5 py-2.5 font-medium">Last interaction</th>
            <th className="px-3.5 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {leads.map((lead) => {
            const assignee = TEAM_MEMBERS.find((m) => m.id === lead.assignedTo)
            return (
              <tr key={lead.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => setSelectedId(lead.id)}>
                <td className="px-3.5 py-2.5">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">{lead.name}</span>
                    <span className="text-xs text-muted-foreground">{lead.whatsappNumber ?? lead.email ?? "—"}</span>
                  </div>
                </td>
                <td className="px-3.5 py-2.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {isSocialPlatform(lead.source.platform) && <PlatformIcon platform={lead.source.platform} size={12} />}
                    {isSocialPlatform(lead.source.platform) ? PLATFORM_LABEL[lead.source.platform] : lead.source.platform}
                    {lead.source.campaign && ` · ${lead.source.campaign}`}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 text-xs text-foreground">{LEAD_STAGE_LABEL[lead.stage]}</td>
                <td className="px-3.5 py-2.5">
                  <StatusBadge tone={LEAD_STATUS_TONE[lead.status]}>{LEAD_STATUS_LABEL[lead.status]}</StatusBadge>
                </td>
                <td className="px-3.5 py-2.5">
                  <LeadScoreBadge score={lead.score} />
                </td>
                <td className="px-3.5 py-2.5">
                  <div className="flex flex-col gap-1">
                    {lead.callStatus && (
                      <StatusBadge tone={CALL_STATUS_TONE[lead.callStatus]} className="w-fit">
                        <PhoneCall className="size-3" />
                        {CALL_STATUS_LABEL[lead.callStatus]}
                      </StatusBadge>
                    )}
                    {lead.meetingStatus && (
                      <StatusBadge tone={MEETING_STATUS_TONE[lead.meetingStatus]} className="w-fit">
                        <Calendar className="size-3" />
                        {MEETING_STATUS_LABEL[lead.meetingStatus]}
                      </StatusBadge>
                    )}
                    {!lead.callStatus && !lead.meetingStatus && <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </td>
                <td className="px-3.5 py-2.5 text-xs text-muted-foreground">{assignee ? assignee.name : "Unassigned"}</td>
                <td className="px-3.5 py-2.5 text-xs text-muted-foreground">{formatRelativeTime(lead.lastInteractionAt, MOCK_NOW)}</td>
                <td className="px-3.5 py-2.5 text-right">
                  <button
                    type="button"
                    title="Delete lead"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(lead)
                    }}
                    disabled={deletingId === lead.id}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    {deletingId === lead.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {deleteError && <p className="px-3.5 py-2 text-xs text-destructive">{deleteError}</p>}
      <LeadProfileDrawer lead={selected} onOpenChange={(open) => !open && setSelectedId(null)} />
    </div>
  )
}
