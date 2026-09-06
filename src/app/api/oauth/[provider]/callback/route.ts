import { NextResponse } from "next/server"
import { isProviderId, type ProviderId } from "@/lib/integrations/providers"
import { getConnection, recordAuditEvent } from "@/lib/integrations/repository"
import { resolveCredentialValue, storeOAuthTokens } from "@/lib/integrations/service"
import { consumeOAuthState, exchangeCodeForToken } from "@/lib/integrations/oauth"
import { autoConfigureProvider } from "@/lib/integrations/auto-configure"
import { upsertSocialAccount } from "@/lib/platform/social-accounts"
import { getCreatorInfo } from "@/lib/integrations/tiktok/client"
import { listMyChannels } from "@/lib/integrations/youtube/client"
import { getMe } from "@/lib/integrations/x/client"
import { getAppOrigin } from "@/lib/app-url"
import { apiError } from "@/lib/api/errors"

/**
 * TikTok, YouTube, and X have no separate "pick which account" step the way
 * Facebook Pages and LinkedIn identities do - the OAuth grant already
 * identifies exactly one account to publish as, so the social_accounts row
 * a client needs to actually target this account from the Composer is
 * created right here, automatically, instead of requiring a manual step
 * that doesn't otherwise exist. Never blocks the OAuth flow itself on
 * failure - a client can still retry discovery via Test Connection.
 */
async function syncDiscoveredSocialAccount(workspaceId: string, provider: ProviderId, connectionId: string, accessToken: string): Promise<void> {
  try {
    if (provider === "tiktok") {
      const result = await getCreatorInfo(accessToken)
      if (!result.ok || !result.creatorUsername) return
      await upsertSocialAccount({
        workspaceId,
        provider: "tiktok",
        integrationConnectionId: connectionId,
        externalAccountId: result.creatorUsername,
        accountName: result.creatorUsername,
        username: result.creatorUsername,
        capabilities: ["publishing"],
      })
    } else if (provider === "youtube") {
      const result = await listMyChannels(accessToken)
      const channel = result.ok ? result.channels?.[0] : undefined
      if (!channel) return
      await upsertSocialAccount({
        workspaceId,
        provider: "youtube",
        integrationConnectionId: connectionId,
        externalAccountId: channel.id,
        accountName: channel.title,
        capabilities: ["publishing"],
      })
    } else if (provider === "x") {
      const result = await getMe(accessToken)
      if (!result.ok || !result.userId) return
      await upsertSocialAccount({
        workspaceId,
        provider: "x",
        integrationConnectionId: connectionId,
        externalAccountId: result.userId,
        accountName: result.username ?? result.userId,
        username: result.username,
        capabilities: ["publishing"],
      })
    }
  } catch (error) {
    console.error(`Post-OAuth account discovery failed for ${provider}:`, error instanceof Error ? error.message : error)
  }
}

/**
 * OAuth callback - the provider redirects the browser here after the user
 * approves (or denies) access. Deliberately resolves the workspace/actor
 * from the previously-persisted, single-use state row rather than the
 * current session, since some browsers drop first-party context across an
 * external redirect hop. A missing/expired/already-used/provider-mismatched
 * state is rejected outright - this is the CSRF protection.
 */
export async function GET(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params
  const url = new URL(request.url)
  const origin = getAppOrigin(request)
  const redirectBase = `${origin}/dashboard/integrations`

  try {
    if (!isProviderId(provider)) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 404 })
    }

    const providerError = url.searchParams.get("error")
    if (providerError) {
      return NextResponse.redirect(`${redirectBase}?oauth=denied&provider=${provider}`)
    }

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    if (!code || !state) {
      return NextResponse.redirect(`${redirectBase}?oauth=invalid&provider=${provider}`)
    }

    const consumed = await consumeOAuthState(state, provider)
    if (!consumed) {
      // Expired, already used, or forged - never proceed.
      return NextResponse.redirect(`${redirectBase}?oauth=invalid&provider=${provider}`)
    }

    const row = await getConnection(consumed.workspaceId, provider)
    const { value: clientId } = resolveCredentialValue(row, "clientId", provider)
    const { value: clientSecret } = resolveCredentialValue(row, "clientSecret", provider)
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${redirectBase}?oauth=not_configured&provider=${provider}`)
    }

    const callbackUrl = `${origin}/api/oauth/${provider}/callback`
    const exchange = await exchangeCodeForToken(provider, code, clientId, clientSecret, callbackUrl, consumed.codeVerifier)

    if (!exchange.ok || !exchange.accessToken) {
      await recordAuditEvent(consumed.workspaceId, provider, "connection_test_failed", consumed.actorUserId, {
        step: "oauth_token_exchange",
      })
      return NextResponse.redirect(`${redirectBase}?oauth=failed&provider=${provider}`)
    }

    await storeOAuthTokens({
      workspaceId: consumed.workspaceId,
      provider,
      actorUserId: consumed.actorUserId,
      accessToken: exchange.accessToken,
      refreshToken: exchange.refreshToken,
      expiresInSeconds: exchange.expiresInSeconds,
    })

    if (provider === "tiktok" || provider === "youtube" || provider === "x") {
      const savedRow = await getConnection(consumed.workspaceId, provider)
      if (savedRow) await syncDiscoveredSocialAccount(consumed.workspaceId, provider, savedRow.id, exchange.accessToken)
    }

    // Everything between "Google said yes" and "this actually does
    // something": the sheet, its columns, the calendar, the Page. The
    // client pressed one button and this is the rest of the setup they
    // would otherwise have had to do themselves.
    //
    // Its outcome never changes whether the connection succeeded - the
    // account IS connected either way - so the redirect only carries
    // whether the integration came out fully active, and the card shows
    // what (if anything) is still outstanding.
    const setup = await autoConfigureProvider(consumed.workspaceId, provider, consumed.actorUserId)

    return NextResponse.redirect(
      `${redirectBase}?oauth=${setup.activated ? "connected" : "connected_partial"}&provider=${provider}`
    )
  } catch (error) {
    console.error("OAuth callback error:", error instanceof Error ? error.message : error)
    return apiError(error, "OAuth callback failed")
  }
}
