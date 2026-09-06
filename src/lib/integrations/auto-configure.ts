import { PROVIDER_REGISTRY, type ProviderId } from "./providers"
import { getConnection, upsertConnection, recordTestResult } from "./repository"
import { resolveCredentialValue } from "./credential-resolution"
import { listCalendars } from "./google-calendar/client"
import { createSpreadsheet, listSpreadsheets, listWorksheets } from "./google-sheets/client"
import { getGoogleSheetsSelection, saveGoogleSheetsSelection } from "@/lib/platform/google-sheets-selection"
import { DEFAULT_COLUMN_MAPPING, SHEET_FIELD_KEYS, SHEET_FIELD_LABELS } from "./google-sheets/fields"
import { listFacebookPages, subscribePageToWebhooks } from "./facebook/client"
import { getLinkedInstagramAccount } from "./instagram/client"
import { upsertSocialAccount } from "@/lib/platform/social-accounts"
import { encryptSecret } from "./crypto"
import { testProviderConnection } from "./test-connection"

/**
 * Everything that used to be the client's homework, done for them the
 * moment they finish signing in.
 *
 * The product rule is that connecting an integration should mean pressing
 * one button, so the steps between "Google says yes" and "this actually
 * does something" - choose a spreadsheet, name a tab, map ten columns,
 * choose a calendar, find its timezone, pick the one Facebook Page - have
 * to happen here rather than on a settings screen.
 *
 * Three rules this file keeps to:
 *
 *  - It never overwrites a choice the client already made. A workspace
 *    that has picked its own sheet or calendar is left exactly as it is.
 *  - It never guesses when the answer is genuinely ambiguous. Two Facebook
 *    Pages means the client picks; one means there is nothing to ask.
 *  - It never reports a step it did not complete, and a failure here never
 *    breaks the connection itself - the account is still connected, and
 *    the card says what is still missing.
 */

export interface AutoConfigureResult {
  /** Plain-language, client-facing: "Created the sheet EasyLife CRM - Leads". */
  steps: string[]
  /** True only when the connection test actually passed afterwards. */
  activated: boolean
  /** Why it is not fully active, when that is the case. */
  reason?: string
}

const SHEET_TITLE = "EasyLife CRM - Leads"
const SHEET_TAB = "Leads"

function headerRow(): string[] {
  // Built from the same field list the sync writes from, so the headings
  // can never drift out of step with the columns underneath them.
  const cells: Record<number, string> = {}
  let width = 0
  for (const key of SHEET_FIELD_KEYS) {
    const letter = DEFAULT_COLUMN_MAPPING[key]
    const index = letter.toUpperCase().split("").reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 64), 0) - 1
    cells[index] = SHEET_FIELD_LABELS[key]
    width = Math.max(width, index + 1)
  }
  return Array.from({ length: width }, (_, i) => cells[i] ?? "")
}

async function configureSheets(
  workspaceId: string,
  accessToken: string,
  userId: string | null,
  steps: string[]
): Promise<string | null> {
  const existing = await getGoogleSheetsSelection(workspaceId)
  if (existing) {
    steps.push(`Using your existing sheet "${existing.spreadsheetName ?? existing.spreadsheetId}".`)
    return null
  }

  // A sheet EasyLife made earlier - a client who disconnects and
  // reconnects should land back on their own data, not a second empty
  // spreadsheet beside the one that already has their leads in it.
  const listed = await listSpreadsheets(accessToken)
  const reuse = listed.ok ? listed.spreadsheets?.find((s) => s.name === SHEET_TITLE) : undefined

  if (reuse) {
    const tabs = await listWorksheets(accessToken, reuse.id)
    const worksheetName = tabs.ok
      ? (tabs.worksheets?.find((w) => w.title === SHEET_TAB)?.title ?? tabs.worksheets?.[0]?.title)
      : undefined
    if (!worksheetName) return tabs.error ?? "Could not read that spreadsheet's tabs."
    await saveGoogleSheetsSelection({
      workspaceId,
      spreadsheetId: reuse.id,
      spreadsheetName: reuse.name,
      worksheetName,
      columnMapping: DEFAULT_COLUMN_MAPPING,
      selectedByUserId: userId ?? "",
    })
    steps.push(`Reconnected your existing sheet "${reuse.name}".`)
    return null
  }

  const created = await createSpreadsheet(accessToken, SHEET_TITLE, SHEET_TAB, headerRow())
  if (!created.ok || !created.spreadsheetId) return created.error ?? "Could not create a spreadsheet."

  await saveGoogleSheetsSelection({
    workspaceId,
    spreadsheetId: created.spreadsheetId,
    spreadsheetName: SHEET_TITLE,
    worksheetName: created.worksheetName ?? SHEET_TAB,
    columnMapping: DEFAULT_COLUMN_MAPPING,
    selectedByUserId: userId ?? "",
  })
  steps.push(`Created the sheet "${SHEET_TITLE}" with its columns already set up.`)
  // A header that failed to write is worth saying out loud - the sheet
  // works either way, but the client should know why row 1 is empty.
  return created.error ?? null
}

