/**
 * Pure data, no server-only imports - shared between the real sync logic
 * (src/lib/integrations/google-sheets/sync.ts) and the client-side column
 * mapping UI, which can't import sync.ts directly since it pulls in
 * server-only modules (DB client, leads repository) that can't reach the
 * browser bundle.
 */
export const SHEET_FIELD_KEYS = [
  "name",
  "phone",
  "email",
  "company",
  "service",
  "source",
  "lead_score",
  "status",
  "next_action",
  "updated_at",
  "meeting_time",
  "meeting_link",
  "last_interaction",
] as const
export type SheetFieldKey = (typeof SHEET_FIELD_KEYS)[number]

export const DEFAULT_COLUMN_MAPPING: Record<SheetFieldKey, string> = {
  name: "A",
  phone: "B",
  email: "C",
  company: "D",
  service: "E",
  source: "F",
  lead_score: "G",
  status: "H",
  next_action: "I",
  updated_at: "J",
  // Appended after the original ten, never inserted among them: an
  // existing sheet already has data under A-J, and shifting a column would
  // silently rewrite a client's spreadsheet.
  meeting_time: "K",
  meeting_link: "L",
  last_interaction: "M",
}

export const SHEET_FIELD_LABELS: Record<SheetFieldKey, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  company: "Company",
  service: "Service interested",
  source: "Source",
  lead_score: "Lead score",
  status: "Status",
  next_action: "Next follow-up",
  updated_at: "Last updated",
  meeting_time: "Meeting booked for",
  meeting_link: "Meeting link",
  last_interaction: "Last interaction",
}

/** Only "name" is required - every other field can be left out of a
 * workspace's saved mapping to skip writing it to the sheet at all. */
export const REQUIRED_SHEET_FIELDS: readonly SheetFieldKey[] = ["name"]
