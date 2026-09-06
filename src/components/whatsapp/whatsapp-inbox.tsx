"use client"

import * as React from "react"
import {
  Archive,
  CircleDashed,
  CornerUpRight,
  FileText,
  Loader2,
  MessageCircle,
  Mic,
  Paperclip,
  Phone,
  Reply,
  Search,
  Send,
  Smile,
  Sparkles,
  Pin,
  BellOff,
  Square,
  Star,
  Image as ImageIcon,
  Users,
  UsersRound,
  X,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WhatsAppIcon } from "@/components/whatsapp/whatsapp-icon"

/**
 * EasyLife's WhatsApp workspace - the screen a client lives in once their
 * number is linked.
 *
 * It follows the shape people already know from WhatsApp on the desktop: a
 * narrow rail of sections, the chat list with its filters, and the
 * conversation on the right. That familiarity is the point; nobody should
 * have to learn a new mental model to answer a customer.
 *
 * What it is NOT is a pretence. Everything on screen comes from the client's
 * own linked number through the gateway. Where a section cannot be served -
 * Communities and Channels are not available on the Baileys engine, and Meta
 * AI is Meta's own assistant with no API at all - the section says so
 * plainly instead of showing an empty list that looks like the client simply
 * has none.
 */

interface Chat {
  id: string
  name: string | null
  isGroup: boolean
  kind: string
  unreadCount: number
  lastMessage: string | null
  timestamp: number | null
  archived: boolean
  pinned: boolean
  muted: boolean
  favourite: boolean
}

interface Message {
  id: string
  chatId: string
  body: string | null
  type: string
  direction: "in" | "out"
  timestamp: number | null
  status: string | null
  authorName: string | null
  hasMedia: boolean
}

interface LeadSummary {
  id: string
  name: string | null
  stage: string
  status: string
  score: number | null
  serviceInterested: string | null
  budget: string | null
  timeline: string | null
}

interface StatusUpdate {
  id: string
  contactName: string | null
  contactId: string | null
  type: string
  caption: string | null
  timestamp: number | null
}

type Section = "chats" | "updates" | "communities" | "calls" | "media" | "easylife-ai" | "archived" | "starred"
type ChatFilter = "all" | "unread" | "favourites" | "groups"

const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: "chats", label: "Chats", icon: MessageCircle },
  { id: "updates", label: "Updates", icon: CircleDashed },
  { id: "communities", label: "Communities", icon: UsersRound },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "easylife-ai", label: "EasyLife AI", icon: Sparkles },
  { id: "archived", label: "Archived", icon: Archive },
  { id: "starred", label: "Starred", icon: Star },
]

function timeLabel(unixSeconds: number | null): string {
  if (!unixSeconds) return ""
  const date = new Date(unixSeconds * 1000)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString([], { day: "numeric", month: "short" })
}

/** Which of WhatsApp's message types this is, in terms of how it renders.
 * `ptt` is WhatsApp's own name for a voice note. */
function mediaKind(type: string): "image" | "video" | "voice" | "audio" | "document" | "sticker" | null {
  const t = type.toLowerCase()
  if (t === "image") return "image"
  if (t === "video") return "video"
  if (t === "ptt" || t === "voice") return "voice"
  if (t === "audio") return "audio"
  if (t === "document") return "document"
  if (t === "sticker") return "sticker"
  return null
}

/** What to send a picked file as. WhatsApp treats these differently - an
 * image sent as a document loses its preview, and a document sent as an image
 * is rejected outright. */
