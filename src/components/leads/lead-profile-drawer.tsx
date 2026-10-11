"use client"

import * as React from "react"
import Link from "next/link"
import {
  Mail,
  Building2,
  MapPin,
  Briefcase,
  Target,
  Wallet,
  CalendarClock,
  Languages,
  Tag as TagIcon,
  StickyNote,
  History,
  PhoneCall,
  X as XIcon,
  UserCog,
  FileSpreadsheet,
  Loader2,
  UserCheck2,
  Flag,
  CircleCheck,
  CircleX,
  ArrowUpRight,
  Trash2,
} from "lucide-react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlatformIcon, PLATFORM_LABEL } from "@/components/dashboard/platform-icon"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { WhatsAppIcon } from "@/components/whatsapp/whatsapp-icon"
import { LeadScoreBadge } from "@/components/leads/lead-score-badge"
import { BookMeetingDialog } from "@/components/call-agent/book-meeting-dialog"
import {
  LEAD_STAGE_ORDER,
  LEAD_STAGE_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_TONE,
  CALL_STATUS_LABEL,
  CALL_STATUS_TONE,
  MEETING_STATUS_LABEL,
  MEETING_STATUS_TONE,
  LEAD_PRIORITY_LABEL,
  CALL_PERMISSION_LABEL,
} from "@/lib/lead-status"
import { buildClickToChatLink } from "@/lib/integrations/whatsapp"
import { formatRelativeTime } from "@/lib/format"
import { MOCK_NOW } from "@/lib/data/constants"
import { TEAM_MEMBERS } from "@/lib/data/settings"
import { useLeads } from "@/lib/store/leads-store"
import { useCallQueue, useCalls } from "@/lib/store/calls-store"
import { useMeetings } from "@/lib/store/meetings-store"
import { useGoogleSheets } from "@/lib/store/sheets-store"
import type { CallPermission, Lead, LeadPriority, LeadStage, SocialPlatform } from "@/types"

const SOCIAL_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "x"]
function isSocialPlatform(platform: Lead["source"]["platform"]): platform is SocialPlatform {
  return (SOCIAL_PLATFORMS as string[]).includes(platform)
}

const TEAM_MEMBER_ITEMS: Record<string, string> = Object.fromEntries(TEAM_MEMBERS.map((m) => [m.id, m.name]))

interface LeadProfileDrawerProps {
  lead: Lead | null
  onOpenChange: (open: boolean) => void
}

const QUALIFICATION_ROWS: { key: keyof Lead["qualification"]; label: string; icon: typeof Briefcase }[] = [
  { key: "businessType", label: "Business type", icon: Briefcase },
  { key: "location", label: "Location", icon: MapPin },
  { key: "serviceInterested", label: "Service interested", icon: Target },
  { key: "requirement", label: "Requirement", icon: StickyNote },
  { key: "budget", label: "Budget", icon: Wallet },
  { key: "timeline", label: "Timeline", icon: CalendarClock },
  { key: "preferredLanguage", label: "Preferred language", icon: Languages },
]

const READY_FOR_SALES_INDEX = LEAD_STAGE_ORDER.indexOf("ready-for-sales")