async function configureCalendar(workspaceId: string, accessToken: string, steps: string[]): Promise<string | null> {
  const row = await getConnection(workspaceId, "google-calendar")
  if (typeof row?.config?.calendarId === "string") {
    steps.push("Using the calendar you already chose.")
    return null
  }

  const listed = await listCalendars(accessToken)
  if (!listed.ok) return listed.error ?? "Could not read your calendars."

  const primary = listed.calendars?.find((c) => c.primary) ?? listed.calendars?.[0]
  if (!primary) return "That Google account has no calendars."

  const timezone = primary.timezone ?? "UTC"
  await upsertConnection({
    workspaceId,
    provider: "google-calendar",
    config: { calendarId: primary.id, calendarName: primary.name, timezone },
  })
  steps.push(`Booking meetings on "${primary.name}" (${timezone}).`)
  return null
}

async function configureFacebookPage(workspaceId: string, accessToken: string, steps: string[]): Promise<string | null> {
  const existing = await getConnection(workspaceId, "facebook")
  if (typeof existing?.config?.pageId === "string") {
    steps.push("Using the Page you already chose.")
    return null
  }

  const listed = await listFacebookPages(accessToken)
  if (!listed.ok) return listed.errorMessage ?? "Could not read your Facebook Pages."

  const pages = listed.pages ?? []
  if (pages.length === 0) return "This Facebook account manages no Pages."
  if (pages.length > 1) {
    // Genuinely ambiguous - guessing which Page a business posts as is
    // exactly the kind of "helpful" decision that publishes to the wrong
    // audience.
    steps.push(`Found ${pages.length} Pages — choose which one to post as.`)
    return null
  }

  const page = pages[0]
  await upsertConnection({
    workspaceId,
    provider: "facebook",
    config: { pageId: page.id, pageName: page.name },
    secretDataEncrypted: { pageAccessToken: encryptSecret(page.accessToken).blob },
  })

  const connection = await getConnection(workspaceId, "facebook")
  await upsertSocialAccount({
    workspaceId,
    provider: "facebook",
    integrationConnectionId: connection?.id ?? null,
    externalAccountId: page.id,
    accountName: page.name,
    capabilities: ["publishing", "comments"],
  })

  // Instagram publishing rides on the Page, so a linked professional
  // account is connected in the same breath rather than as a second
  // "integration" the client has to find.
  const instagram = await getLinkedInstagramAccount(page.id, page.accessToken)
  if (instagram.ok && instagram.igUserId) {
    await upsertSocialAccount({
      workspaceId,
      provider: "instagram",
      integrationConnectionId: connection?.id ?? null,
      externalAccountId: instagram.igUserId,
      accountName: instagram.username ?? instagram.igUserId,
      username: instagram.username,
      avatarUrl: instagram.profilePictureUrl,
      capabilities: ["publishing", "comments"],
    })
    steps.push(`Linked your Instagram account "${instagram.username ?? instagram.igUserId}".`)
  }

  // Real-time comment webhooks, subscribed for them. A failure here does
  // not undo the Page selection - comment ingestion simply has not started
  // yet, and re-saving the Page retries it.
  const subscribed = await subscribePageToWebhooks(page.id, page.accessToken)
  steps.push(`Connected your Page "${page.name}".`)
  if (!subscribed.ok) return "The Page is connected, but live comment updates could not be switched on yet."
  return null
}

