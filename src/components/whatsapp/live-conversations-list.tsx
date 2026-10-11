"use client"

import * as React from "react"
import {
  Loader2,
  Bot,
  UserCheck,
  Send,
  ChevronDown,
  Clock,
  CheckCircle2,
  CircleDot,
  AlarmClock,
  TimerOff,
  Check,
  CheckCheck,
  AlertCircle,
  Sparkles,
  UserCog,
  Wand2,
  X,
  MessageSquareText,
  Plus,
  Trash2,
  User,
  Globe,
  Search,
  FileText,
  Paperclip,
  UserPlus,
  AlertTriangle,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { LeadScoreBadge } from "@/components/leads/lead-score-badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { SCORE_FACTOR_WEIGHTS } from "@/lib/leads/scoring"
import { SLA_THRESHOLD_MINUTES } from "@/lib/integrations/whatsapp/sla"
import type { Lead, LeadScoreFactors, LeadQualification } from "@/types"

type ResolutionStatus = "open" | "pending" | "resolved" | "snoozed"
type AiMode = "auto" | "suggest" | "off"

interface ConversationSummary {
  id: string
  contactPhone: string
  contactName: string | null
  status: "bot" | "escalated" | "human" | "closed"
  resolutionStatus: ResolutionStatus
  snoozedUntil: string | null
  aiMode: AiMode
  pendingAiReply: string | null
  lastMessageAt: string
  sessionWindow: { open: boolean; expiresAt: string | null }
  sla: { awaitingReply: boolean; minutesWaiting: number | null; breached: boolean }
  lead: Lead | null
}

const AI_MODE_LABEL: Record<AiMode, string> = {
  auto: "AI auto-replies",
  suggest: "AI suggests",
  off: "Human only",
}

const AI_MODE_DESCRIPTION: Record<AiMode, string> = {
  auto: "Bot qualifies and sends replies on its own.",
  suggest: "Bot drafts a reply for you to review and send.",
  off: "Bot never replies - you handle every message.",
}

const AI_MODE_ICON: Record<AiMode, React.ElementType> = {
  auto: Bot,
  suggest: Wand2,
  off: UserCog,
}

// A fixed palette (not a per-tag color the agent picks) so the same tag
// text always renders the same color everywhere without needing a separate
// "label color" table - same chip look whether it's shown on the
// conversation list, the detail panel, or (reused as-is) the leads page.
const TAG_COLORS = [
  "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
]

function tagColorClass(tag: string) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_COLORS[hash % TAG_COLORS.length]
}

