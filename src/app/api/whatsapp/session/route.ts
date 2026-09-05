import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { apiError } from "@/lib/api/errors"
import {
  ensureOpenWaAccount,
  updateAccountConnection,
} from "@/lib/integrations/whatsapp/repository"
import {
  deriveSessionId,
  resolveOpenWaConfig,
} from "@/lib/integrations/whatsapp/transport"
import { getSessionState, startSession, logoutSession } from "@/lib/integrations/whatsapp/openwa-client"

/**
 * WhatsApp session control for the OpenWA (Baileys NOWEB) transport:
 * pair a phone by QR, read live connection state, and log out.
 *
 * The session id is NEVER accepted from the request. It is derived
 * server-side from the authenticated workspace (see `deriveSessionId`), so
 * a client cannot address, inspect, or tear down another workspace's
 * WhatsApp session by supplying its id - the id in the request is simply
 * ignored because there is no parameter for one.
 *
 * Nothing here ever reports "connected" on its own authority. Status is
 * whatever the gateway last said, mirrored into `whatsapp_accounts` so the
 * dashboard has something to show when the gateway is briefly unreachable -
 * and in that case the response says the state is stale rather than
 * pretending the pairing is live.
 */

interface SessionView {
  accountId: string
  status: "disconnected" | "connecting" | "qr" | "connected" | "error"
  qr: string | null
  connectedNumber: string | null
  lastError: string | null
  /** True when the gateway couldn't be reached and this is the last state
   * recorded in the database rather than a live reading. */
  stale: boolean
}

/** GET - current session state, refreshed from the gateway when possible. */
export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const { workspaceId } = auth.ctx
    const sessionId = deriveSessionId(workspaceId)
    const account = await ensureOpenWaAccount(workspaceId, sessionId, null)

    const config = await resolveOpenWaConfig(workspaceId)
    if (!config) {
      return NextResponse.json({
        configured: false,
        message: "Add your OpenWA gateway URL and API key in Integrations first.",
      })
    }

    const state = await getSessionState(config, sessionId)
    if (!state.ok) {
      const view: SessionView = {
        accountId: account.id,
        status: (account.connectionStatus as SessionView["status"]) ?? "disconnected",
        qr: null,
        connectedNumber: account.connectedNumber,
        lastError: state.errorMessage,
        stale: true,
      }
      return NextResponse.json({ configured: true, session: view })
    }

    await updateAccountConnection(workspaceId, account.id, {
      connectionStatus: state.data.status,
      connectedNumber: state.data.connectedNumber,
      lastError: state.data.lastError,
      ...(state.data.status === "connected" ? { lastConnectedAt: new Date() } : {}),
    })

    const view: SessionView = {
      accountId: account.id,
      status: state.data.status,
      // The QR is a short-lived pairing credential: it is passed straight
      // through to the browser that asked for it and never written to the
      // database or a log.
      qr: state.data.qr,
      connectedNumber: state.data.connectedNumber,
      lastError: state.data.lastError,
      stale: false,
    }
    return NextResponse.json({ configured: true, session: view })
  } catch (error) {
    return apiError(error, "Failed to read the WhatsApp session")
  }
}

/** POST - bring the session up (idempotent; returns the pairing QR if one
 * is pending). Restricted to workspace administrators: pairing a phone
 * changes what the whole workspace's automation sends from. */
export async function POST() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden

    const { workspaceId } = auth.ctx
    const sessionId = deriveSessionId(workspaceId)
    const account = await ensureOpenWaAccount(workspaceId, sessionId, null)

    const config = await resolveOpenWaConfig(workspaceId)
    if (!config) {
      return NextResponse.json(
        { error: "OpenWA gateway isn't configured for this workspace yet." },
        { status: 400 }
      )
    }

    const started = await startSession(config, sessionId)
    if (!started.ok) {
      await updateAccountConnection(workspaceId, account.id, {
        connectionStatus: "error",
        lastError: started.errorMessage,
      })
      return NextResponse.json({ error: started.errorMessage }, { status: 502 })
    }

    await updateAccountConnection(workspaceId, account.id, {
      connectionStatus: started.data.status,
      connectedNumber: started.data.connectedNumber,
      lastError: started.data.lastError,
      ...(started.data.status === "connected" ? { lastConnectedAt: new Date() } : {}),
    })

    const view: SessionView = {
      accountId: account.id,
      status: started.data.status,
      qr: started.data.qr,
      connectedNumber: started.data.connectedNumber,
      lastError: started.data.lastError,
      stale: false,
    }
    return NextResponse.json({ session: view })
  } catch (error) {
    return apiError(error, "Failed to start the WhatsApp session")
  }
}

/** DELETE - log the session out. This clears the pairing on the gateway,
 * so reconnecting needs a fresh QR scan. Conversation history is untouched. */
export async function DELETE() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const forbidden = requireRole(auth.ctx, ["owner", "admin"])
    if (forbidden) return forbidden

    const { workspaceId } = auth.ctx
    const sessionId = deriveSessionId(workspaceId)
    const account = await ensureOpenWaAccount(workspaceId, sessionId, null)

    const config = await resolveOpenWaConfig(workspaceId)
    if (!config) {
      return NextResponse.json({ error: "OpenWA gateway isn't configured for this workspace." }, { status: 400 })
    }

    const result = await logoutSession(config, sessionId)
    if (!result.ok) {
      return NextResponse.json({ error: result.errorMessage }, { status: 502 })
    }

    await updateAccountConnection(workspaceId, account.id, {
      connectionStatus: "disconnected",
      connectedNumber: null,
      lastDisconnectedAt: new Date(),
      lastError: null,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, "Failed to disconnect the WhatsApp session")
  }
}