/** Every provider that can answer as the CRM's AI. */
const AI_PROVIDERS: ProviderId[] = ["gemini", "openai", "anthropic", "groq", "openrouter", "ollama"]

export function isAiProvider(provider: ProviderId): boolean {
  return AI_PROVIDERS.includes(provider)
}

/**
 * Makes the model the client just connected the one the whole CRM uses -
 * the WhatsApp bot, lead qualification, summaries, the inbox helper.
 *
 * This is the difference between "an AI provider is configured" and "my
 * AI is what EasyLife runs on". Without it a client could connect their
 * own model, see it tested and green, and still watch every reply come
 * from whichever provider happened to sit earlier in a hardcoded list.
 *
 * Exactly one provider carries the flag: it is cleared everywhere else in
 * the same pass, so there is never an ambiguous second default to
 * reconcile later.
 */
export async function makeDefaultAiProvider(workspaceId: string, provider: ProviderId): Promise<void> {
  if (!isAiProvider(provider)) return
  for (const candidate of AI_PROVIDERS) {
    const isChosen = candidate === provider
    const row = await getConnection(workspaceId, candidate)
    // Only touch rows that exist, and only when the flag actually changes -
    // no point rewriting five connection rows to say what they already say.
    if (!row && !isChosen) continue
    if ((row?.config?.aiDefault === true) === isChosen) continue
    await upsertConnection({ workspaceId, provider: candidate, config: { aiDefault: isChosen } })
  }
}

/**
 * Runs straight after a successful authorization. Never throws: a broken
 * step leaves the connection in place and reports what is still missing,
 * because a client who has just signed in successfully must not be shown
 * a failure for something they did not do.
 */
export async function autoConfigureProvider(
  workspaceId: string,
  provider: ProviderId,
  actorUserId: string | null
): Promise<AutoConfigureResult> {
  const steps: string[] = []
  let problem: string | null = null

  try {
    const row = await getConnection(workspaceId, provider)
    const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)

    if (PROVIDER_REGISTRY[provider].requiresOAuth && !accessToken) {
      return { steps, activated: false, reason: "No access token was stored." }
    }

    if (accessToken) {
      if (provider === "google-sheets") problem = await configureSheets(workspaceId, accessToken, actorUserId, steps)
      else if (provider === "google-calendar") problem = await configureCalendar(workspaceId, accessToken, steps)
      else if (provider === "facebook") problem = await configureFacebookPage(workspaceId, accessToken, steps)
    }

    // The only honest evidence that an integration works is the provider
    // answering. Live mode is never set from a successful sign-in alone.
    //
    // The result is RECORDED, not just read: readiness is derived from the
    // stored test outcome, so a test whose result went nowhere left the
    // card saying "Still needed: Successful Test Connection" immediately
    // after a test that had in fact just passed.
    const test = await testProviderConnection(workspaceId, provider)
    await recordTestResult(workspaceId, provider, {
      ok: test.ok,
      status: test.status,
      errorCode: test.ok ? undefined : "test_failed",
      errorMessage: test.ok ? undefined : test.message,
    })
    if (!test.ok) {
      return { steps, activated: false, reason: problem ?? test.message }
    }

    if (isAiProvider(provider)) {
      await makeDefaultAiProvider(workspaceId, provider)
      steps.push("This is now the model EasyLife uses everywhere.")
    }

    steps.push("Checked the connection — it is working.")
    return { steps, activated: true, reason: problem ?? undefined }
  } catch (error) {
    // Swallowed deliberately: the account IS connected, and the card will
    // show what is outstanding. Never the raw error to the client.
    console.error(`Auto-configuration failed for ${provider}:`, error instanceof Error ? error.message : error)
    return { steps, activated: false, reason: "Some setup steps could not be completed automatically." }
  }
}
