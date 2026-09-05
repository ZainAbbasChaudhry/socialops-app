import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { apiError } from "@/lib/api/errors"
import { ensureOpenWaAccount, setOpenWaSessionId, updateAccountConnection } from "@/lib/integrations/whatsapp/repository"
import { deriveSessionName, resolveOpenWaConfig } from "@/lib/integrations/whatsapp/transport"
import {
  ensureGatewaySession,
  getSessionState,
  getQrCode,
  startSession,
  logoutSession,
  requestPairingCode,
  type GatewayConfig,
  type SessionState,
} from "@/lib/integrations/whatsapp/openwa-client"
import { hasFeature, getWorkspaceFeatures } from "@/lib/integrations/whatsapp/feature-access"

/**
 * WhatsApp connection control for this workspace: link a number by QR or by
 * pairing code, read live status, and unlink.
 *
 * The gateway session is never addressed by anything the browser sends. The
 * session's NAME is derived server-side from the authenticated workspace, the
 * gateway's own session id is stored against that workspace, and both are
 * looked up here - so a client cannot inspect, start or unlink another
 * workspace's WhatsApp number by supplying an id.
 *
 * Nothing reports "connected" on this route's own authority: status is
 * whatever the gateway last said. When the gateway is unreachable the last
 * known state is returned marked `stale`, rather than pretending the pairing
 * is live.
 */

interface SessionView extends SessionState {
  accountId: string
  qr: string | null
  stale: boolean
  /** Which connection methods this workspace is entitled to use, so the UI
   * renders exactly the options the client actually has. */
  methods: { qr: boolean; pairingCode: boolean }
}

/** Resolves (creating if needed) the workspace's gateway session, keeping the
 * gateway's id on the EasyLife account row so inbound webhooks - which carry
 * that id - can be routed back to this workspace. */
async function resolveSession(workspaceId: string) {
  const config = await resolveOpenWaConfig(workspaceId)
  if (!config) return { ok: false as const, error: "Add your WhatsApp gateway URL and API key in Integrations first." }

  const name = deriveSessionName(workspaceId)
  const account = await ensureOpenWaAccount(workspaceId, null)

  // The gateway owns session ids. EasyLife asks for one the first time, then
  // remembers it - so a gateway that is briefly unreachable later doesn't
  // block reading the last known state.
  if (!account.sessionId) {
    const created = await ensureGatewaySession(config, name)
    if (!created.ok) return { ok: false as const, error: created.errorMessage }
    await setOpenWaSessionId(workspaceId, account.id, created.data.sessionId)
    return { ok: true as const, config, accountId: account.id, sessionId: created.data.sessionId, name }
  }

  return { ok: true as const, config, accountId: account.id, sessionId: account.sessionId, name }
}

/**
 * Re-creates the gateway session when the gateway no longer has the one
 * EasyLife remembers.
 *
 * A stored session id outlives the gateway's own state - the gateway's
 * volume is replaced, the container is rebuilt, an operator prunes an idle
 * session - and after that EVERY call for this workspace answers 404
 * "Session not found" with nothing in the product able to clear it. The
 * workspace is then permanently unable to connect, and the error names a
 * gateway fault rather than the recoverable condition it is.
 *
 * Recovery is deliberately narrow: only a 404, only once per request, and
 * the new id is stored before the call is retried.
 */
async function recoverMissingSession(
  workspaceId: string,
  accountId: string,
  config: GatewayConfig,
  name: string
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const created = await ensureGatewaySession(config, name)
  if (!created.ok) return { ok: false, error: created.errorMessage }
  await setOpenWaSessionId(workspaceId, accountId, created.data.sessionId)
  return { ok: true, sessionId: created.data.sessionId }
}

/** True when the gateway is telling us the session id we hold is unknown to
 * it - as opposed to any other failure, which must NOT silently re-pair. */
function isMissingSession(result: { ok: false; status?: number; blocked?: boolean }): boolean {
  return result.blocked !== true && result.status === 404
}

async function buildView(
  workspaceId: string,
  accountId: string,
  state: SessionState,
  qr: string | null,
  stale: boolean
): Promise<SessionView> {
  const features = await getWorkspaceFeatures(workspaceId)
  // Bringing a session up is "Start, stop and reconnect", so neither method
  // is actually usable without it - the UI must not offer a button whose
  // first call the gate would refuse.
  const canStart = hasFeature(features, "connect.session-control")
  return {
    ...state,
    accountId,
    qr,
    stale,
    methods: {
      qr: canStart && hasFeature(features, "connect.qr"),
      pairingCode: canStart && hasFeature(features, "connect.pairing-code"),
    },
  }
}

