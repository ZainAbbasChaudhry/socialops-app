import { resolveActiveConnection } from "@/lib/integrations/credential-resolution"
import { resolveCredentialValue } from "@/lib/integrations/service"
import { checkFreeBusy } from "@/lib/integrations/google-calendar/client"

/**
 * Real free slots on the workspace's own connected calendar.
 *
 * The point of this file is that a slot offered to a customer must be one
 * the client can actually keep. Everything here therefore comes from
 * Google's own free/busy answer: if the calendar cannot be reached, this
 * returns no slots and says why, rather than inventing plausible times.
 * A bot that offers "Tuesday 3pm" and then cannot honour it does more
 * damage than one that says it will have someone call back.
 */

export interface AvailabilityResult {
  ok: boolean
  /** ISO start times, soonest first. Empty is a legitimate answer. */
  slots: string[]
  timezone: string
  /** Why there are no slots, when that is the case. Safe to log - it never
   * contains a token or a customer's message. */
  reason?: string
}

export interface AvailabilityOptions {
  /** How far ahead to look. */
  days?: number
  durationMinutes?: number
  /** How many to offer. Three is deliberate: enough to be useful, few
   * enough that a customer can answer with a single digit. */
  count?: number
  /** Working hours in the calendar's own timezone, 24h. */
  startHour?: number
  endHour?: number
  /** Nothing sooner than this - a slot 5 minutes from now is not an offer,
   * it is an ambush. */
  leadTimeMinutes?: number
}

const DEFAULTS: Required<AvailabilityOptions> = {
  days: 7,
  durationMinutes: 30,
  count: 3,
  startHour: 10,
  endHour: 18,
  leadTimeMinutes: 120,
}

/** Hour-of-day and weekday for an instant, read in the given IANA zone
 * rather than the server's. A slot offered at "3pm" must mean 3pm where the
 * business is, not on whichever host this happens to be running on. */
function zoned(date: Date, timezone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  return { hour, weekday }
}

/** How a slot is written to a customer: their business's timezone, spelled
 * out, because "2026-09-08T14:00:00Z" is not something anyone replies to. */
export function describeSlot(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso))
}

export async function findAvailableSlots(
  workspaceId: string,
  options: AvailabilityOptions = {}
): Promise<AvailabilityResult> {
  const opts = { ...DEFAULTS, ...options }

  const { live, row } = await resolveActiveConnection(workspaceId, "google-calendar")
  if (!live) {
    return { ok: false, slots: [], timezone: "UTC", reason: "Google Calendar is not connected and activated for this workspace." }
  }

  const { value: accessToken } = resolveCredentialValue(row, "accessToken", "google-calendar")
  if (!accessToken) {
    return { ok: false, slots: [], timezone: "UTC", reason: "No Google access token on file - reconnect Google in Integrations." }
  }

  const calendarId = row?.config?.calendarId
  if (typeof calendarId !== "string") {
    return { ok: false, slots: [], timezone: "UTC", reason: "No calendar selected for this workspace - choose one in Integrations." }
  }
  const timezone = typeof row?.config?.timezone === "string" ? row.config.timezone : "UTC"

  const now = Date.now()
  const from = new Date(now + opts.leadTimeMinutes * 60_000)
  const to = new Date(now + opts.days * 24 * 60 * 60_000)

  const busyResult = await checkFreeBusy(accessToken, calendarId, from.toISOString(), to.toISOString())
  if (!busyResult.ok) {
    // A calendar we cannot read is a calendar we cannot promise time on.
    return { ok: false, slots: [], timezone, reason: busyResult.error ?? "Could not read the calendar's availability." }
  }

  const busy = (busyResult.busy ?? []).map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }))

  const durationMs = opts.durationMinutes * 60_000
  const slots: string[] = []

  // Walk forward on the hour. Half-hour granularity would offer more, but
  // whole hours are what people actually say out loud on WhatsApp.
  const cursor = new Date(from)
  cursor.setUTCMinutes(0, 0, 0)
  cursor.setUTCHours(cursor.getUTCHours() + 1)

  while (cursor.getTime() < to.getTime() && slots.length < opts.count) {
    const start = cursor.getTime()
    const end = start + durationMs
    const { hour, weekday } = zoned(cursor, timezone)

    const withinHours = hour >= opts.startHour && hour + opts.durationMinutes / 60 <= opts.endHour
    const isWeekend = weekday === "Sat" || weekday === "Sun"
    const overlapsBusy = busy.some((b) => start < b.end && end > b.start)

    if (withinHours && !isWeekend && !overlapsBusy) slots.push(new Date(start).toISOString())

    cursor.setUTCHours(cursor.getUTCHours() + 1)
  }

  if (slots.length === 0) {
    return { ok: true, slots, timezone, reason: "No free slots in the next few working days." }
  }
  return { ok: true, slots, timezone }
}
