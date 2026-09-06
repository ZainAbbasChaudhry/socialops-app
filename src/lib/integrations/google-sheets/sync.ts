import type { Lead } from "@/types"
import { resolveActiveConnection } from "@/lib/integrations/credential-resolution"
import { resolveCredentialValue } from "@/lib/integrations/service"
import { getGoogleSheetsSelection } from "@/lib/platform/google-sheets-selection"
import { getSyncedRow, recordSyncResult } from "@/lib/platform/google-sheets-sync"
import { getLead } from "@/lib/leads/repository"
import { listMeetings, type Meeting } from "@/lib/platform/meetings"
import { appendRow, updateRow } from "./client"
import { SHEET_FIELD_KEYS, DEFAULT_COLUMN_MAPPING, type SheetFieldKey } from "./fields"

/**
 * PostgreSQL stays the source of truth for CRM data - this only mirrors a
 * lead's current state into the workspace's chosen spreadsheet as a
 * secondary, human-browsable export. The available field set is fixed for
 * now (matches what a Lead actually has); columnMapping only controls
 * which spreadsheet column each field lands in, not which fields exist.
 */
export { SHEET_FIELD_KEYS, type SheetFieldKey }

/** The meeting a client would want to see on the row: the next one still
 * scheduled, or failing that the most recent. A meeting Google refused is
 * never shown as if it were booked - it has status "failed" and no start
 * time worth printing, so it is skipped entirely. */
function relevantMeeting(all: Meeting[]): Meeting | null {
  const booked = all.filter((m) => m.status === "scheduled" && m.externalEventId)
  if (booked.length === 0) return null
  const now = Date.now()
  const upcoming = booked
    .filter((m) => new Date(m.startTime).getTime() >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  if (upcoming[0]) return upcoming[0]
  return booked.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0] ?? null
}

function fieldValue(lead: Lead, key: SheetFieldKey, meeting: Meeting | null): string {
  switch (key) {
    case "name":
      return lead.name
    case "phone":
      return lead.whatsappNumber ?? ""
    case "email":
      return lead.email ?? ""
    case "company":
      return lead.company ?? ""
    case "service":
      return lead.qualification.serviceInterested ?? ""
    case "source":
      return lead.source.platform
    case "lead_score":
      return String(lead.score)
    case "status":
      return lead.status
    case "next_action":
      return lead.nextFollowUpAt ?? ""
    case "updated_at":
      return lead.updatedAt
    case "meeting_time":
      // Written in the meeting's own timezone, because a client reading
      // their spreadsheet wants the time they will actually turn up at.
      return meeting
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: meeting.timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(meeting.startTime))
        : ""
    case "meeting_link":
      // Only ever a link the provider actually returned.
      return meeting?.meetLink ?? meeting?.eventUrl ?? ""
    case "last_interaction":
      return lead.lastInteractionAt
  }
}

function columnLetterToIndex(letter: string): number {
  let index = 0
  for (const char of letter.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - "A".charCodeAt(0) + 1)
  }
  return index - 1
}

/** Builds one contiguous row (starting at column A) wide enough to reach
 * the furthest-mapped field, honoring a workspace's custom column
 * ordering/gaps - a field mapped to an unused later column doesn't need
 * every column before it to also be mapped.
 *
 * An empty columnMapping means "never customized" and gets the full
 * default; a non-empty one is used exactly as saved, with no merge - a
 * workspace that has customized mapping and deliberately left a field out
 * (to disable it) would otherwise see it silently reappear from the
 * default merge, which defeats the point of disabling it. */
function buildRowValues(lead: Lead, columnMapping: Record<string, string>, meeting: Meeting | null): string[] {
  const mapping: Record<string, string> = Object.keys(columnMapping).length > 0 ? columnMapping : DEFAULT_COLUMN_MAPPING
  let width = 0
  const cells: Record<number, string> = {}
  for (const key of SHEET_FIELD_KEYS) {
    const letter = mapping[key]
    if (!letter) continue
    const index = columnLetterToIndex(letter)
    if (index < 0) continue
    cells[index] = fieldValue(lead, key, meeting)
    width = Math.max(width, index + 1)
  }
  return Array.from({ length: width }, (_, i) => cells[i] ?? "")
}

export interface SyncLeadResult {
  status: "synced" | "blocked" | "failed"
  errorMessage?: string
}

/** Syncs one lead's current state into the workspace's selected
 * spreadsheet - updates its existing row if it already has one (idempotent:
 * re-syncing the same lead never creates a second row), otherwise appends
 * a new row and remembers where it landed for next time. */
export async function syncLeadToSheet(workspaceId: string, leadId: string): Promise<SyncLeadResult> {
  const { live, row } = await resolveActiveConnection(workspaceId, "google-sheets")
  if (!live) return { status: "blocked", errorMessage: "Google Sheets is not connected and activated for this workspace." }

  const { value: accessToken } = resolveCredentialValue(row, "accessToken", "google-sheets")
  if (!accessToken) return { status: "blocked", errorMessage: "No Google access token on file - reconnect Google in Integrations." }

  const selection = await getGoogleSheetsSelection(workspaceId)
  if (!selection) return { status: "blocked", errorMessage: "No spreadsheet selected for this workspace - choose one in Integrations." }

  const lead = await getLead(workspaceId, leadId)
  if (!lead) return { status: "failed", errorMessage: "Lead not found." }

  const meeting = relevantMeeting(await listMeetings(workspaceId, leadId))
  const values = buildRowValues(lead, selection.columnMapping, meeting)
  const existing = await getSyncedRow(workspaceId, leadId, selection.spreadsheetId, selection.worksheetName)

  if (existing) {
    const result = await updateRow(accessToken, selection.spreadsheetId, selection.worksheetName, existing.rowNumber, values)
    await recordSyncResult({
      workspaceId,
      leadId,
      spreadsheetId: selection.spreadsheetId,
      worksheetName: selection.worksheetName,
      rowNumber: existing.rowNumber,
      status: result.ok ? "synced" : "failed",
      error: result.error,
    })
    if (!result.ok) return { status: "failed", errorMessage: result.error }
    return { status: "synced" }
  }

  const result = await appendRow(accessToken, selection.spreadsheetId, selection.worksheetName, values)
  if (!result.ok || !result.rowNumber) {
    // Deliberately no recordSyncResult here: a failed append never created
    // a row, so there is no rowNumber worth remembering - recording one
    // (even a placeholder) would make the next sync attempt treat this
    // lead as already having a row and try to update a row that doesn't
    // exist. The automation run itself already records this failure.
    return { status: "failed", errorMessage: result.error }
  }

  await recordSyncResult({
    workspaceId,
    leadId,
    spreadsheetId: selection.spreadsheetId,
    worksheetName: selection.worksheetName,
    rowNumber: result.rowNumber,
    status: "synced",
  })
  return { status: "synced" }
}
