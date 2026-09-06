/**
 * Gmail REST client - the business's own mailbox, used for two things:
 * sending a message as them, and reading back what a customer replied so
 * the conversation lands in the CRM instead of one person's inbox.
 *
 * Same never-throws contract as every other provider adapter here: every
 * failure resolves to `{ ok: false, error }` with a message safe to show,
 * never a raw upstream body and never a token.
 */

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

export interface GmailProfileResult {
  ok: boolean
  emailAddress?: string
  error?: string
}

/** GET /profile - also the connection test: it proves the token works AND
 * tells us which address this workspace will be sending from. */
export async function getGmailProfile(accessToken: string): Promise<GmailProfileResult> {
  try {
    const res = await fetch(`${GMAIL_API_BASE}/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Gmail in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Gmail API returned ${res.status}` }

    const emailAddress = json?.emailAddress as string | undefined
    if (!emailAddress) return { ok: false, error: "Gmail returned no address for this account." }
    return { ok: true, emailAddress }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Gmail API." }
  }
}

/** RFC 2822 in the base64url form Gmail's API expects. Headers are folded
 * onto their own lines and the address fields are used exactly as given -
 * this never invents a From, because Gmail sends as the authorized account
 * regardless and a fabricated one would only be a lie in the headers. */
function encodeMessage(to: string, subject: string, body: string, replyTo?: string): string {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    ...(replyTo ? [`In-Reply-To: ${replyTo}`, `References: ${replyTo}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ]
  const raw = `${headers.join("\r\n")}\r\n\r\n${body}`
  return Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export interface SendEmailResult {
  ok: boolean
  messageId?: string
  threadId?: string
  error?: string
}

/** POST /messages/send. The returned id comes from Gmail's own response -
 * nothing here reports a send that Gmail did not confirm. */
export async function sendGmailMessage(
  accessToken: string,
  input: { to: string; subject: string; body: string; inReplyTo?: string }
): Promise<SendEmailResult> {
  try {
    const res = await fetch(`${GMAIL_API_BASE}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ raw: encodeMessage(input.to, input.subject, input.body, input.inReplyTo) }),
    })
    const json = await res.json().catch(() => null)

    if (res.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Gmail in Integrations." }
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Gmail API returned ${res.status}` }

    const messageId = json?.id as string | undefined
    if (!messageId) return { ok: false, error: "Gmail accepted the request but returned no message id." }
    return { ok: true, messageId, threadId: json?.threadId as string | undefined }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Gmail API." }
  }
}

export interface GmailMessageSummary {
  id: string
  threadId: string
  /** Whether the business sent it or the customer did. Read from the
   * message's own From header, never assumed from which query found it. */
  direction: "inbound" | "outbound"
  from: string
  subject: string
  snippet: string
  sentAt: string
}

export interface ListEmailsResult {
  ok: boolean
  messages?: GmailMessageSummary[]
  error?: string
}

function header(payload: unknown, name: string): string {
  if (!payload || typeof payload !== "object") return ""
  const headers = (payload as { headers?: { name?: string; value?: string }[] }).headers
  if (!Array.isArray(headers)) return ""
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
}

/**
 * Every message exchanged with one address, newest first.
 *
 * Metadata format only: this reads the headers and Gmail's own snippet,
 * never the full body. Logging that a customer emailed about their quote
 * needs the subject and the time, not the contents of their mailbox, and
 * the narrower request is the one worth making.
 */
export async function listEmailsWith(
  accessToken: string,
  address: string,
  selfAddress: string,
  limit = 10
): Promise<ListEmailsResult> {
  try {
    const url = new URL(`${GMAIL_API_BASE}/messages`)
    // Gmail's own query syntax; the address is quoted so a value with
    // spaces or operators in it cannot change the shape of the query.
    url.searchParams.set("q", `{from:"${address}" to:"${address}"}`)
    url.searchParams.set("maxResults", String(Math.min(limit, 25)))

    const listRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const listJson = await listRes.json().catch(() => null)

    if (listRes.status === 401) return { ok: false, error: "Google authorization has expired - reconnect Gmail in Integrations." }
    if (!listRes.ok) return { ok: false, error: listJson?.error?.message ?? `Gmail API returned ${listRes.status}` }

    const ids = Array.isArray(listJson?.messages) ? (listJson.messages as { id: string }[]) : []
    if (ids.length === 0) return { ok: true, messages: [] }

    const messages: GmailMessageSummary[] = []
    for (const { id } of ids) {
      const detailUrl = new URL(`${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}`)
      detailUrl.searchParams.set("format", "metadata")
      for (const name of ["From", "Subject", "Date"]) detailUrl.searchParams.append("metadataHeaders", name)

      const res = await fetch(detailUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const json = await res.json().catch(() => null)
      if (!json) continue

      const from = header(json.payload, "From")
      const internalDate = Number(json.internalDate)
      messages.push({
        id,
        threadId: (json.threadId as string) ?? id,
        direction: from.toLowerCase().includes(selfAddress.toLowerCase()) ? "outbound" : "inbound",
        from,
        subject: header(json.payload, "Subject"),
        snippet: typeof json.snippet === "string" ? json.snippet : "",
        sentAt: Number.isFinite(internalDate) ? new Date(internalDate).toISOString() : new Date().toISOString(),
      })
    }

    messages.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    return { ok: true, messages }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach the Gmail API." }
  }
}
