import { randomUUID } from "node:crypto"

/**
 * Real Google Calendar API v3 client - same never-throw contract as every
 * other provider adapter in this codebase. Every endpoint verified against
 * Google's own current reference documentation, not guessed.
 */
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"

export interface CalendarSummary {
  id: string
  name: string
  primary: boolean
}

export interface ListCalendarsResult {
  ok: boolean
  calendars?: CalendarSummary[]
  error?: string
}

/** GET /users/me/calendarList - every calendar the connected Google
 * account can see, so a client picks one from the dashboard instead of
 * pasting a calendar ID. */
export async function listCalendars(accessToken: string): Promise<ListCalendarsResult> {
  try {
    const res = await fetch(`${CALENDAR_API_BASE}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Google Calendar API returned ${res.status}` }

    const items = Array.isArray(json?.items) ? json.items : []
    return {
      ok: true,
      calendars: items.map((c: { id: string; summary?: string; primary?: boolean }) => ({
        id: c.id,
        name: c.summary ?? c.id,
        primary: Boolean(c.primary),
      })),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Google Calendar API." }
  }
}

export interface BusyPeriod {
  start: string
  end: string
}

export interface FreeBusyResult {
  ok: boolean
  busy?: BusyPeriod[]
  error?: string
}

/** POST /freeBusy - real availability check against one calendar over a
 * window. Used to warn (not silently block) if a requested meeting time
 * overlaps something already on the calendar. */
export async function checkFreeBusy(accessToken: string, calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<FreeBusyResult> {
  try {
    const res = await fetch(`${CALENDAR_API_BASE}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ timeMin: timeMinIso, timeMax: timeMaxIso, items: [{ id: calendarId }] }),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Google Calendar API returned ${res.status}` }

    const busy = json?.calendars?.[calendarId]?.busy as BusyPeriod[] | undefined
    return { ok: true, busy: busy ?? [] }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Google Calendar API." }
  }
}

export interface CreateEventInput {
  calendarId: string
  summary: string
  description?: string
  startIso: string
  endIso: string
  timeZone: string
  attendeeEmails: string[]
  createMeetLink: boolean
  /** Minutes before the start at which Google should remind everyone. Left
   * unset the event inherits the calendar's defaults, which for a meeting
   * booked by a bot on the client's behalf is not good enough - the client
   * should be reminded whether or not their calendar happens to be
   * configured for it. */
  reminderMinutes?: number[]
}

export interface EventResult {
  ok: boolean
  eventId?: string
  eventUrl?: string
  /** Only ever set when Google's own response actually included a Meet
   * link - never fabricated, never guessed at from the request. */
  meetLink?: string
  errorMessage?: string
}

/** POST /calendars/{calendarId}/events - creates a real calendar event.
 * Meet link creation is opt-in via createMeetLink and, per Google's own
 * guidance, uses a fresh createRequest.requestId every time (reusing one
 * across events can expose meeting details to the wrong people). The
 * returned meetLink is only ever taken from Google's actual response,
 * never assembled or guessed locally. */
export async function createEvent(accessToken: string, input: CreateEventInput): Promise<EventResult> {
  try {
    const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`)
    if (input.createMeetLink) url.searchParams.set("conferenceDataVersion", "1")

    const body: Record<string, unknown> = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso, timeZone: input.timeZone },
      end: { dateTime: input.endIso, timeZone: input.timeZone },
      attendees: input.attendeeEmails.map((email) => ({ email })),
    }
    if (input.createMeetLink) {
      body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
    }
    if (input.reminderMinutes?.length) {
      body.reminders = {
        useDefault: false,
        overrides: input.reminderMinutes.map((minutes) => ({ method: "popup", minutes })),
      }
    }

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, errorMessage: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) return { ok: false, errorMessage: json?.error?.message ?? `Google Calendar API returned ${res.status}` }

    return {
      ok: true,
      eventId: json?.id as string | undefined,
      eventUrl: json?.htmlLink as string | undefined,
      meetLink: (json?.hangoutLink ?? json?.conferenceData?.entryPoints?.find((e: { entryPointType?: string }) => e.entryPointType === "video")?.uri) as
        | string
        | undefined,
    }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unknown Google Calendar error" }
  }
}

export interface SimpleResult {
  ok: boolean
  errorMessage?: string
}

/** PATCH /calendars/{calendarId}/events/{eventId} - partial update, only
 * the fields provided change. */
export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Partial<Pick<CreateEventInput, "summary" | "description" | "startIso" | "endIso" | "timeZone">>
): Promise<SimpleResult> {
  try {
    const body: Record<string, unknown> = {}
    if (patch.summary !== undefined) body.summary = patch.summary
    if (patch.description !== undefined) body.description = patch.description
    if (patch.startIso !== undefined) body.start = { dateTime: patch.startIso, timeZone: patch.timeZone }
    if (patch.endIso !== undefined) body.end = { dateTime: patch.endIso, timeZone: patch.timeZone }

    const res = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(body),
    })
    if (res.status === 401) return { ok: false, errorMessage: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      return { ok: false, errorMessage: json?.error?.message ?? `Google Calendar API returned ${res.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unknown Google Calendar error" }
  }
}

/** DELETE /calendars/{calendarId}/events/{eventId} - cancels (removes)
 * the event from Google Calendar; a 404/410 (already gone) is treated as
 * success, since the end state - no event on the calendar - is the same. */
export async function cancelEvent(accessToken: string, calendarId: string, eventId: string): Promise<SimpleResult> {
  try {
    const res = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 401) return { ok: false, errorMessage: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const json = await res.json().catch(() => null)
      return { ok: false, errorMessage: json?.error?.message ?? `Google Calendar API returned ${res.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unknown Google Calendar error" }
  }
}