function kindForFile(file: File): "image" | "video" | "audio" | "document" {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  return "document"
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function displayName(chat: Chat): string {
  return chat.name?.trim() || chat.id.split("@")[0]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function WhatsAppInbox() {
  const [section, setSection] = React.useState<Section>("chats")
  const [filter, setFilter] = React.useState<ChatFilter>("all")
  const [query, setQuery] = React.useState("")

  const [chats, setChats] = React.useState<Chat[]>([])
  const [loadingChats, setLoadingChats] = React.useState(true)
  const [chatsError, setChatsError] = React.useState<string | null>(null)
  const [can, setCan] = React.useState<{ send?: boolean; status?: boolean }>({})

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = React.useState(false)
  const [messagesError, setMessagesError] = React.useState<string | null>(null)

  const [statuses, setStatuses] = React.useState<StatusUpdate[] | null>(null)
  const [statusError, setStatusError] = React.useState<string | null>(null)

  const [draft, setDraft] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState<string | null>(null)

  /** The message being replied to, if any - shown above the composer. */
  const [quoted, setQuoted] = React.useState<Message | null>(null)
  /** The message the forward picker is choosing a destination for. */
  const [forwarding, setForwarding] = React.useState<Message | null>(null)
  const [starred, setStarred] = React.useState<Set<string>>(new Set())
  const [busyMessage, setBusyMessage] = React.useState<string | null>(null)

  const [recording, setRecording] = React.useState(false)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const fileRef = React.useRef<HTMLInputElement | null>(null)

  const [aiBusy, setAiBusy] = React.useState(false)
  const [aiText, setAiText] = React.useState<string | null>(null)
  const [aiError, setAiError] = React.useState<string | null>(null)
  const [aiQuestion, setAiQuestion] = React.useState("")

  const [gallery, setGallery] = React.useState<Message[] | null>(null)
  const [galleryError, setGalleryError] = React.useState<string | null>(null)
  const [lead, setLead] = React.useState<LeadSummary | null | undefined>(undefined)

  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  // ---- chat list -------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/whatsapp/inbox")
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setChatsError(json.error ?? "Could not load your chats.")
          return
        }
        setChats(json.chats ?? [])
        setCan(json.can ?? {})
      } catch {
        if (!cancelled) setChatsError("Could not reach EasyLife.")
      } finally {
        if (!cancelled) setLoadingChats(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Re-reads the chat list quietly - no spinner, no flicker - so the poll
   * below can keep it current without the screen twitching every few
   * seconds. */
  const refreshChats = React.useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/inbox")
      const json = await res.json()
      if (res.ok) {
        setChats(json.chats ?? [])
        setCan(json.can ?? {})
      }
    } catch {
      /* a missed poll is not worth an error banner; the next one retries */
    }
  }, [])

  // ---- one conversation -------------------------------------------------
  const openChat = React.useCallback(async (chatId: string) => {
    setActiveId(chatId)
    setMessages([])
    setMessagesError(null)
    setSendError(null)
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/whatsapp/inbox?view=messages&chatId=${encodeURIComponent(chatId)}`)
      const json = await res.json()
      if (!res.ok) setMessagesError(json.error ?? "Could not load this conversation.")
      else setMessages(json.messages ?? [])
    } catch {
      setMessagesError("Could not reach EasyLife.")
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  React.useEffect(() => {
    // Keep the newest message in view when a conversation loads.
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  /**
   * Keeps the screen current without a manual refresh.
   *
   * Polling, not a socket: the gateway pushes to EasyLife's webhook, not to
   * the browser, so a socket here would need a whole delivery path of its
   * own. Five seconds on the open conversation is fast enough to feel live
   * while a person is typing; the chat list moves more slowly and is read at
   * fifteen. Both pause when the tab is hidden, so a forgotten tab does not
   * poll all night.
   */
  React.useEffect(() => {
    let cancelled = false
    let chatTimer: ReturnType<typeof setTimeout> | undefined
    let messageTimer: ReturnType<typeof setTimeout> | undefined

    const pollChats = async () => {
      if (!cancelled && document.visibilityState === "visible") await refreshChats()
      if (!cancelled) chatTimer = setTimeout(() => void pollChats(), 15000)
    }
    const pollMessages = async () => {
      if (!cancelled && activeId && document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/whatsapp/inbox?view=messages&chatId=${encodeURIComponent(activeId)}`)
          const json = await res.json()
          // Replaced only when the count changed, so the list is not rebuilt
          // (and the scroll position lost) on every quiet poll.
          if (!cancelled && res.ok && Array.isArray(json.messages)) {
            setMessages((prev) => (prev.length === json.messages.length ? prev : json.messages))
          }
        } catch {
          /* ignored - the next poll retries */
        }
      }
      if (!cancelled) messageTimer = setTimeout(() => void pollMessages(), 5000)
    }

    chatTimer = setTimeout(() => void pollChats(), 15000)
    messageTimer = setTimeout(() => void pollMessages(), 5000)
    return () => {
      cancelled = true
      if (chatTimer) clearTimeout(chatTimer)
      if (messageTimer) clearTimeout(messageTimer)
    }
  }, [activeId, refreshChats])

  // ---- the lead behind the open conversation ----------------------------
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Clearing happens inside the async body rather than synchronously in
      // the effect, so switching conversations never sets state during the
      // render pass.
      if (!activeId) {
        if (!cancelled) setLead(undefined)
        return
      }
      try {
        const res = await fetch(`/api/whatsapp/inbox?view=lead&chatId=${encodeURIComponent(activeId)}`)
        const json = await res.json()
        if (!cancelled) setLead(res.ok ? (json.lead ?? null) : null)
      } catch {
        if (!cancelled) setLead(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeId])

  // ---- the media gallery, loaded when its section is opened -------------
  React.useEffect(() => {
    if (section !== "media" || gallery !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/whatsapp/inbox?view=media")
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) setGalleryError(json.error ?? "Could not load media.")
        else setGallery(json.media ?? [])
      } catch {
        if (!cancelled) setGalleryError("Could not reach EasyLife.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [section, gallery])

  // ---- status updates ---------------------------------------------------
  React.useEffect(() => {
    if (section !== "updates" || statuses !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/whatsapp/inbox?view=status")
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) setStatusError(json.error ?? "Could not load updates.")
        else setStatuses(json.statuses ?? [])
      } catch {
        if (!cancelled) setStatusError("Could not reach EasyLife.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [section, statuses])

  /** One place every message action goes through, so each of them reports a
   * refusal from the feature gate the same way instead of failing silently. */
  async function act(payload: Record<string, unknown>, onDone?: () => void) {
    setSendError(null)
    setBusyMessage(String(payload.messageId ?? payload.chatId ?? ""))
    try {
      const res = await fetch("/api/whatsapp/inbox/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSendError(json.error ?? "That didn't work.")
        return false
      }
      onDone?.()
      return true
    } catch {
      setSendError("Could not reach EasyLife.")
      return false
    } finally {
      setBusyMessage(null)
    }
  }

  async function sendFile(file: File, asVoiceNote = false) {
    if (!activeId) return
    setSending(true)
    setSendError(null)
    try {
      const base64 = await fileToBase64(file)
      const ok = await act({
        action: "send-media",
        chatId: activeId,
        kind: asVoiceNote ? "audio" : kindForFile(file),
        base64,
        mimeType: file.type || "application/octet-stream",
        filename: file.name || undefined,
        caption: draft.trim() || undefined,
        voiceNote: asVoiceNote || undefined,
      })
      if (ok) {
        setDraft("")
        await openChat(activeId)
      }
    } finally {
      setSending(false)
    }
  }

  /** Records a voice note in the browser and sends it as one. The gateway
   * converts it to the Ogg/Opus form WhatsApp shows as a mic bubble - sent
   * raw it would arrive as an audio file with a download button. */
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        if (blob.size > 0) {
          await sendFile(new File([blob], "voice-note", { type: blob.type }), true)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setSendError("EasyLife needs permission to use the microphone to record a voice note.")
    }
  }

  async function askAi(mode: "summarise" | "suggest-reply" | "ask") {
    if (!activeId) return
    setAiBusy(true)
    setAiError(null)
    setAiText(null)
    try {
      const res = await fetch("/api/whatsapp/inbox/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: activeId, mode, question: mode === "ask" ? aiQuestion.trim() : undefined }),
      })
      const json = await res.json()
      if (!res.ok) setAiError(json.error ?? "EasyLife AI could not answer.")
      else setAiText(json.text)
    } catch {
      setAiError("Could not reach EasyLife.")
    } finally {
      setAiBusy(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || !activeId) return
    setSending(true)
    setSendError(null)
    try {
      // Quoting uses the reply endpoint so the customer sees what it answers;
      // a plain send would lose that context.
      const res = quoted
        ? await fetch("/api/whatsapp/inbox/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "reply", chatId: activeId, messageId: quoted.id, text }),
          })
        : await fetch("/api/whatsapp/inbox", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chatId: activeId, text }),
          })
      const json = await res.json()
      if (!res.ok) {
        setSendError(json.error ?? "The message was not sent.")
        return
      }
      setDraft("")
      setQuoted(null)
      // Re-read rather than appending optimistically: the message is only
      // really in the thread once WhatsApp has it.
      await openChat(activeId)
    } catch {
      setSendError("Could not reach EasyLife.")
    } finally {
      setSending(false)
    }
  }

  // ---- derived lists ----------------------------------------------------
  const needle = query.trim().toLowerCase()
  const visibleChats = React.useMemo(() => {
    let list = chats.filter((c) => (section === "archived" ? c.archived : !c.archived))
    if (section === "starred") list = chats.filter((c) => c.favourite)
    if (section === "chats" || section === "archived" || section === "starred") {
      if (filter === "unread") list = list.filter((c) => c.unreadCount > 0)
      if (filter === "favourites") list = list.filter((c) => c.favourite)
      if (filter === "groups") list = list.filter((c) => c.isGroup)
    }
    if (needle) list = list.filter((c) => displayName(c).toLowerCase().includes(needle))
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b.timestamp ?? 0) - (a.timestamp ?? 0)
    })
  }, [chats, section, filter, needle])

  const unreadTotal = chats.reduce((n, c) => n + (c.archived ? 0 : c.unreadCount), 0)
  const archivedCount = chats.filter((c) => c.archived).length
  const activeChat = chats.find((c) => c.id === activeId) ?? null
  const showsChatList = section === "chats" || section === "archived" || section === "starred"

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-125 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {/* ---- rail -------------------------------------------------------- */}
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-foreground/10 py-3 sm:w-16">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const active = section === id
          const badge = id === "chats" ? unreadTotal : id === "archived" ? archivedCount : 0
          return (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => setSection(id)}
              className={`relative flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] transition-colors ${
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <Icon className="size-4.5" strokeWidth={1.75} />
              <span className="w-full truncate text-center leading-tight">{label}</span>
              {badge > 0 && (
                <span className="absolute right-1.5 top-1 rounded-full bg-primary px-1.5 text-[9px] font-semibold tabular-nums text-primary-foreground">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* ---- list column ------------------------------------------------- */}
      <div className="flex w-72 shrink-0 flex-col border-r border-foreground/10 sm:w-80">
        <div className="flex flex-col gap-2.5 px-3 pb-2 pt-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <WhatsAppIcon size={16} />
            {SECTIONS.find((s) => s.id === section)?.label}
          </h3>

          {showsChatList && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", "All"],
                    ["unread", "Unread"],
                    ["favourites", "Favourites"],
                    ["groups", "Groups"],
                  ] as [ChatFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      filter === value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/70 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                    {value === "unread" && unreadTotal > 0 && (
                      <span className="ml-1 tabular-nums">{unreadTotal}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showsChatList && (
            <>
              {loadingChats && (
                <p className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading your chats…
                </p>
              )}
              {chatsError && (
                <p className="mx-3 my-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                  <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
                  {chatsError}
                </p>
              )}
              {!loadingChats && !chatsError && visibleChats.length === 0 && (
                <p className="px-3 py-6 text-xs text-muted-foreground">
                  {needle ? `Nothing matches “${query}”.` : "Nothing here yet."}
                </p>
              )}
              <ul>
                {visibleChats.map((chat) => {
                  const name = displayName(chat)
                  const active = chat.id === activeId
                  return (
                    <li key={chat.id} className="group/row border-b border-foreground/5">
                      <button
                        type="button"
                        onClick={() => void openChat(chat.id)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                          active ? "bg-primary/10" : "hover:bg-muted/50"
                        }`}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {chat.isGroup ? <Users className="size-4" strokeWidth={1.75} /> : initials(name)}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{name}</span>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                              {timeLabel(chat.timestamp)}
                            </span>
                          </span>
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-muted-foreground">
                              {chat.lastMessage || "—"}
                            </span>
                            {chat.unreadCount > 0 && (
                              <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
                                {chat.unreadCount}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>

                      {/* Tidying actions, revealed on hover so the list stays
                          a list. Each is re-read from the gateway afterwards
                          rather than flipped locally, because the phone is
                          the authority on whether a chat is really pinned. */}
                      <span className="flex items-center gap-0.5 px-3 pb-1.5 opacity-0 transition-opacity group-hover/row:opacity-100">
                        <IconAction
                          title={chat.pinned ? "Unpin" : "Pin"}
                          icon={Pin}
                          active={chat.pinned}
                          busy={busyMessage === chat.id}
                          onClick={() =>
                            void act({ action: "chat-flag", chatId: chat.id, flag: "pin", on: !chat.pinned }, () =>
                              void refreshChats()
                            )
                          }
                        />
                        <IconAction
                          title={chat.muted ? "Unmute" : "Mute"}
                          icon={BellOff}
                          active={chat.muted}
                          busy={busyMessage === chat.id}
                          onClick={() =>
                            void act({ action: "chat-flag", chatId: chat.id, flag: "mute", on: !chat.muted }, () =>
                              void refreshChats()
                            )
                          }
                        />
                        <IconAction
                          title={chat.archived ? "Unarchive" : "Archive"}
                          icon={Archive}
                          active={chat.archived}
                          busy={busyMessage === chat.id}
                          onClick={() =>
                            void act(
                              { action: "chat-flag", chatId: chat.id, flag: "archive", on: !chat.archived },
                              () => void refreshChats()
                            )
                          }
                        />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {section === "updates" && (
            <div className="flex flex-col gap-2 p-3">
              {statusError && <p className="text-xs text-destructive">{statusError}</p>}
              {!statusError && statuses === null && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading updates…
                </p>
              )}
              {statuses?.length === 0 && <p className="text-xs text-muted-foreground">No status updates right now.</p>}
              {statuses?.map((s) => (
                <div key={s.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted ring-2 ring-primary/40">
                    <CircleDashed className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {s.contactName ?? s.contactId?.split("@")[0] ?? "Unknown"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {s.caption || s.type} · {timeLabel(s.timestamp)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {section === "easylife-ai" && (
            <div className="flex flex-col gap-2.5 p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                EasyLife AI has read the conversation you have open. It drafts — it never sends. Anything it
                suggests lands in the reply box for you to check first.
              </p>

              {!activeId && <p className="text-xs text-muted-foreground">Open a conversation first.</p>}

              {activeId && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => void askAi("summarise")}>
                      {aiBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      Summarise
                    </Button>
                    <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => void askAi("suggest-reply")}>
                      <Reply className="size-3.5" />
                      Suggest a reply
                    </Button>
                  </div>

                  <div className="flex gap-1.5">
                    <Input
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && aiQuestion.trim() && void askAi("ask")}
                      placeholder="Ask about this chat…"
                      className="h-8 text-xs"
                    />
                    <Button size="sm" variant="outline" disabled={aiBusy || !aiQuestion.trim()} onClick={() => void askAi("ask")}>
                      Ask
                    </Button>
                  </div>

                  {aiError && (
                    <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                      <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
                      {aiError}
                    </p>
                  )}

                  {aiText && (
                    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{aiText}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-fit"
                        onClick={() => {
                          setDraft(aiText)
                          setSection("chats")
                        }}
                      >
                        Put it in the reply box
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {section === "media" && (
            <div className="p-3">
              {galleryError && (
                <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                  <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
                  {galleryError}
                </p>
              )}
              {!galleryError && gallery === null && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading media…
                </p>
              )}
              {gallery?.length === 0 && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No media yet. Photos, videos, voice notes and documents appear here once they arrive — the
                  history synced when the number was linked carries no files, only the messages.
                </p>
              )}
              {gallery && gallery.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5">
                  {gallery.slice(0, 120).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      title={`${m.type} · ${timeLabel(m.timestamp)}`}
                      onClick={() => {
                        setSection("chats")
                        void openChat(m.chatId)
                      }}
                      className="aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition-opacity hover:opacity-80"
                    >
                      <GalleryTile message={m} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(section === "communities" || section === "calls") && <UnavailableSection section={section} />}
        </div>
      </div>

      {/* ---- conversation ------------------------------------------------ */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {!activeChat && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <WhatsAppIcon size={40} />
            <p className="text-sm font-medium text-foreground">EasyLife WhatsApp</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Pick a conversation to read it and reply. Everything here is your own linked number — the same chats
              you see on your phone.
            </p>
          </div>
        )}

        {activeChat && (
          <>
            <header className="flex items-center gap-2.5 border-b border-foreground/10 px-4 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {activeChat.isGroup ? <Users className="size-4" strokeWidth={1.75} /> : initials(displayName(activeChat))}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{displayName(activeChat)}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {activeChat.isGroup ? "Group" : activeChat.id.split("@")[0]}
                </span>
              </div>

              {/* Where this person stands in the CRM, so nobody has to leave
                  the inbox to find out. Absent when there is no lead - a
                  group, or someone never qualified - rather than shown empty. */}
              {lead && (
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {lead.score !== null && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {lead.score}
                    </span>
                  )}
                  <span className="hidden flex-col text-right sm:flex">
                    <span className="text-xs font-medium capitalize text-foreground">
                      {lead.stage.replace(/-/g, " ")}
                    </span>
                    <span className="text-[10px] capitalize text-muted-foreground">{lead.status}</span>
                  </span>
                  <a
                    href={`/dashboard/leads?lead=${encodeURIComponent(lead.id)}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Lead
                  </a>
                </div>
              )}
            </header>

            {lead && (lead.serviceInterested || lead.budget || lead.timeline) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-foreground/10 bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                {lead.serviceInterested && (
                  <span>
                    Wants <span className="text-foreground">{lead.serviceInterested}</span>
                  </span>
                )}
                {lead.budget && (
                  <span>
                    Budget <span className="text-foreground">{lead.budget}</span>
                  </span>
                )}
                {lead.timeline && (
                  <span>
                    Timeline <span className="text-foreground">{lead.timeline}</span>
                  </span>
                )}
              </div>
            )}

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/25 px-4 py-3">
              {loadingMessages && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading conversation…
                </p>
              )}
              {messagesError && (
                <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                  <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
                  {messagesError}
                </p>
              )}
              {!loadingMessages && !messagesError && messages.length === 0 && (
                <p className="text-xs text-muted-foreground">No messages in this conversation yet.</p>
              )}

              <div className="flex flex-col gap-1.5">
                {messages.map((m) => (
                  <div key={m.id} className={`group/msg flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`flex max-w-[75%] flex-col gap-1 rounded-xl px-3 py-2 text-sm shadow-[0_1px_1px_rgba(0,0,0,0.04)] ${
                        m.direction === "out"
                          ? "bg-primary/15 text-foreground"
                          : "bg-card text-foreground ring-1 ring-foreground/10"
                      }`}
                    >
                      <MessageMedia message={m} />
                      {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}

                      <span className="flex items-center justify-end gap-1.5">
                        {/* Actions stay hidden until the message is hovered,
                            so a long thread reads as a conversation rather
                            than a wall of buttons. */}
                        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
                          <IconAction title="Reply" onClick={() => setQuoted(m)} icon={Reply} />
                          <IconAction title="Forward" onClick={() => setForwarding(m)} icon={CornerUpRight} />
                          <IconAction
                            title={starred.has(m.id) ? "Unstar" : "Star"}
                            busy={busyMessage === m.id}
                            onClick={() =>
                              void act(
                                { action: "star", chatId: m.chatId, messageId: m.id, starred: !starred.has(m.id) },
                                () =>
                                  setStarred((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(m.id)) next.delete(m.id)
                                    else next.add(m.id)
                                    return next
                                  })
                              )
                            }
                            icon={Star}
                            active={starred.has(m.id)}
                          />
                          <IconAction
                            title="React 👍"
                            busy={busyMessage === m.id}
                            onClick={() => void act({ action: "react", chatId: m.chatId, messageId: m.id, emoji: "👍" })}
                            icon={Smile}
                          />
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{timeLabel(m.timestamp)}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <footer className="border-t border-foreground/10 px-3 py-2.5">
              {sendError && (
                <p className="mb-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
                  {sendError}
                </p>
              )}
              {can.send === false ? (
                <p className="text-xs text-muted-foreground">
                  Sending messages is not enabled for this workspace — contact EasyLife to turn it on.
                </p>
              ) : (
                <>
                  {quoted && (
                    <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-primary bg-muted/60 px-3 py-2">
                      <Reply className="mt-px size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {quoted.body || quoted.type}
                      </span>
                      <button type="button" onClick={() => setQuoted(null)} title="Cancel reply">
                        <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-end gap-1.5">
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ""
                        if (file) void sendFile(file)
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Attach a photo, video, PDF or any file"
                      disabled={sending || recording}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Paperclip className="size-4" />
                    </Button>

                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          void send()
                        }
                      }}
                      rows={1}
                      placeholder={recording ? "Recording… press stop to send" : "Type a message"}
                      disabled={recording}
                      className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                    />

                    {/* A voice note when there is nothing typed, send when
                        there is - the same swap WhatsApp itself does. */}
                    {draft.trim() ? (
                      <Button size="sm" disabled={sending} onClick={() => void send()} title="Send">
                        {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={recording ? "destructive" : "default"}
                        disabled={sending}
                        onClick={() => void toggleRecording()}
                        title={recording ? "Stop and send" : "Record a voice note"}
                      >
                        {sending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : recording ? (
                          <Square className="size-3.5" />
                        ) : (
                          <Mic className="size-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </footer>
          </>
        )}

        {/* Forwarding needs a destination, and the destination is another
            chat - so the picker is the chat list, filtered, rather than a
            free-text box nobody could fill in correctly. */}
        {forwarding && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4">
            <div className="flex max-h-96 w-full max-w-sm flex-col rounded-xl bg-card shadow-lg ring-1 ring-foreground/10">
              <div className="flex items-center justify-between gap-2 border-b border-foreground/10 px-3 py-2.5">
                <span className="text-sm font-semibold text-foreground">Forward to…</span>
                <button type="button" onClick={() => setForwarding(null)} title="Cancel">
                  <X className="size-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
              <p className="truncate px-3 pt-2 text-xs text-muted-foreground">
                {forwarding.body || forwarding.type}
              </p>
              <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                {chats
                  .filter((c) => c.id !== forwarding.chatId)
                  .slice(0, 60)
                  .map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full truncate px-3 py-2 text-left text-sm text-foreground hover:bg-muted/60"
                        onClick={() =>
                          void act(
                            {
                              action: "forward",
                              chatId: forwarding.chatId,
                              messageId: forwarding.id,
                              toChatId: c.id,
                            },
                            () => setForwarding(null)
                          )
                        }
                      >
                        {displayName(c)}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Renders whatever the message actually carries.
 *
 * Media is fetched through EasyLife rather than from the gateway directly -
 * the browser never sees a gateway URL or an API key - and only when the
 * bubble is on screen, so opening a long thread does not pull down every
 * photo in it.
 *
 * A voice note gets a real audio player. That is the whole point of the
 * request: hearing it here instead of reaching for the phone.
 */
function MessageMedia({ message }: { message: Message }) {
  const kind = mediaKind(message.type)
  const [failed, setFailed] = React.useState(false)
  if (!kind) return null

  const src = `/api/whatsapp/inbox/media?chatId=${encodeURIComponent(message.chatId)}&messageId=${encodeURIComponent(
    message.id
  )}`

  if (failed) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="size-3.5" strokeWidth={1.75} />
        {/* Not a silent broken image: the gateway only stores media for
            messages it received while running, so older ones genuinely are
            not here. Saying which is kinder than a grey box. */}
        This {kind === "voice" ? "voice note" : kind} isn&apos;t stored on the gateway.
      </span>
    )
  }

  if (kind === "image" || kind === "sticker") {
    // A plain <img>, not next/image: the source is an authenticated route
    // that streams bytes fetched from the gateway on demand, so there is
    // nothing for the image optimiser to pre-process or cache, and routing
    // somebody's WhatsApp photos through it would put them in a shared cache.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={kind === "sticker" ? "Sticker" : "Photo"}
        loading="lazy"
        onError={() => setFailed(true)}
        className={kind === "sticker" ? "size-28 object-contain" : "max-h-72 w-full rounded-lg object-cover"}
      />
    )
  }

  if (kind === "video") {
    return (
      <video src={src} controls preload="metadata" onError={() => setFailed(true)} className="max-h-72 w-full rounded-lg" />
    )
  }

  if (kind === "voice" || kind === "audio") {
    return (
      <span className="flex items-center gap-2">
        {kind === "voice" && <Mic className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />}
        <audio src={src} controls preload="none" onError={() => setFailed(true)} className="h-9 max-w-64" />
      </span>
    )
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg bg-muted/70 px-2.5 py-2 text-xs text-foreground hover:bg-muted"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="truncate">{message.body || "Open document"}</span>
    </a>
  )
}

/** One square in the media gallery. Images and videos show themselves;
 * anything else shows what it is, because a grey box with no label tells a
 * person nothing about the file they are looking for. */
function GalleryTile({ message }: { message: Message }) {
  const kind = mediaKind(message.type)
  const [failed, setFailed] = React.useState(false)
  const src = `/api/whatsapp/inbox/media?chatId=${encodeURIComponent(message.chatId)}&messageId=${encodeURIComponent(
    message.id
  )}`

  if (!failed && (kind === "image" || kind === "sticker")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt="Shared media"
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    )
  }

  const Icon = kind === "video" ? ImageIcon : kind === "voice" || kind === "audio" ? Mic : FileText
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
      <Icon className="size-5" strokeWidth={1.75} />
      <span className="text-[10px] capitalize">{kind ?? message.type}</span>
    </span>
  )
}

function IconAction({
  title,
  icon: Icon,
  onClick,
  busy,
  active,
}: {
  title: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  onClick: () => void
  busy?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className={`rounded p-0.5 transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" strokeWidth={2} />}
    </button>
  )
}

/**
 * Says why a section is empty instead of showing an empty list.
 *
 * Two different reasons, and the difference matters to whoever is reading:
 * the engine genuinely cannot do it, or it is somebody else's product.
 */
function UnavailableSection({ section }: { section: Section }) {
  const copy: Record<string, { title: string; body: string }> = {
    communities: {
      title: "Communities aren't available here",
      body: "The WhatsApp engine EasyLife uses (Baileys) doesn't expose Communities. They still work normally on your phone — they just can't be shown or managed from here.",
    },
    calls: {
      title: "Call history isn't available here",
      body: "Calls stay on the phone. EasyLife can place AI sales calls from the Call Agent screen, which is a different thing and does keep its own history.",
    },
  }
  const text = copy[section]
  if (!text) return null
  return (
    <div className="flex flex-col gap-1.5 p-4">
      <p className="text-sm font-medium text-foreground">{text.title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{text.body}</p>
    </div>
  )
}
