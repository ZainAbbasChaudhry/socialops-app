import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole } from "@/lib/auth/guard"
import { requireClientMode } from "@/lib/auth/dashboard-mode-guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { isProviderId, PROVIDER_REGISTRY } from "@/lib/integrations/providers"
import { getProviderView, saveConnection, recordConnectionTest } from "@/lib/integrations/service"
import { upsertConnection } from "@/lib/integrations/repository"
import { testProviderConnection } from "@/lib/integrations/test-connection"
import { autoConfigureProvider } from "@/lib/integrations/auto-configure"
import { apiError } from "@/lib/api/errors"

/**
 * The whole of "Integrate", for the providers that are not an OAuth
 * redirect: save what was typed, check it against the real service,
 * configure whatever follows from it, and switch it on.
 *
 * This exists because the old path made the client do the system's job:
 * fill a form, press Save, press Test Connection, read the result, then
 * change a mode dropdown to "live". Four deliberate actions, three of
 * which only ever had one sensible answer.
 *
 * What it does NOT do is loosen the rule underneath: live mode is still
 * only ever reached by a test that actually passed. A key that the
 * provider rejects leaves the connection saved and inactive, with the
 * provider's own message - it is never quietly marked working.
 */

const connectSchema = z.object({
  fields: z.record(z.string(), z.string().max(4000)).default({}),
  displayName: z.string().trim().max(200).optional(),
})

export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const roleCheck = requireRole(auth.ctx, ["owner", "admin"])
    if (roleCheck) return roleCheck
    const modeCheck = await requireClientMode()
    if (modeCheck) return modeCheck

    const { provider } = await ctx.params
    if (!isProviderId(provider)) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 404 })
    }

    const def = PROVIDER_REGISTRY[provider]
    if (def.requiresOAuth) {
      // An OAuth provider is connected by sending the browser to the
      // provider itself; there is nothing here to save on its behalf.
      return NextResponse.json(
        { error: `${def.name} is connected by signing in, not by saving credentials.` },
        { status: 400 }
      )
    }

    const body = connectSchema.parse(await request.json())

    // Same whitelist as the save endpoint: a caller never gets to write an
    // arbitrary key into credential storage.
    const knownKeys = new Set(def.credentialFields.map((f) => f.key))
    for (const key of Object.keys(body.fields)) {
      if (!knownKeys.has(key)) {
        return NextResponse.json({ error: `Unknown credential field: ${key}` }, { status: 400 })
      }
    }

    await saveConnection({
      workspaceId: auth.ctx.workspaceId,
      provider,
      actorUserId: auth.ctx.userId,
      displayName: body.displayName,
      fields: body.fields,
    })

    // Recorded as well as run: readiness is derived from the stored
    // outcome, so a test result that went nowhere would leave the card
    // asking for a test that had just passed.
    const test = await testProviderConnection(auth.ctx.workspaceId, provider)
    await recordConnectionTest(auth.ctx.workspaceId, provider, auth.ctx.userId, test)
    if (!test.ok) {
      // Saved, not activated, and honest about why. The client sees the
      // provider's own words rather than "something went wrong".
      return NextResponse.json(
        { ok: false, message: test.message, provider: await getProviderView(auth.ctx.workspaceId, provider) },
        { status: 200 }
      )
    }

    // Earned: the provider itself answered. Only now does this go live.
    await upsertConnection({ workspaceId: auth.ctx.workspaceId, provider, mode: "live", status: "connected" })

    const setup = await autoConfigureProvider(auth.ctx.workspaceId, provider, auth.ctx.userId)

    return NextResponse.json({
      ok: true,
      message: test.message,
      steps: setup.steps,
      provider: await getProviderView(auth.ctx.workspaceId, provider),
    })
  } catch (error) {
    return apiError(error, "Failed to connect this provider")
  }
}
