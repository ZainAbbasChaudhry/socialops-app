"use client"

import * as React from "react"
import {
  Archive,
  CircleDashed,
  Loader2,
  MessageCircle,
  Phone,
  Search,
  Send,
  Sparkles,
  Star,
  Image as ImageIcon,
  Users,
  UsersRound,
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

  async function send() {
    const text = draft.trim()
    if (!text || !activeId) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch("/api/whatsapp/inbox", {
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
                    <li key={chat.id}>
                      <button
                        type="button"
                        onClick={() => void openChat(chat.id)}
                        className={`flex w-full items-center gap-2.5 border-b border-foreground/5 px-3 py-2.5 text-left transition-colors ${
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

          {(section === "communities" || section === "calls" || section === "media" || section === "easylife-ai") && (
            <UnavailableSection section={section} />
          )}
        </div>
      </div>

      {/* ---- conversation ------------------------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
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
            </header>

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
                  <div
                    key={m.id}
                    className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-[0_1px_1px_rgba(0,0,0,0.04)] ${
                        m.direction === "out"
                          ? "bg-primary/15 text-foreground"
                          : "bg-card text-foreground ring-1 ring-foreground/10"
                      }`}
                    >
                      {m.hasMedia && !m.body && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ImageIcon className="size-3.5" strokeWidth={1.75} />
                          {m.type}
                        </span>
                      )}
                      {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                      <span className="mt-0.5 block text-right text-[10px] tabular-nums text-muted-foreground">
                        {timeLabel(m.timestamp)}
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
                <div className="flex items-end gap-2">
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
                    placeholder="Type a message"
                    className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                  <Button size="sm" disabled={sending || !draft.trim()} onClick={() => void send()}>
                    {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  </Button>
                </div>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
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
    media: {
      title: "Shared media",
      body: "Media from a conversation appears inside that conversation. A combined gallery across every chat isn't built yet.",
    },
    "easylife-ai": {
      title: "EasyLife AI, not Meta AI",
      body: "Meta AI is Meta's own assistant inside WhatsApp and has no API, so it can't appear here. EasyLife's own AI already reads every inbound message, qualifies the lead and can reply — see the qualification bot and Automations.",
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
