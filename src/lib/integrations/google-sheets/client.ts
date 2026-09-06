/**
 * Google Drive/Sheets REST client for spreadsheet discovery - real API
 * calls against the workspace's own OAuth access token, matching the
 * documented endpoints:
 * https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
 * https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get
 *
 * Same never-throws contract as every other provider adapter in this
 * codebase: every failure resolves to `{ok: false, error}` with a safe
 * message, never a raw upstream error or a stack trace.
 */

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets"

export interface SpreadsheetSummary {
  id: string
  name: string
}

export interface ListSpreadsheetsResult {
  ok: boolean
  spreadsheets?: SpreadsheetSummary[]
  error?: string
}

/** Lists spreadsheets visible to the connected Google account - the
 * client picks from this instead of pasting a spreadsheet ID by hand. */
export async function listSpreadsheets(accessToken: string): Promise<ListSpreadsheetsResult> {
  try {
    const url = new URL(DRIVE_FILES_URL)
    url.searchParams.set("q", "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")
    url.searchParams.set("fields", "files(id,name)")
    url.searchParams.set("pageSize", "100")

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Google Drive API returned ${res.status}` }

    const files = Array.isArray(json?.files) ? json.files : []
    return { ok: true, spreadsheets: files.map((f: { id: string; name: string }) => ({ id: f.id, name: f.name })) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Google Drive API." }
  }
}

export interface WorksheetSummary {
  title: string
}

export interface ListWorksheetsResult {
  ok: boolean
  spreadsheetName?: string
  worksheets?: WorksheetSummary[]
  error?: string
}

/** Lists the worksheet tabs inside one specific spreadsheet, once a
 * client has picked which spreadsheet to use. */
export async function listWorksheets(accessToken: string, spreadsheetId: string): Promise<ListWorksheetsResult> {
  try {
    const url = new URL(`${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}`)
    url.searchParams.set("fields", "properties.title,sheets.properties.title")

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Google in Integrations." }
    if (res.status === 404) return { ok: false, error: "That spreadsheet isn't accessible with this Google account anymore." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Google Sheets API returned ${res.status}` }

    const sheets = Array.isArray(json?.sheets) ? json.sheets : []
    return {
      ok: true,
      spreadsheetName: json?.properties?.title,
      worksheets: sheets.map((s: { properties?: { title?: string } }) => ({ title: s.properties?.title ?? "" })).filter((w: WorksheetSummary) => w.title),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Google Sheets API." }
  }
}

/** A1-notation quoting: a sheet/worksheet name needs single quotes around
 * it whenever it contains anything other than letters, digits, or
 * underscores (spaces, punctuation, etc.) - an embedded quote is escaped
 * by doubling it, same rule Sheets itself uses. */
function quoteSheetName(name: string): string {
  if (/^[A-Za-z0-9_]+$/.test(name)) return name
  return `'${name.replace(/'/g, "''")}'`
}

export interface AppendRowResult {
  ok: boolean
  rowNumber?: number
  error?: string
}

/** POST .../values/{range}:append - always lands on the first empty row
 * below any existing data (insertDataOption=INSERT_ROWS), so this never
 * needs to know how many rows already exist. The response's updatedRange
 * (e.g. "Sheet1!A5:J5") is the only way to learn which row was actually
 * written, since Sheets - not this app - decides that. */
export async function appendRow(accessToken: string, spreadsheetId: string, worksheetName: string, values: string[]): Promise<AppendRowResult> {
  try {
    const range = `${quoteSheetName(worksheetName)}!A1`
    const url = new URL(`${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`)
    url.searchParams.set("valueInputOption", "USER_ENTERED")
    url.searchParams.set("insertDataOption", "INSERT_ROWS")

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ values: [values] }),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Google Sheets API returned ${res.status}` }

    // updatedRange looks like "Sheet1!A5:J5" (or "'My Sheet'!A5:J5") - the
    // row number is the trailing digits of the last cell reference.
    const updatedRange = json?.updates?.updatedRange as string | undefined
    const lastCell = updatedRange?.split(":").pop()
    const match = lastCell?.match(/(\d+)$/)
    const rowNumber = match ? Number(match[1]) : undefined
    if (!rowNumber) return { ok: false, error: "Row was appended but its row number couldn't be determined." }
    return { ok: true, rowNumber }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Google Sheets API." }
  }
}

export interface UpdateRowResult {
  ok: boolean
  error?: string
}

/** PUT .../values/{range} - overwrites one already-known row (from a
 * prior appendRow's rowNumber), so a lead that's synced before never
 * grows a second row on a later sync. */
export async function updateRow(accessToken: string, spreadsheetId: string, worksheetName: string, rowNumber: number, values: string[]): Promise<UpdateRowResult> {
  try {
    const lastColumn = String.fromCharCode("A".charCodeAt(0) + values.length - 1)
    const range = `${quoteSheetName(worksheetName)}!A${rowNumber}:${lastColumn}${rowNumber}`
    const url = new URL(`${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`)
    url.searchParams.set("valueInputOption", "USER_ENTERED")

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ values: [values] }),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Google Sheets API returned ${res.status}` }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Google Sheets API." }
  }
}

export interface CreateSpreadsheetResult {
  ok: boolean
  spreadsheetId?: string
  worksheetName?: string
  error?: string
}

/**
 * POST /v4/spreadsheets - makes the client's CRM sheet for them.
 *
 * This exists so "connect Google Sheets" can mean exactly that. Asking a
 * business owner to first go to Drive, create a spreadsheet, name a tab,
 * type ten column headings in the right order and then come back and map
 * each one is the technical work the one-click rule is meant to remove.
 *
 * The sheet is created with its header row already written, so the first
 * thing they see when they open it is a table that makes sense rather than
 * a grid of values under A, B, C.
 */
export async function createSpreadsheet(
  accessToken: string,
  title: string,
  worksheetName: string,
  headerRow: string[]
): Promise<CreateSpreadsheetResult> {
  try {
    const res = await fetch(SHEETS_BASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        properties: { title },
        sheets: [{ properties: { title: worksheetName } }],
      }),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Google in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Google Sheets API returned ${res.status}` }

    const spreadsheetId = json?.spreadsheetId as string | undefined
    if (!spreadsheetId) return { ok: false, error: "Google created no spreadsheet id." }

    // The header row is written separately rather than as part of creation:
    // if this fails the sheet still exists and is usable, and the failure
    // is reported honestly instead of leaving a half-made sheet behind a
    // success message.
    const header = await appendRow(accessToken, spreadsheetId, worksheetName, headerRow)
    if (!header.ok) return { ok: true, spreadsheetId, worksheetName, error: header.error }

    return { ok: true, spreadsheetId, worksheetName }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Google Sheets API." }
  }
}