function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", tagColorClass(tag))}>
      {tag}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove tag ${tag}`}>
          <X className="size-2.5" />
        </button>
      )}
    </span>
  )
}

const RESOLUTION_LABEL: Record<ResolutionStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  snoozed: "Snoozed",
}

const RESOLUTION_TONE: Record<ResolutionStatus, "info" | "warning" | "success" | "neutral"> = {
  open: "info",
  pending: "warning",
  resolved: "success",
  snoozed: "neutral",
}

const RESOLUTION_ICON: Record<ResolutionStatus, React.ElementType> = {
  open: CircleDot,
  pending: Clock,
  resolved: CheckCircle2,
  snoozed: AlarmClock,
}

const RESOLUTION_FILTERS: { value: ResolutionStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "snoozed", label: "Snoozed" },
]

/** Preset snooze durations - a free-form date picker is more friction than
 * this workflow needs; every helpdesk that offers snooze offers roughly
 * this same short list of presets. */
function snoozeOptions(): { label: string; until: () => Date }[] {
  return [
    { label: "1 hour", until: () => new Date(Date.now() + 60 * 60 * 1000) },
    { label: "4 hours", until: () => new Date(Date.now() + 4 * 60 * 60 * 1000) },
    {
      label: "Tomorrow, 9am",
      until: () => {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(9, 0, 0, 0)
        return d
      },
    },
    {
      label: "Next week",
      until: () => {
        const d = new Date()
        d.setDate(d.getDate() + 7)
        d.setHours(9, 0, 0, 0)
        return d
      },
    },
  ]
}

interface MessageMedia {
  url: string
  mimeType: string | null
  filename: string | null
  sizeBytes: number | null
}

interface MessageView {
  id: string
  direction: "inbound" | "outbound"
  sender: "customer" | "bot" | "agent"
  messageType: string
  body: string | null
  providerStatus: string
  createdAt: string
  media: MessageMedia | null
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Renders a message's attachment appropriately for its mime category -
 * an <img>/<video>/<audio> tag for anything the browser can play inline,
 * a plain download link for everything else (PDFs, Word docs, etc). The
 * URL is same-origin and auth-checked server-side (see the media route),
 * so the browser's own cookie-bearing request is enough - no token needed
 * in the URL itself. */
function MessageAttachment({ media, bubbleIsOutbound }: { media: MessageMedia; bubbleIsOutbound: boolean }) {
  const mime = media.mimeType ?? ""
  if (mime.startsWith("image/")) {
    return (
      <a href={media.url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, same-origin, not a candidate for next/image optimization */}
        <img src={media.url} alt={media.filename ?? "Attachment"} className="max-h-64 max-w-full rounded-lg object-contain" />
      </a>
    )
  }
  if (mime.startsWith("video/")) {
    return <video src={media.url} controls className="max-h-64 max-w-full rounded-lg" />
  }
  if (mime.startsWith("audio/")) {
    return <audio src={media.url} controls className="max-w-full" />
  }
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
        bubbleIsOutbound ? "border-brand-foreground/30" : "border-border"
      )}
    >
      <FileText className="size-4 shrink-0" />
      <span className="flex flex-col">
        <span className="font-medium">{media.filename ?? "Attachment"}</span>
        {media.sizeBytes != null && <span className="opacity-70">{formatBytes(media.sizeBytes)}</span>}
      </span>
    </a>
  )
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Splits message text around (case-insensitive) matches of the current
 * search term and wraps each match in <mark>, so a hit is visible in place
 * rather than just implied by the message surviving the filter. */
function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"))
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="rounded-sm bg-warning/40 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  )
}

function formatMessageTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso))
}

/** Delivery tick for an outbound message, mirroring WhatsApp's own
 * single-check (sent) / double-check (delivered) / blue double-check (read)
 * convention so agents get the same at-a-glance signal they already know. */
function MessageStatusTick({ status }: { status: string }) {
  if (status === "failed") {
    return <AlertCircle className="size-3.5 text-destructive" aria-label="Failed to send" />
  }
  if (status === "read") {
    return <CheckCheck className="size-3.5 text-sky-400" aria-label="Read" />
  }
  if (status === "delivered") {
    return <CheckCheck className="size-3.5 opacity-70" aria-label="Delivered" />
  }
  // "sent" (and "received", which never reaches here for outbound messages)
  return <Check className="size-3.5 opacity-70" aria-label="Sent" />
}

const SCORE_FACTOR_LABEL: Record<keyof LeadScoreFactors, string> = {
  buyingIntent: "Buying intent",
  budget: "Budget",
  urgency: "Urgency",
  serviceMatch: "Service match",
  decisionAuthority: "Decision authority",
  willingnessToMeet: "Willing to meet",
  sentiment: "Sentiment",
  engagement: "Engagement",
}

/** One row of the score breakdown - the factor's weight is shown alongside
 * its value so it's clear why, say, budget moves the score less than
 * buying intent does. */
function ScoreFactorBar({ factorKey, value }: { factorKey: keyof LeadScoreFactors; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {SCORE_FACTOR_LABEL[factorKey]} <span className="opacity-60">({Math.round(SCORE_FACTOR_WEIGHTS[factorKey] * 100)}%)</span>
        </span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  )
}

const QUALIFICATION_FIELD_LABEL: Record<keyof LeadQualification, string> = {
  businessType: "Business type",
  location: "Location",
  serviceInterested: "Service interested",
  requirement: "Requirement",
  budget: "Budget",
  timeline: "Timeline",
  painPoint: "Pain point",
  goal: "Goal",
  decisionMaker: "Decision maker",
  preferredLanguage: "Preferred language",
  preferredCallTime: "Preferred call time",
}
const QUALIFICATION_FIELD_ORDER = Object.keys(QUALIFICATION_FIELD_LABEL) as (keyof LeadQualification)[]

interface NoteView {
  id: string
  body: string
  authorName: string | null
  createdAt: string
}

interface QuickReply {
  id: string
  shortcut: string
  title: string
  body: string
}

interface TeamMember {
  userId: string
  name: string
  email: string
}

/** Finds a trailing `/shortcut` token being typed at the end of the draft,
 * so the suggestion list can appear as soon as a "/" starts a word - not
 * just when the whole box is a slash command. */
function trailingSlashQuery(text: string): string | null {
  const match = text.match(/(?:^|\s)\/(\S*)$/)
  return match ? match[1] : null
}

const STATUS_LABEL: Record<ConversationSummary["status"], string> = {
  bot: "AI qualifying",
  escalated: "Needs human",
  human: "Human handling",
  closed: "Closed",
}

const STATUS_TONE: Record<ConversationSummary["status"], "info" | "warning" | "success" | "neutral"> = {
  bot: "info",
  escalated: "warning",
  human: "success",
  closed: "neutral",
}

export function LiveConversationsList() {
  const [conversations, setConversations] = React.useState<ConversationSummary[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<MessageView[] | null>(null)
  const [replyBody, setReplyBody] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const [resolutionFilter, setResolutionFilter] = React.useState<ResolutionStatus | "all">("all")
  const [updatingResolution, setUpdatingResolution] = React.useState(false)
  const [resolutionError, setResolutionError] = React.useState<string | null>(null)
  const [updatingAiMode, setUpdatingAiMode] = React.useState(false)
  const [aiModeError, setAiModeError] = React.useState<string | null>(null)
  const [labelFilter, setLabelFilter] = React.useState<string | null>(null)
  const [slaFilter, setSlaFilter] = React.useState(false)
  const [tagDraft, setTagDraft] = React.useState("")
  const [updatingTags, setUpdatingTags] = React.useState(false)
  const [tagError, setTagError] = React.useState<string | null>(null)
  const [quickReplies, setQuickReplies] = React.useState<QuickReply[] | null>(null)
  const [teamMembers, setTeamMembers] = React.useState<TeamMember[] | null>(null)
  const [updatingAssignee, setUpdatingAssignee] = React.useState(false)
  const [assigneeError, setAssigneeError] = React.useState<string | null>(null)
  const [showMessageSearch, setShowMessageSearch] = React.useState(false)
  const [messageSearch, setMessageSearch] = React.useState("")
  const [uploadingMedia, setUploadingMedia] = React.useState(false)
  const [mediaError, setMediaError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [newQuickReply, setNewQuickReply] = React.useState({ shortcut: "", title: "", body: "" })
  const [addingQuickReply, setAddingQuickReply] = React.useState(false)
  const [quickReplyError, setQuickReplyError] = React.useState<string | null>(null)
  const replyTextareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [panelTab, setPanelTab] = React.useState<"messages" | "notes">("messages")
  const [notes, setNotes] = React.useState<NoteView[] | null>(null)
  const [noteBody, setNoteBody] = React.useState("")
  const [addingNote, setAddingNote] = React.useState(false)
  const [noteError, setNoteError] = React.useState<string | null>(null)
  // undefined = not fetched yet for this conversation; null = fetched, no
  // escalation reason found (e.g. a human took over without the bot
  // escalating, or the lead has no activity log yet).
  const [handoffReason, setHandoffReason] = React.useState<string | null | undefined>(undefined)

  const refreshConversations = React.useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/conversations", { credentials: "same-origin" })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setConversations(data.conversations)
    } catch {
      setError("Couldn't load conversations.")
    }
  }, [])

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/whatsapp/conversations", { credentials: "same-origin" })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setConversations(data.conversations)
      } catch {
        setError("Couldn't load conversations.")
      }
    }
    load()
  }, [])

  const refreshQuickReplies = React.useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/quick-replies", { credentials: "same-origin" })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setQuickReplies(data.quickReplies)
    } catch {
      setQuickReplies([])
    }
  }, [])

  // Quick replies are workspace-wide, not per-conversation - loaded once,
  // not re-fetched when switching the selected conversation.
  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/whatsapp/quick-replies", { credentials: "same-origin" })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setQuickReplies(data.quickReplies)
      } catch {
        setQuickReplies([])
      }
    }
    load()
  }, [])

  // Team members for the assignment dropdown - also workspace-wide, loaded
  // once, same as quick replies above.
  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/team", { credentials: "same-origin" })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setTeamMembers(data.members.map((m: { userId: string; name: string; email: string }) => ({ userId: m.userId, name: m.name, email: m.email })))
      } catch {
        setTeamMembers([])
      }
    }
    load()
  }, [])

  const [syncedSelectedId, setSyncedSelectedId] = React.useState(selectedId)
  if (selectedId !== syncedSelectedId) {
    setSyncedSelectedId(selectedId)
    setMessages(null)
    setReplyBody("")
    setSendError(null)
    setNotes(null)
    setNoteBody("")
    setNoteError(null)
    setPanelTab("messages")
    setTagDraft("")
    setTagError(null)
    setShowMessageSearch(false)
    setMessageSearch("")
    setHandoffReason(undefined)
  }

  const refreshNotes = React.useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/whatsapp/conversations/${conversationId}/notes`, { credentials: "same-origin" })
      const data = await res.json()
      setNotes(data.notes)
    } catch {
      setNotes([])
    }
  }, [])

  React.useEffect(() => {
    if (!selectedId || panelTab !== "notes" || notes !== null) return
    const conversationId = selectedId
    async function load() {
      try {
        const res = await fetch(`/api/whatsapp/conversations/${conversationId}/notes`, { credentials: "same-origin" })
        const data = await res.json()
        setNotes(data.notes)
      } catch {
        setNotes([])
      }
    }
    load()
  }, [selectedId, panelTab, notes])

  async function addNote() {
    if (!selectedId || !noteBody.trim()) return
    setAddingNote(true)
    setNoteError(null)
    try {
      const res = await fetch(`/api/whatsapp/conversations/${selectedId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ body: noteBody.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setNoteError(data?.error ?? "Couldn't add the note.")
        return
      }
      setNoteBody("")
      await refreshNotes(selectedId)
    } catch {
      setNoteError("Couldn't reach the server.")
    } finally {
      setAddingNote(false)
    }
  }

  const refreshMessages = React.useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/whatsapp/conversations/${conversationId}/messages`, { credentials: "same-origin" })
      const data = await res.json()
      setMessages(data.messages)
    } catch {
      setMessages([])
    }
  }, [])

  React.useEffect(() => {
    if (!selectedId) return
    const conversationId = selectedId
    async function load() {
      try {
        const res = await fetch(`/api/whatsapp/conversations/${conversationId}/messages`, { credentials: "same-origin" })
        const data = await res.json()
        setMessages(data.messages)
      } catch {
        setMessages([])
      }
    }
    load()
  }, [selectedId])

  const selected = conversations?.find((c) => c.id === selectedId) ?? null

  // A human picking up a thread the bot escalated needs the "why" without
  // re-reading the whole transcript - the escalation reason is logged as a
  // lead activity (pipeline.ts: "Escalated to human: <reason>") rather than
  // a dedicated field, so it's parsed out of the most recent matching one.
  // Only fetched for escalated/human-owned conversations with a linked lead,
  // and only once per selected conversation.
  React.useEffect(() => {
    if (!selected || handoffReason !== undefined) return
    if (selected.status !== "escalated" && selected.status !== "human") return
    const leadId = selected.lead?.id
    let cancelled = false
    async function load() {
      if (!leadId) {
        if (!cancelled) setHandoffReason(null)
        return
      }
      try {
        const res = await fetch(`/api/leads/${leadId}/activities`, { credentials: "same-origin" })
        if (!res.ok) throw new Error()
        const data = await res.json()
        const activities = (data.activities ?? []) as { type: string; description: string; timestamp: string }[]
        const prefix = "Escalated to human: "
        const matches = activities.filter((a) => a.type === "qualification-updated" && a.description.startsWith(prefix))
        const latest = matches[matches.length - 1]
        if (!cancelled) setHandoffReason(latest ? latest.description.slice(prefix.length) : null)
      } catch {
        if (!cancelled) setHandoffReason(null)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selected, handoffReason])

  async function sendReply() {
    if (!selectedId || !replyBody.trim()) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/whatsapp/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ body: replyBody.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setSendError(data?.error ?? "Couldn't send the message.")
        return
      }
      setReplyBody("")
      await Promise.all([refreshMessages(selectedId), refreshConversations()])
    } catch {
      setSendError("Couldn't reach the server.")
    } finally {
      setSending(false)
    }
  }

  async function sendAttachment(file: File) {
    if (!selectedId) return
    setUploadingMedia(true)
    setMediaError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/whatsapp/conversations/${selectedId}/media`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setMediaError(data?.error ?? "Couldn't send the attachment.")
        return
      }
      await Promise.all([refreshMessages(selectedId), refreshConversations()])
    } catch {
      setMediaError("Couldn't reach the server.")
    } finally {
      setUploadingMedia(false)
    }
  }

  async function changeResolutionStatus(resolutionStatus: ResolutionStatus, snoozedUntil?: Date) {
    if (!selectedId) return
    setUpdatingResolution(true)
    setResolutionError(null)
    try {
      const res = await fetch(`/api/whatsapp/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          resolutionStatus,
          ...(snoozedUntil ? { snoozedUntil: snoozedUntil.toISOString() } : {}),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setResolutionError(data?.error ?? "Couldn't update status.")
        return
      }
      await refreshConversations()
    } catch {
      setResolutionError("Couldn't reach the server.")
    } finally {
      setUpdatingResolution(false)
    }
  }

  async function changeAiMode(aiMode: AiMode) {
    if (!selectedId) return
    setUpdatingAiMode(true)
    setAiModeError(null)
    try {
      const res = await fetch(`/api/whatsapp/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ aiMode }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setAiModeError(data?.error ?? "Couldn't update AI mode.")
        return
      }
      await refreshConversations()
    } catch {
      setAiModeError("Couldn't reach the server.")
    } finally {
      setUpdatingAiMode(false)
    }
  }

  function applySuggestedReply(text: string) {
    setReplyBody(text)
  }

  async function discardSuggestion() {
    if (!selectedId) return
    try {
      await fetch(`/api/whatsapp/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ discardPendingAiReply: true }),
      })
      await refreshConversations()
    } catch {
      // Non-critical - the agent can just ignore the banner if this fails.
    }
  }

  // Tags live on the lead, not the conversation - reusing the same
  // PATCH /api/leads/:id the leads page uses, so a label added here shows
  // up there too instead of being a separate WhatsApp-only tag system.
  async function patchLeadTags(leadId: string, tags: string[]) {
    setUpdatingTags(true)
    setTagError(null)
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ tags }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setTagError(data?.error ?? "Couldn't update tags.")
        return
      }
      await refreshConversations()
    } catch {
      setTagError("Couldn't reach the server.")
    } finally {
      setUpdatingTags(false)
    }
  }

  async function addConversationTag(lead: Lead, tag: string) {
    if (!tag.trim() || lead.tags.includes(tag.trim())) return
    await patchLeadTags(lead.id, [...lead.tags, tag.trim()])
  }

  async function removeConversationTag(lead: Lead, tag: string) {
    await patchLeadTags(lead.id, lead.tags.filter((t) => t !== tag))
  }

  async function assignLead(leadId: string, userId: string | null) {
    setUpdatingAssignee(true)
    setAssigneeError(null)
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ assignedToUserId: userId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setAssigneeError(data?.error ?? "Couldn't update the assignment.")
        return
      }
      await refreshConversations()
    } catch {
      setAssigneeError("Couldn't reach the server.")
    } finally {
      setUpdatingAssignee(false)
    }
  }

  /** Inserted from the "/" suggestion list: replaces just the trailing
   * `/shortcut` token being typed, keeping anything the agent wrote before
   * it (e.g. "Sure, /pricing" expands only the slash part). */
  function insertQuickReplyFromSlash(reply: QuickReply) {
    setReplyBody((prev) => prev.replace(/(?:^|\s)\/(\S*)$/, (whole) => (whole.startsWith(" ") ? " " : "") + reply.body))
    replyTextareaRef.current?.focus()
  }

  /** Inserted from the full quick-replies list via the toolbar button:
   * appends (or starts fresh) since there's no slash token to replace. */
  function insertQuickReply(reply: QuickReply) {
    setReplyBody((prev) => (prev.trim() ? `${prev.trim()} ${reply.body}` : reply.body))
    replyTextareaRef.current?.focus()
  }

  async function addQuickReply() {
    if (!newQuickReply.shortcut.trim() || !newQuickReply.title.trim() || !newQuickReply.body.trim()) return
    setAddingQuickReply(true)
    setQuickReplyError(null)
    try {
      const res = await fetch("/api/whatsapp/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(newQuickReply),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setQuickReplyError(data?.error ?? "Couldn't save the quick reply.")
        return
      }
      setNewQuickReply({ shortcut: "", title: "", body: "" })
      await refreshQuickReplies()
    } catch {
      setQuickReplyError("Couldn't reach the server.")
    } finally {
      setAddingQuickReply(false)
    }
  }

  async function removeQuickReply(id: string) {
    try {
      await fetch(`/api/whatsapp/quick-replies/${id}`, { method: "DELETE", credentials: "same-origin" })
      await refreshQuickReplies()
    } catch {
      // Non-critical - the agent can retry from the same dropdown.
    }
  }

  const allLabels = conversations
    ? Array.from(new Set(conversations.flatMap((c) => c.lead?.tags ?? []))).sort()
    : []

  const slaBreachedCount = conversations?.filter((c) => c.sla.breached).length ?? 0

  const filteredConversations = conversations?.filter(
    (c) =>
      (resolutionFilter === "all" || c.resolutionStatus === resolutionFilter) &&
      (!labelFilter || c.lead?.tags.includes(labelFilter)) &&
      (!slaFilter || c.sla.breached)
  )

  if (error) {
    return (
      <Card className="px-5 py-8 text-center text-sm text-muted-foreground">{error}</Card>
    )
  }

  if (!conversations) {
    return (
      <Card className="flex items-center justify-center px-5 py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card className="gap-3 px-4 py-4 lg:col-span-4">
        <CardHeader className="px-0">
          <CardTitle className="text-[15px]">Live conversations</CardTitle>
          <p className="text-xs text-muted-foreground">Real inbound WhatsApp Cloud API messages, not the demo simulator.</p>
        </CardHeader>
        <div className="flex flex-wrap gap-1.5">
          {RESOLUTION_FILTERS.map((f) => {
            const count =
              f.value === "all" ? conversations.length : conversations.filter((c) => c.resolutionStatus === f.value).length
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setResolutionFilter(f.value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  resolutionFilter === f.value
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border text-muted-foreground hover:bg-muted/40"
                )}
              >
                {f.label}
                {count > 0 && <span className="ml-1 text-muted-foreground">{count}</span>}
              </button>
            )
          })}
          {slaBreachedCount > 0 && (
            <button
              type="button"
              onClick={() => setSlaFilter((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                slaFilter ? "border-destructive bg-destructive/10 text-destructive" : "border-destructive/40 text-destructive"
              )}
              title={`Waiting over ${SLA_THRESHOLD_MINUTES} minutes for a reply`}
            >
              <AlertTriangle className="size-3" />
              Needs reply
              <span className="ml-0.5">{slaBreachedCount}</span>
            </button>
          )}
        </div>
        {allLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allLabels.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setLabelFilter((prev) => (prev === label ? null : label))}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-opacity",
                  tagColorClass(label),
                  labelFilter && labelFilter !== label && "opacity-40"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <CardContent className="flex flex-col divide-y divide-border px-0">
          {filteredConversations?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {conversations.length === 0 ? "No live conversations yet." : "No conversations match this filter."}
            </p>
          )}
          {filteredConversations?.map((c) => {
            const ResolutionIcon = RESOLUTION_ICON[c.resolutionStatus]
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className="flex flex-col gap-1.5 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{c.contactName ?? c.contactPhone}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge tone={RESOLUTION_TONE[c.resolutionStatus]}>
                      <ResolutionIcon className="size-3" />
                      {RESOLUTION_LABEL[c.resolutionStatus]}
                    </StatusBadge>
                    <StatusBadge tone={STATUS_TONE[c.status]}>
                      {c.status === "bot" ? <Bot className="size-3" /> : <UserCheck className="size-3" />}
                      {STATUS_LABEL[c.status]}
                    </StatusBadge>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{c.contactPhone}</span>
                  {!c.sessionWindow.open && (
                    <span className="flex items-center gap-0.5 text-warning-foreground dark:text-warning" title="24-hour window closed">
                      <TimerOff className="size-3" />
                    </span>
                  )}
                  {c.aiMode === "suggest" && c.pendingAiReply && (
                    <span className="flex items-center gap-0.5 text-brand" title="AI has a suggested reply ready">
                      <Sparkles className="size-3" />
                    </span>
                  )}
                  {c.sla.breached && (
                    <span className="flex items-center gap-0.5 font-medium text-destructive" title={`Waiting ${c.sla.minutesWaiting}m for a reply`}>
                      <AlertTriangle className="size-3" />
                      {c.sla.minutesWaiting}m
                    </span>
                  )}
                  {c.lead?.assignedTo && (() => {
                    const assignee = teamMembers?.find((m) => m.userId === c.lead?.assignedTo)
                    if (!assignee) return null
                    return (
                      <span
                        className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground"
                        title={`Assigned to ${assignee.name}`}
                      >
                        {assignee.name.charAt(0).toUpperCase()}
                      </span>
                    )
                  })()}
                  {c.lead && <LeadScoreBadge score={c.lead.score} className={c.lead.assignedTo ? "" : "ml-auto"} />}
                </div>
                {c.lead && c.lead.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.lead.tags.map((tag) => (
                      <TagChip key={tag} tag={tag} />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </CardContent>
      </Card>

      <Card className="gap-3 px-4 py-4 lg:col-span-5">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
            Select a conversation to view the thread.
          </div>
        ) : (
          <>
            <CardHeader className="flex-row items-start justify-between gap-2 px-0">
              <div>
                <CardTitle className="text-[15px]">{selected.contactName ?? selected.contactPhone}</CardTitle>
                {selected.resolutionStatus === "snoozed" && selected.snoozedUntil && (
                  <p className="text-xs text-muted-foreground">
                    Snoozed until {new Date(selected.snoozedUntil).toLocaleString()}
                  </p>
                )}
                {resolutionError && <p className="text-xs text-destructive">{resolutionError}</p>}
                {aiModeError && <p className="text-xs text-destructive">{aiModeError}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="sm" disabled={updatingResolution}>
                        {updatingResolution ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          React.createElement(RESOLUTION_ICON[selected.resolutionStatus], { className: "size-3.5" })
                        )}
                        {RESOLUTION_LABEL[selected.resolutionStatus]}
                        <ChevronDown className="size-3.5" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Mark conversation as</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => changeResolutionStatus("open")}>
                      <CircleDot className="size-3.5" /> Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => changeResolutionStatus("pending")}>
                      <Clock className="size-3.5" /> Pending
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => changeResolutionStatus("resolved")}>
                      <CheckCircle2 className="size-3.5" /> Resolved
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
                    {snoozeOptions().map((opt) => (
                      <DropdownMenuItem key={opt.label} onClick={() => changeResolutionStatus("snoozed", opt.until())}>
                        <AlarmClock className="size-3.5" /> {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="sm" disabled={updatingAiMode}>
                        {updatingAiMode ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          React.createElement(AI_MODE_ICON[selected.aiMode], { className: "size-3.5" })
                        )}
                        {AI_MODE_LABEL[selected.aiMode]}
                        <ChevronDown className="size-3.5" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>AI reply mode</DropdownMenuLabel>
                    {(["auto", "suggest", "off"] as const).map((mode) => {
                      const Icon = AI_MODE_ICON[mode]
                      return (
                        <DropdownMenuItem key={mode} onClick={() => changeAiMode(mode)} className="flex-col items-start gap-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5" /> {AI_MODE_LABEL[mode]}
                          </span>
                          <span className="pl-5 text-xs text-muted-foreground">{AI_MODE_DESCRIPTION[mode]}</span>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <Tabs value={panelTab} onValueChange={(v) => setPanelTab(v as "messages" | "notes")}>
              <div className="flex items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="messages">Messages</TabsTrigger>
                  <TabsTrigger value="notes">
                    Internal notes{notes && notes.length > 0 ? ` (${notes.length})` : ""}
                  </TabsTrigger>
                </TabsList>
                {panelTab === "messages" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0"
                    title="Search in conversation"
                    onClick={() => {
                      setShowMessageSearch((v) => !v)
                      if (showMessageSearch) setMessageSearch("")
                    }}
                  >
                    <Search className="size-3.5" />
                  </Button>
                )}
              </div>

              <TabsContent value="messages" className="pt-2">
                {showMessageSearch && (
                  <div className="pb-2">
                    <Input
                      autoFocus
                      value={messageSearch}
                      onChange={(e) => setMessageSearch(e.target.value)}
                      placeholder="Search this conversation…"
                      className="h-8 text-xs"
                    />
                  </div>
                )}
                <CardContent className="flex flex-col gap-2 px-0">
                  {!messages ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
                  ) : (
                    (() => {
                      const query = messageSearch.trim()
                      const visible = query ? messages.filter((m) => m.body?.toLowerCase().includes(query.toLowerCase())) : messages
                      if (query && visible.length === 0) {
                        return <p className="py-6 text-center text-sm text-muted-foreground">No messages match &quot;{query}&quot;.</p>
                      }
                      return (
                        <>
                          {query && (
                            <p className="pb-1 text-center text-xs text-muted-foreground">
                              {visible.length} match{visible.length === 1 ? "" : "es"}
                            </p>
                          )}
                          {visible.map((m) => (
                            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`flex max-w-[80%] flex-col gap-0.5 rounded-2xl px-3.5 py-2 text-sm ${
                                  m.direction === "outbound" ? "bg-brand text-brand-foreground" : "bg-muted text-foreground"
                                }`}
                              >
                                {m.media && <MessageAttachment media={m.media} bubbleIsOutbound={m.direction === "outbound"} />}
                                {m.body ? (
                                  <span>{highlightMatches(m.body, query)}</span>
                                ) : !m.media ? (
                                  <span>[{m.messageType}]</span>
                                ) : null}
                                <span
                                  className={`flex items-center justify-end gap-1 text-[11px] ${
                                    m.direction === "outbound" ? "text-brand-foreground/70" : "text-muted-foreground"
                                  }`}
                                >
                                  {formatMessageTime(m.createdAt)}
                                  {m.direction === "outbound" && <MessageStatusTick status={m.providerStatus} />}
                                </span>
                              </div>
                            </div>
                          ))}
                        </>
                      )
                    })()
                  )}
                </CardContent>
                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  {selected.sla.breached && (
                    <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      <span>Waiting {selected.sla.minutesWaiting} minutes for a reply - over the {SLA_THRESHOLD_MINUTES}-minute target.</span>
                    </div>
                  )}
                  {selected.aiMode === "suggest" && selected.pendingAiReply && (
                    <div className="flex flex-col gap-1.5 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-brand">
                        <Sparkles className="size-3.5 shrink-0" /> AI suggested reply
                      </div>
                      <p className="text-foreground">{selected.pendingAiReply}</p>
                      <div className="flex gap-1.5 pt-0.5">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => applySuggestedReply(selected.pendingAiReply ?? "")}>
                          Use this reply
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={discardSuggestion}>
                          <X className="size-3" /> Discard
                        </Button>
                      </div>
                    </div>
                  )}
                  {!selected.sessionWindow.open && (
                    <div className="flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning-foreground dark:text-warning">
                      <TimerOff className="size-3.5 shrink-0" />
                      <span>
                        24-hour window closed — only a pre-approved template message can be sent until the customer
                        messages again.
                      </span>
                    </div>
                  )}
                  {sendError && <p className="text-xs text-destructive">{sendError}</p>}
                  {mediaError && <p className="text-xs text-destructive">{mediaError}</p>}
                  {(() => {
                    const slashQuery = trailingSlashQuery(replyBody)
                    const matches =
                      slashQuery !== null && quickReplies
                        ? quickReplies.filter((q) => q.shortcut.toLowerCase().startsWith(slashQuery.toLowerCase()))
                        : []
                    if (!matches.length) return null
                    return (
                      <div className="flex flex-col overflow-hidden rounded-md border border-border">
                        {matches.slice(0, 5).map((q) => (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => insertQuickReplyFromSlash(q)}
                            className="flex flex-col items-start gap-0 px-2.5 py-1.5 text-left text-xs hover:bg-muted/60"
                          >
                            <span className="font-medium text-foreground">/{q.shortcut}</span>
                            <span className="truncate text-muted-foreground">{q.title}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                  <div className="flex items-end gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="outline" size="sm" className="shrink-0" title="Quick replies">
                            <MessageSquareText className="size-3.5" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="start" className="w-72">
                        <DropdownMenuLabel>Quick replies</DropdownMenuLabel>
                        {quickReplies?.length === 0 && (
                          <p className="px-2 py-1 text-xs text-muted-foreground">
                            No saved replies yet - add one below, then type &quot;/&quot; in the reply box any time.
                          </p>
                        )}
                        {quickReplies?.map((q) => (
                          <DropdownMenuItem key={q.id} className="flex items-start justify-between gap-2">
                            <button type="button" onClick={() => insertQuickReply(q)} className="flex flex-1 flex-col items-start gap-0 text-left">
                              <span className="font-medium">/{q.shortcut}</span>
                              <span className="text-xs text-muted-foreground">{q.title}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeQuickReply(q.id)
                              }}
                              aria-label={`Delete quick reply ${q.shortcut}`}
                            >
                              <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                            </button>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>New quick reply</DropdownMenuLabel>
                        <div className="flex flex-col gap-1.5 px-2 pb-2">
                          <Input
                            value={newQuickReply.shortcut}
                            onChange={(e) => setNewQuickReply((prev) => ({ ...prev, shortcut: e.target.value }))}
                            placeholder="shortcut (e.g. pricing)"
                            className="h-7 text-xs"
                          />
                          <Input
                            value={newQuickReply.title}
                            onChange={(e) => setNewQuickReply((prev) => ({ ...prev, title: e.target.value }))}
                            placeholder="Title"
                            className="h-7 text-xs"
                          />
                          <Textarea
                            value={newQuickReply.body}
                            onChange={(e) => setNewQuickReply((prev) => ({ ...prev, body: e.target.value }))}
                            placeholder="Full reply text…"
                            className="min-h-14 text-xs"
                          />
                          {quickReplyError && <p className="text-xs text-destructive">{quickReplyError}</p>}
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={addingQuickReply || !newQuickReply.shortcut.trim() || !newQuickReply.title.trim() || !newQuickReply.body.trim()}
                            onClick={addQuickReply}
                          >
                            {addingQuickReply ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                            Save
                          </Button>
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/ogg,audio/mpeg,audio/amr,audio/aac,application/pdf,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ""
                        if (file) sendAttachment(file)
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      title="Send an attachment"
                      disabled={uploadingMedia}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingMedia ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                    </Button>
                    <Textarea
                      ref={replyTextareaRef}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder="Type a reply… (try “/” for quick replies)"
                      className="min-h-9 flex-1 resize-none"
                      onKeyDown={(e) => {
                        const slashQuery = trailingSlashQuery(replyBody)
                        const topMatch =
                          slashQuery !== null && quickReplies
                            ? quickReplies.find((q) => q.shortcut.toLowerCase().startsWith(slashQuery.toLowerCase()))
                            : undefined
                        if (e.key === "Tab" && topMatch) {
                          e.preventDefault()
                          insertQuickReplyFromSlash(topMatch)
                          return
                        }
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          if (topMatch) {
                            insertQuickReplyFromSlash(topMatch)
                          } else {
                            sendReply()
                          }
                        }
                      }}
                    />
                    <Button size="sm" onClick={sendReply} disabled={sending || !replyBody.trim()}>
                      {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Send
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="pt-2">
                <CardContent className="flex flex-col gap-2 px-0">
                  <p className="text-xs text-muted-foreground">Visible only to your team — never sent to the customer.</p>
                  {!notes ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No internal notes yet.</p>
                  ) : (
                    notes.map((n) => (
                      <div key={n.id} className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
                        <p className="text-foreground">{n.body}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {n.authorName ?? "Unknown"} · {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  {noteError && <p className="text-xs text-destructive">{noteError}</p>}
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={noteBody}
                      onChange={(e) => setNoteBody(e.target.value)}
                      placeholder="Add an internal note for your team…"
                      className="min-h-9 flex-1 resize-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          addNote()
                        }
                      }}
                    />
                    <Button size="sm" variant="outline" onClick={addNote} disabled={addingNote || !noteBody.trim()}>
                      {addingNote ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Add note
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </Card>

      <Card className="gap-3 px-4 py-4 lg:col-span-3">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
            Customer details appear here.
          </div>
        ) : (
          <>
            <CardHeader className="px-0">
              <CardTitle className="text-[15px]">Customer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 px-0">
              <div className="flex items-start gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="size-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{selected.contactName ?? "Unknown name"}</span>
                  <span className="text-xs text-muted-foreground">{selected.contactPhone}</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="size-3.5 shrink-0" />
                <span>
                  Source: <span className="text-foreground">{selected.lead?.source.platform ?? "whatsapp"}</span>
                  {selected.lead?.source.campaign && <span> · {selected.lead.source.campaign}</span>}
                </span>
              </div>

              {(selected.status === "escalated" || selected.status === "human") && (
                <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950/30">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <UserCog className="size-3.5 shrink-0" />
                    Handed off from AI
                  </div>
                  {handoffReason === undefined ? (
                    <p className="text-xs text-muted-foreground">Loading handoff context…</p>
                  ) : (
                    <>
                      <p className="text-xs text-foreground">
                        {handoffReason ?? "A human took this over - no escalation reason was logged by the bot."}
                      </p>
                      {selected.lead && Object.values(selected.lead.qualification).some(Boolean) && (
                        <div className="flex flex-col gap-1 border-t border-amber-200 pt-2 dark:border-amber-900">
                          <span className="text-[11px] font-medium text-muted-foreground">What the AI learned</span>
                          <dl className="flex flex-col gap-0.5">
                            {QUALIFICATION_FIELD_ORDER.filter((key) => selected.lead!.qualification[key]).map((key) => (
                              <div key={key} className="flex gap-1 text-[11px]">
                                <dt className="shrink-0 text-muted-foreground">{QUALIFICATION_FIELD_LABEL[key]}:</dt>
                                <dd className="text-foreground">{selected.lead!.qualification[key]}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {selected.lead && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Assigned to</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="outline" size="sm" className="w-fit justify-start" disabled={updatingAssignee}>
                          {updatingAssignee ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <UserPlus className="size-3.5" />
                          )}
                          {teamMembers?.find((m) => m.userId === selected.lead?.assignedTo)?.name ?? "Unassigned"}
                          <ChevronDown className="size-3.5" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => selected.lead && assignLead(selected.lead.id, null)}>Unassigned</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {teamMembers?.map((m) => (
                        <DropdownMenuItem key={m.userId} onClick={() => selected.lead && assignLead(selected.lead.id, m.userId)}>
                          {m.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {assigneeError && <p className="text-xs text-destructive">{assigneeError}</p>}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Labels</span>
                <div className="flex flex-wrap items-center gap-1">
                  {selected.lead?.tags.map((tag) => (
                    <TagChip key={tag} tag={tag} onRemove={() => removeConversationTag(selected.lead as Lead, tag)} />
                  ))}
                  {selected.lead && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (!selected.lead || !tagDraft.trim()) return
                        addConversationTag(selected.lead, tagDraft)
                        setTagDraft("")
                      }}
                    >
                      <Input
                        value={tagDraft}
                        onChange={(e) => setTagDraft(e.target.value)}
                        placeholder="+ label"
                        disabled={updatingTags}
                        className="h-5.5 w-20 border-dashed px-1.5 text-[11px]"
                      />
                    </form>
                  )}
                </div>
                {tagError && <p className="text-xs text-destructive">{tagError}</p>}
              </div>

              {selected.lead ? (
                <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Lead score</span>
                    <LeadScoreBadge score={selected.lead.score} />
                  </div>
                  <p className="text-xs text-muted-foreground">Stage: {selected.lead.stage}</p>
                  {selected.lead.scoreFactors ? (
                    <div className="flex flex-col gap-2 pt-1">
                      {(Object.keys(SCORE_FACTOR_WEIGHTS) as (keyof LeadScoreFactors)[]).map((key) => (
                        <ScoreFactorBar key={key} factorKey={key} value={selected.lead!.scoreFactors![key]} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No score breakdown yet - the bot computes one as it qualifies this lead.</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No linked lead yet.</p>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