export function LeadProfileDrawer({ lead, onOpenChange }: LeadProfileDrawerProps) {
  const {
    setStage,
    setCallPermission,
    addNote,
    addTag,
    removeTag,
    activitiesForLead,
    assignTo,
    setPriority,
    setNextFollowUp,
    sendToHumanSales,
    markContacted,
    markWon,
    markLost,
    markSheetSynced,
    removeLead,
  } = useLeads()
  const { queue, addToQueue } = useCallQueue()
  const { callsForLead } = useCalls()
  const { meetingsForLead } = useMeetings()
  const { status: sheetsStatus, syncLead, lastSyncFor } = useGoogleSheets()
  const [notesDraft, setNotesDraft] = React.useState(lead?.notes ?? "")
  const [tagDraft, setTagDraft] = React.useState("")
  const [syncing, setSyncing] = React.useState(false)
  const [bookingOpen, setBookingOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const [prevLeadId, setPrevLeadId] = React.useState(lead?.id ?? null)
  if ((lead?.id ?? null) !== prevLeadId) {
    setPrevLeadId(lead?.id ?? null)
    setNotesDraft(lead?.notes ?? "")
  }

  if (!lead) return null
  const currentLead = lead

  const calls = callsForLead(lead.id)
  const meetings = meetingsForLead(lead.id)
  const activity = activitiesForLead(lead.id)
  const alreadyQueued = queue.some((q) => q.leadId === lead.id && q.status === "ready")
  const waLink = lead.whatsappNumber ? buildClickToChatLink(lead.whatsappNumber, `Hi ${lead.name.split(" ")[0]}, following up on your inquiry.`) : null
  const isReadyForSalesOrLater = LEAD_STAGE_ORDER.indexOf(lead.stage) >= READY_FOR_SALES_INDEX
  const lastSheetSync = lastSyncFor(lead.id)

  async function handleSyncNow() {
    setSyncing(true)
    await syncLead(currentLead, calls[0])
    markSheetSynced(currentLead.id)
    setSyncing(false)
  }

  async function handleDelete() {
    if (!window.confirm(`Permanently delete "${currentLead.name}"? This can't be undone. Any linked WhatsApp conversation is kept, just unlinked.`)) {
      return
    }
    setDeleteError(null)
    setDeleting(true)
    const ok = await removeLead(currentLead.id)
    setDeleting(false)
    if (!ok) {
      setDeleteError("Couldn't delete this lead.")
      return
    }
    onOpenChange(false)
  }

  return (
    <Sheet open={Boolean(lead)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetTitle className="sr-only">{lead.name}</SheetTitle>

        <div className="flex flex-col gap-5 p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
                {lead.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <div className="flex flex-col">
                <span className="text-base font-medium text-foreground">{lead.name}</span>
                <span className="flex items-center gap-1.5 text-xs capitalize text-muted-foreground">
                  {isSocialPlatform(lead.source.platform) && <PlatformIcon platform={lead.source.platform} size={11} />}
                  {isSocialPlatform(lead.source.platform) ? PLATFORM_LABEL[lead.source.platform] : lead.source.platform}
                  {lead.source.campaign && ` · ${lead.source.campaign}`}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LeadScoreBadge score={lead.score} />
              <button
                type="button"
                title="Delete lead"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </button>
            </div>
          </div>
          {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

          {/* Stage + status */}
          <div className="flex flex-wrap items-center gap-2">
            <Select items={LEAD_STAGE_LABEL} value={lead.stage} onValueChange={(v) => setStage(lead.id, v as LeadStage)}>
              <SelectTrigger size="sm" className="h-7 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STAGE_ORDER.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {LEAD_STAGE_LABEL[stage]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <StatusBadge tone={LEAD_STATUS_TONE[lead.status]}>{LEAD_STATUS_LABEL[lead.status]}</StatusBadge>
            {lead.callStatus && <StatusBadge tone={CALL_STATUS_TONE[lead.callStatus]}>{CALL_STATUS_LABEL[lead.callStatus]}</StatusBadge>}
            {lead.meetingStatus && <StatusBadge tone={MEETING_STATUS_TONE[lead.meetingStatus]}>{MEETING_STATUS_LABEL[lead.meetingStatus]}</StatusBadge>}
          </div>

          {/* Contact info */}
          <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3 text-sm">
            {lead.whatsappNumber && (
              <span className="flex items-center gap-2 text-foreground">
                <WhatsAppIcon size={14} />
                {lead.whatsappNumber}
              </span>
            )}
            {lead.email && (
              <span className="flex items-center gap-2 text-foreground">
                <Mail className="size-3.5 text-muted-foreground" />
                {lead.email}
              </span>
            )}
            {lead.company && (
              <span className="flex items-center gap-2 text-foreground">
                <Building2 className="size-3.5 text-muted-foreground" />
                {lead.company}
                {lead.city && ` · ${lead.city}`}
              </span>
            )}
          </div>

          {/* Original touchpoint */}
          {(lead.source.originalPostExcerpt || lead.source.originalCommentExcerpt) && (
            <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Original {lead.source.originalCommentExcerpt ? "comment" : "post"}: </span>
              “{lead.source.originalCommentExcerpt ?? lead.source.originalPostExcerpt}”
            </div>
          )}

          {/* Qualification */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Qualification</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUALIFICATION_ROWS.filter((row) => lead.qualification[row.key]).map((row) => (
                <div key={row.key} className="flex items-start gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
                  <row.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-[11px] text-muted-foreground">{row.label}</span>
                    <span className="text-xs text-foreground">{lead.qualification[row.key]}</span>
                  </div>
                </div>
              ))}
              {QUALIFICATION_ROWS.every((row) => !lead.qualification[row.key]) && (
                <p className="col-span-2 text-xs text-muted-foreground">No qualification data yet — AI collects this during WhatsApp/call.</p>
              )}
            </div>
          </div>

          {/* Call permission */}
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-normal text-foreground">Call permission</Label>
            <Select items={CALL_PERMISSION_LABEL} value={lead.callPermission} onValueChange={(v) => setCallPermission(lead.id, v as CallPermission)}>
              <SelectTrigger size="sm" className="h-7 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sales owner */}
          <div className="flex items-center justify-between gap-2">
            <Label className="flex items-center gap-1.5 text-sm font-normal text-foreground">
              <UserCog className="size-3.5 text-muted-foreground" />
              Assigned sales person
            </Label>
            <Select items={TEAM_MEMBER_ITEMS} value={lead.assignedTo ?? ""} onValueChange={(v) => v && assignTo(lead.id, v)}>
              <SelectTrigger size="sm" className="h-7 w-40">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                {TEAM_MEMBERS.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Google Sheet sync */}
          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-sm text-foreground">
                <FileSpreadsheet className="size-3.5 text-muted-foreground" />
                Google Sheet
              </span>
              <span className="text-xs text-muted-foreground">
                {lastSheetSync ? `Synced ${formatRelativeTime(lastSheetSync.syncedAt, MOCK_NOW)} (simulated)` : "Not synced yet"}
                {sheetsStatus.status !== "connected" && " · demo mode"}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={handleSyncNow} disabled={syncing}>
              {syncing ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
              Sync now
            </Button>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {waLink && (
              <Button render={<a href={waLink} target="_blank" rel="noopener noreferrer" />} nativeButton={false} size="sm" variant="outline">
                <WhatsAppIcon size={13} />
                Send WhatsApp
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={lead.callPermission === "no" || alreadyQueued}
              onClick={() => addToQueue(lead.id, lead.qualification.preferredCallTime)}
            >
              <PhoneCall />
              {alreadyQueued ? "Already queued" : "Queue for AI call"}
            </Button>
            <Button render={<Link href="/dashboard/call-agent" />} nativeButton={false} size="sm" variant="ghost">
              Open Call Agent
            </Button>
          </div>

          {/* Call history */}
          {calls.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Call history</span>
              {calls.map((call) => (
                <div key={call.id} className="flex flex-col gap-1 rounded-lg bg-muted/40 p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <StatusBadge tone={CALL_STATUS_TONE[call.status]}>{CALL_STATUS_LABEL[call.status]}</StatusBadge>
                    <span className="text-muted-foreground">{call.startedAt && formatRelativeTime(call.startedAt, MOCK_NOW)}</span>
                  </div>
                  {call.summary?.recommendedNextAction && (
                    <p className="text-foreground">
                      <span className="text-muted-foreground">Next action: </span>
                      {call.summary.recommendedNextAction}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Meeting history */}
          {meetings.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Meetings</span>
              {meetings.map((meeting) => (
                <div key={meeting.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
                  <span className="text-foreground">
                    {meeting.date} · {meeting.time} ({meeting.timezone})
                  </span>
                  <StatusBadge tone={MEETING_STATUS_TONE[meeting.status]}>{MEETING_STATUS_LABEL[meeting.status]}</StatusBadge>
                </div>
              ))}
            </div>
          )}

          {/* Human sales handoff */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-dashed border-border p-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <UserCheck2 className="size-3.5" />
              Human sales
            </span>

            {!isReadyForSalesOrLater ? (
              <>
                <p className="text-xs text-muted-foreground">
                  The AI qualifies and calls — it never closes the deal itself. Hand this lead to a real sales person once it&apos;s worth their time.
                </p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => sendToHumanSales(lead.id)}>
                  <ArrowUpRight />
                  Send to human sales
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5 text-sm font-normal text-foreground">
                    <Flag className="size-3.5 text-muted-foreground" />
                    Priority
                  </Label>
                  <Select items={LEAD_PRIORITY_LABEL} value={lead.priority ?? "medium"} onValueChange={(v) => v && setPriority(lead.id, v as LeadPriority)}>
                    <SelectTrigger size="sm" className="h-7 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LEAD_PRIORITY_LABEL) as LeadPriority[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          {LEAD_PRIORITY_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="next-followup" className="text-xs text-muted-foreground">
                    Next follow-up
                  </Label>
                  <input
                    id="next-followup"
                    type="date"
                    value={lead.nextFollowUpAt?.slice(0, 10) ?? ""}
                    onChange={(event) => event.target.value && setNextFollowUp(lead.id, new Date(event.target.value).toISOString())}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {lead.stage === "ready-for-sales" && (
                    <Button size="sm" variant="outline" onClick={() => markContacted(lead.id)}>
                      Mark contacted
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setBookingOpen(true)}>
                    Mark meeting scheduled
                  </Button>
                  {lead.stage !== "won" && lead.stage !== "lost" && (
                    <>
                      <Button size="sm" variant="outline" className="text-success hover:text-success" onClick={() => markWon(lead.id)}>
                        <CircleCheck />
                        Mark won
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => markLost(lead.id)}>
                        <CircleX />
                        Mark lost
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TagIcon className="size-3.5" />
              Tags
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {lead.tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
                  {tag}
                  <button type="button" onClick={() => removeTag(lead.id, tag)} aria-label={`Remove tag ${tag}`}>
                    <XIcon className="size-2.5 text-muted-foreground hover:text-foreground" />
                  </button>
                </span>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!tagDraft.trim()) return
                addTag(lead.id, tagDraft.trim())
                setTagDraft("")
              }}
              className="flex gap-1.5"
            >
              <Input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="Add a tag…" className="h-8 flex-1" />
              <Button type="submit" size="sm" variant="outline" disabled={!tagDraft.trim()}>
                Add
              </Button>
            </form>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-notes" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StickyNote className="size-3.5" />
              Notes
            </Label>
            <Textarea
              id="lead-notes"
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              onBlur={() => addNote(lead.id, notesDraft)}
              className="min-h-20 resize-none text-sm"
            />
          </div>

          {/* Timeline */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <History className="size-3.5" />
              Timeline
            </span>
            <div className="flex flex-col gap-2.5 border-l border-border pl-3">
              {activity.map((item) => (
                <div key={item.id} className="flex flex-col gap-0.5">
                  <span className="text-xs text-foreground">{item.description}</span>
                  <span className="text-[11px] text-muted-foreground">{formatRelativeTime(item.timestamp, MOCK_NOW)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
      <BookMeetingDialog lead={lead} open={bookingOpen} onOpenChange={setBookingOpen} />
    </Sheet>
  )
}
