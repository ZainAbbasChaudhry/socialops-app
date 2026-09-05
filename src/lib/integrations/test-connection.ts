import { generateWithGemini } from "@/lib/services/gemini-client"
import type { ProviderId } from "./providers"
import { resolveCredentialValue, type TestConnectionResult } from "./service"
import { getConnection } from "./repository"
import { testWhatsAppCredentials } from "./whatsapp/cloud-api"
import { testOpenWaGateway } from "./whatsapp/openwa-client"
import { testOmniDimensionCredentials } from "./omnidimension/client"
import { listFacebookPages } from "./facebook/client"
import { getLinkedInstagramAccount } from "./instagram/client"
import { listSpreadsheets } from "./google-sheets/client"
import { listCalendars } from "./google-calendar/client"
import { getMemberIdentity } from "./linkedin/client"
import { getCreatorInfo } from "./tiktok/client"
import { getMe } from "./x/client"
import { listMyChannels } from "./youtube/client"

/**
 * Provider test-connection dispatcher — the server-side implementation of
 * "Test Connection." Never called from the browser directly against a
 * provider's own API; the browser only ever calls our own
 * POST /api/integrations/[provider]/test, which calls in here.
 *
 * Only providers with a real, verifiable API call get a real test. Every
 * other provider returns an honest "not available yet" result rather than
 * fabricating a connected state — matching Phase 3's explicit requirement
 * to never mark a service connected without evidence.
 */