/** GET - live connection state, with the pairing QR when one is waiting. */
export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const { workspaceId } = auth.ctx

    const resolved = await resolveSession(workspaceId)
    if (!resolved.ok) return NextResponse.json({ configured: false, message: resolved.error })

    let sessionId = resolved.sessionId
    let state = await getSessionState(resolved.config, sessionId)
    if (!state.ok && isMissingSession(state)) {
      const recovered = await recoverMissingSession(workspaceId, resolved.accountId, resolved.config, resolved.name)
      if (recovered.ok) {
        sessionId = recovered.sessionId
        state = await getSessionState(resolved.config, sessionId)
      }
    }
    if (!state.ok) {
      const account = await ensureOpenWaAccount(workspaceId, null)
      const view = await buildView(
        workspaceId,
        resolved.accountId,
        {
          status: (account.connectionStatus as SessionState["status"]) ?? "disconnected",
          connectedNumber: account.connectedNumber,
          lastError: state.errorMessage,
        },
        null,
        true
      )
      return NextResponse.json({ configured: true, session: view })
    }

    // The QR is only meaningful while the gateway is waiting for a scan, and
    // it is a short-lived pairing credential - fetched on demand, passed
    // straight to the browser that asked, never stored or logged.
    let qr: string | null = null
    if (state.data.status === "qr") {
      const code = await getQrCode(resolved.config, sessionId)
      if (code.ok) qr = code.data.qr
    }

    await updateAccountConnection(workspaceId, resolved.accountId, {
      connectionStatus: state.data.status,
      connectedNumber: state.data.connectedNumber,
      displayPhoneNumber: state.data.connectedNumber,
      lastError: state.data.lastError,
      ...(state.data.status === "connected" ? { lastConnectedAt: new Date() } : {}),
    })

    return NextResponse.json({
      configured: true,
      session: await buildView(workspaceId, resolved.accountId, state.data, qr, false),
    })
  } catch (error) {
    return apiError(error, "Failed to read the WhatsApp connection")
  }
}

const postSchema = z.object({
  /** "qr" is the default; "pairing-code" needs the number to link. */
  method: z.enum(["qr", "pairing-code"]).default("qr"),
  phoneNumber: z.string().trim().max(32).optional(),
})

/**
 * POST - bring the connection up.
 *
 * Idempotent: starting an already-connected session returns its state rather
 * than tearing the pairing down. Restricted to workspace administrators,
 * because pairing a phone changes what every automation in the workspace
 * sends from.
 */
export async function POST(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden
    const { workspaceId } = auth.ctx

    const body = postSchema.parse(await request.json().catch(() => ({})))

    const resolved = await resolveSession(workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })

    let sessionId = resolved.sessionId
    let started = await startSession(resolved.config, sessionId)
    if (!started.ok && isMissingSession(started)) {
      const recovered = await recoverMissingSession(workspaceId, resolved.accountId, resolved.config, resolved.name)
      if (recovered.ok) {
        sessionId = recovered.sessionId
        started = await startSession(resolved.config, sessionId)
      }
    }
    if (!started.ok) {
      await updateAccountConnection(workspaceId, resolved.accountId, {
        connectionStatus: "error",
        lastError: started.errorMessage,
      })
      // A capability the admin switched off is a 403, not a gateway failure.
      return NextResponse.json({ error: started.errorMessage }, { status: started.blocked ? 403 : 502 })
    }

    await updateAccountConnection(workspaceId, resolved.accountId, {
      connectionStatus: started.data.status,
      connectedNumber: started.data.connectedNumber,
      lastError: started.data.lastError,
      ...(started.data.status === "connected" ? { lastConnectedAt: new Date() } : {}),
    })

    // Link by code instead of scanning: the client types this into WhatsApp
    // on the phone. Useful for remote setup where nobody can point a camera
    // at the screen.
    if (body.method === "pairing-code") {
      if (!body.phoneNumber) {
        return NextResponse.json({ error: "Enter the WhatsApp number to link, including country code." }, { status: 400 })
      }
      const code = await requestPairingCode(resolved.config, sessionId, body.phoneNumber)
      if (!code.ok) {
        return NextResponse.json({ error: code.errorMessage }, { status: code.blocked ? 403 : 502 })
      }
      return NextResponse.json({
        session: await buildView(workspaceId, resolved.accountId, started.data, null, false),
        pairingCode: code.data.pairingCode,
      })
    }

    let qr: string | null = null
    if (started.data.status === "qr" || started.data.status === "connecting") {
      const code = await getQrCode(resolved.config, sessionId)
      if (code.ok) qr = code.data.qr
    }

    return NextResponse.json({
      session: await buildView(workspaceId, resolved.accountId, started.data, qr, false),
    })
  } catch (error) {
    return apiError(error, "Failed to start the WhatsApp connection")
  }
}

/** DELETE - unlink the number. Clears the pairing on the gateway, so
 * reconnecting needs a fresh scan. Conversation history is kept. */
export async function DELETE(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden
    const { workspaceId } = auth.ctx

    const resolved = await resolveSession(workspaceId)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })

    const result = await logoutSession(resolved.config, resolved.sessionId)
    // A session the gateway has already lost is not a failure to unlink - the
    // number IS unlinked. Recording that locally is the honest outcome;
    // returning 502 would leave the workspace showing a pairing that no
    // longer exists anywhere.
    if (!result.ok && !isMissingSession(result)) {
      return NextResponse.json({ error: result.errorMessage }, { status: result.blocked ? 403 : 502 })
    }

    await updateAccountConnection(workspaceId, resolved.accountId, {
      connectionStatus: "disconnected",
      connectedNumber: null,
      lastDisconnectedAt: new Date(),
      lastError: null,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, "Failed to unlink the WhatsApp number")
  }
}
