import { ensureOpenWaAccount, setOpenWaSessionId } from "./repository"
import { deriveSessionName, resolveOpenWaConfig } from "./transport"
import { ensureGatewaySession, type GatewayConfig, type GatewayResult } from "./openwa-client"

/**
 * The one place a WhatsApp feature route resolves "which gateway, which
 * session" for the calling workspace.
 *
 * Every capability screen (contacts, groups, labels, campaigns) needs the
 * same three things and gets them the same way, so the guarantees hold
 * everywhere rather than in whichever route remembered them:
 *
 *  - The session id is looked up from the authenticated workspace's own
 *    account row. It is never read from a request body or query string, so
 *    one workspace cannot address another's WhatsApp session.
 *  - Entitlements travel inside `config`, so any call made with it passes the
 *    feature gate. There is no way to build a gateway client that skips it.
 *  - A gateway that has forgotten the session is recovered once, rather than
 *    leaving the workspace permanently stuck on "Session not found".
 */

export interface GatewayContext {
  config: GatewayConfig
  sessionId: string
  accountId: string
  /** The deterministic name EasyLife gives this workspace's session, used to
   * find it again on the gateway after a rebuild. */
  name: string
}

export type GatewayContextResult =
  | { ok: true; ctx: GatewayContext }
  | { ok: false; error: string; status: 400 | 502 }

export async function resolveGatewayContext(workspaceId: string): Promise<GatewayContextResult> {
  const config = await resolveOpenWaConfig(workspaceId)
  if (!config) {
    return {
      ok: false,
      status: 400,
      error: "Add your WhatsApp gateway URL and API key in Integrations first.",
    }
  }

  const name = deriveSessionName(workspaceId)
  const account = await ensureOpenWaAccount(workspaceId, null)

  if (account.sessionId) {
    return { ok: true, ctx: { config, sessionId: account.sessionId, accountId: account.id, name } }
  }

  const created = await ensureGatewaySession(config, name)
  if (!created.ok) return { ok: false, status: 502, error: created.errorMessage }
  await setOpenWaSessionId(workspaceId, account.id, created.data.sessionId)
  return { ok: true, ctx: { config, sessionId: created.data.sessionId, accountId: account.id, name } }
}

/**
 * HTTP status for a failed gateway call.
 *
 * A capability the EasyLife admin switched off is a 403 - the client is not
 * entitled to it - and must never be reported as a gateway fault, because an
 * operator reading the logs would go looking for a broken gateway that is
 * working perfectly.
 */
export function statusForGatewayFailure(result: { blocked?: boolean; status?: number }): number {
  if (result.blocked) return 403
  if (result.status === 404) return 404
  return 502
}

/** Narrow helper so routes can return a gateway result without re-deriving
 * the status rules in each one. */
export function gatewayFailureBody(result: { errorMessage: string; blocked?: boolean }) {
  return { error: result.errorMessage, blocked: result.blocked === true }
}

export type { GatewayResult }
