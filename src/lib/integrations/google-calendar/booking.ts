import { resolveActiveConnection } from "@/lib/integrations/credential-resolution"
import { resolveCredentialValue } from "@/lib/integrations/service"
import { createEvent, cancelEvent } from "./client"
import { createMeeting, getMeeting, recordCalendarEventResult, updateMeetingStatus, type Meeting } from "@/lib/platform/meetings"

export interface BookMeetingInput {
  workspaceId: string
  leadId?: string | null
  title: string
  description?: string
  startTime: string
  endTime: string
  attendeeEmails: string[]
  assignedToUserId?: string | null
  createdByUserId: string | null
  /** Reminders to set on the event itself. Defaults to a day before and
   * ten minutes before - a meeting nobody is reminded about is a meeting
   * that gets missed, and the client should not have to remember to
   * configure that. */
  reminderMinutes?: number[]
}

export interface BookMeetingResult {
  status: "booked" | "blocked" | "failed"
  meeting?: Meeting
  errorMessage?: string
}

/** Real, single entry point for booking a meeting - persists the meeting
 * record first (so it's never lost even if the calendar call fails), then
 * genuinely creates the Google Calendar event and records exactly what
 * Google returned. Never fabricates an event id, URL, or Meet link - a
 * failed calendar creation leaves the meeting recorded with status
 * "failed" and a real error message, not a fake success. */
export async function bookMeeting(input: BookMeetingInput): Promise<BookMeetingResult> {
  const { live, row } = await resolveActiveConnection(input.workspaceId, "google-calendar")
  if (!live) return { status: "blocked", errorMessage: "Google Calendar is not connected and activated for this workspace." }

  const { value: accessToken } = resolveCredentialValue(row, "accessToken", "google-calendar")
  if (!accessToken) return { status: "blocked", errorMessage: "No Google access token on file - reconnect Google in Integrations." }

  const calendarId = row?.config?.calendarId
  if (typeof calendarId !== "string") return { status: "blocked", errorMessage: "No calendar selected for this workspace - choose one in Integrations." }
  const timezone = typeof row?.config?.timezone === "string" ? row.config.timezone : "UTC"

  const meeting = await createMeeting({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    title: input.title,
    description: input.description,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone,
    attendeeEmails: input.attendeeEmails,
    assignedToUserId: input.assignedToUserId,
    createdByUserId: input.createdByUserId,
  })

  const result = await createEvent(accessToken, {
    calendarId,
    summary: input.title,
    description: input.description,
    startIso: input.startTime,
    endIso: input.endTime,
    timeZone: timezone,
    attendeeEmails: input.attendeeEmails,
    createMeetLink: true,
    reminderMinutes: input.reminderMinutes ?? [24 * 60, 10],
  })

  if (!result.ok) {
    await recordCalendarEventResult(input.workspaceId, meeting.id, { calendarId, errorMessage: result.errorMessage })
    await updateMeetingStatus(input.workspaceId, meeting.id, "failed")
    return { status: "failed", meeting, errorMessage: result.errorMessage }
  }

  await recordCalendarEventResult(input.workspaceId, meeting.id, {
    calendarId,
    externalEventId: result.eventId,
    eventUrl: result.eventUrl,
    meetLink: result.meetLink,
  })
  const updated = await getMeeting(input.workspaceId, meeting.id)
  return { status: "booked", meeting: updated ?? meeting }
}

export interface CancelMeetingResult {
  status: "cancelled" | "failed"
  errorMessage?: string
}

/** Cancels a meeting - removes the real Google Calendar event if one
 * exists, then marks the meeting record cancelled either way (a meeting
 * that never got a calendar event, e.g. one that was created while
 * blocked, still needs to be cancellable locally). */
export async function cancelMeeting(workspaceId: string, meetingId: string): Promise<CancelMeetingResult> {
  const meeting = await getMeeting(workspaceId, meetingId)
  if (!meeting) return { status: "failed", errorMessage: "Meeting not found." }

  if (meeting.calendarId && meeting.externalEventId) {
    const { row } = await resolveActiveConnection(workspaceId, "google-calendar")
    const { value: accessToken } = resolveCredentialValue(row, "accessToken", "google-calendar")
    if (accessToken) {
      const result = await cancelEvent(accessToken, meeting.calendarId, meeting.externalEventId)
      if (!result.ok) return { status: "failed", errorMessage: result.errorMessage }
    }
  }

  await updateMeetingStatus(workspaceId, meetingId, "cancelled")
  return { status: "cancelled" }
}