export async function testProviderConnection(workspaceId: string, provider: ProviderId): Promise<TestConnectionResult> {
  const row = await getConnection(workspaceId, provider)

  switch (provider) {
    case "gemini": {
      const { value: apiKey } = resolveCredentialValue(row, "apiKey", provider)
      if (!apiKey) return { ok: false, status: "not_configured", message: "No API key configured." }

      const result = await generateWithGemini("Reply with exactly the word OK.", "You are a connection test. Reply with exactly OK.", apiKey)
      if (result.ok) return { ok: true, status: "connected", message: "Gemini responded successfully." }
      return { ok: false, status: "error", message: result.reason }
    }

    case "whatsapp": {
      const phoneNumberId = row?.config?.phoneNumberId as string | undefined
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!phoneNumberId || !accessToken) {
        return { ok: false, status: "not_configured", message: "Phone Number ID and access token are both required." }
      }
      return testWhatsAppCredentials(phoneNumberId, accessToken)
    }

    case "openwa": {
      const { value: baseUrl } = resolveCredentialValue(row, "baseUrl", provider)
      const { value: apiKey } = resolveCredentialValue(row, "apiKey", provider)
      if (!baseUrl || !apiKey) {
        return { ok: false, status: "not_configured", message: "Gateway base URL and API key are both required." }
      }
      // Health probe only - deliberately never sends a WhatsApp message and
      // never disturbs a live pairing, so testing is free and safe to repeat.
      return testOpenWaGateway({ baseUrl, apiKey })
    }

    case "omnidimension": {
      const { value: apiKey } = resolveCredentialValue(row, "apiKey", provider)
      const { value: agentId } = resolveCredentialValue(row, "agentId", provider)
      if (!apiKey || !agentId) {
        return { ok: false, status: "not_configured", message: "API key and Agent ID are both required." }
      }
      return testOmniDimensionCredentials(apiKey, agentId)
    }

    case "facebook": {
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!accessToken) return { ok: false, status: "not_configured", message: "Connect your Facebook account first." }
      const result = await listFacebookPages(accessToken)
      if (!result.ok) return { ok: false, status: "error", message: result.errorMessage ?? "Couldn't verify the Facebook connection." }
      const count = result.pages?.length ?? 0
      return { ok: true, status: "connected", message: count > 0 ? `Connected - manages ${count} Page${count === 1 ? "" : "s"}.` : "Connected, but this account doesn't manage any Facebook Pages." }
    }

    case "instagram": {
      // Instagram has no functionally-independent connection of its own -
      // publishing always goes through the linked Facebook Page (see
      // jobs/handlers.ts's publishToInstagram) - so testing it means
      // testing that exact path, not a separate Instagram OAuth grant.
      const fbRow = await getConnection(workspaceId, "facebook")
      if (fbRow?.mode !== "live") return { ok: false, status: "not_configured", message: "Connect Facebook first - Instagram publishing uses your Facebook Page connection." }
      const pageId = fbRow?.config?.pageId
      const { value: pageAccessToken } = resolveCredentialValue(fbRow, "pageAccessToken", "facebook")
      if (typeof pageId !== "string" || !pageAccessToken) {
        return { ok: false, status: "not_configured", message: "Select a Facebook Page in Integrations first." }
      }
      const linked = await getLinkedInstagramAccount(pageId, pageAccessToken)
      if (!linked.ok) return { ok: false, status: "error", message: linked.error ?? "Couldn't verify the Instagram connection." }
      return { ok: true, status: "connected", message: "Connected - this Facebook Page has a linked Instagram professional account." }
    }

    case "google-sheets": {
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!accessToken) return { ok: false, status: "not_configured", message: "Connect your Google account first." }
      const result = await listSpreadsheets(accessToken)
      if (!result.ok) return { ok: false, status: "error", message: result.error ?? "Couldn't verify the Google Sheets connection." }
      return { ok: true, status: "connected", message: `Connected - found ${result.spreadsheets?.length ?? 0} spreadsheet(s).` }
    }

    case "google-calendar": {
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!accessToken) return { ok: false, status: "not_configured", message: "Connect your Google account first." }
      const result = await listCalendars(accessToken)
      if (!result.ok) return { ok: false, status: "error", message: result.error ?? "Couldn't verify the Google Calendar connection." }
      return { ok: true, status: "connected", message: `Connected - found ${result.calendars?.length ?? 0} calendar(s).` }
    }

    case "linkedin": {
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!accessToken) return { ok: false, status: "not_configured", message: "Connect your LinkedIn account first." }
      const result = await getMemberIdentity(accessToken)
      if (!result.ok) return { ok: false, status: "error", message: result.error ?? "Couldn't verify the LinkedIn connection." }
      return { ok: true, status: "connected", message: `Connected as ${result.name ?? "your LinkedIn profile"}. Publishing also requires LinkedIn to approve this app for Community Management API access.` }
    }

    case "tiktok": {
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!accessToken) return { ok: false, status: "not_configured", message: "Connect your TikTok account first." }
      const result = await getCreatorInfo(accessToken)
      if (!result.ok) return { ok: false, status: "error", message: result.errorMessage ?? "Couldn't verify the TikTok connection." }
      return { ok: true, status: "connected", message: `Connected as @${result.creatorUsername ?? "unknown"}. Until this app passes TikTok's audit, publishes stay private-only.` }
    }

    case "x": {
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!accessToken) return { ok: false, status: "not_configured", message: "Connect your X account first." }
      const result = await getMe(accessToken)
      if (!result.ok) return { ok: false, status: "error", message: result.error ?? "Couldn't verify the X connection." }
      return { ok: true, status: "connected", message: `Connected as @${result.username ?? "unknown"}. Posting also requires billing/credits on this app's X developer account.` }
    }

    case "youtube": {
      const { value: accessToken } = resolveCredentialValue(row, "accessToken", provider)
      if (!accessToken) return { ok: false, status: "not_configured", message: "Connect your Google account first." }
      const result = await listMyChannels(accessToken)
      if (!result.ok) return { ok: false, status: "error", message: result.error ?? "Couldn't verify the YouTube connection." }
      const channel = result.channels?.[0]
      return { ok: true, status: "connected", message: channel ? `Connected - uploads go to "${channel.title}".` : "Connected, but no YouTube channel was found on this account." }
    }

    default:
      return {
        ok: false,
        status: row?.status === "disabled" ? "disabled" : "not_configured",
        message: "Connection testing isn't implemented for this provider yet.",
      }
  }
}
