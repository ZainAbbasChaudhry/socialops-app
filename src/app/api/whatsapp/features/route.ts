import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/guard"
import { verifySameOrigin } from "@/lib/auth/csrf"
import { isPlatformAdmin, isPlatformAdminConfigured } from "@/lib/auth/platform-admin"
import { apiError } from "@/lib/api/errors"
import { recordAuditEvent } from "@/lib/integrations/repository"
import {
  buildFeatureViews,
  getWorkspaceFeatures,
  saveWorkspaceFeatures,
} from "@/lib/integrations/whatsapp/feature-access"
import { FEATURE_CATEGORIES } from "@/lib/integrations/whatsapp/feature-catalog"

/**
 * WhatsApp capability entitlements for a workspace.
 *
 * READ is open to any member of the workspace: a client's team is entitled to
 * see what their plan includes, and the connection screen needs it to decide
 * which options to render.
 *
 * WRITE is restricted to EasyLife platform operators. A client's own owner
 * must not be able to switch on a capability EasyLife hasn't sold them - so
 * the write gate is the platform allowlist, not a workspace role.
 */

export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const platformAdmin = isPlatformAdmin(auth.ctx)
    const state = await getWorkspaceFeatures(auth.ctx.workspaceId)

    return NextResponse.json({
      workspace: { id: auth.ctx.workspaceId, name: auth.ctx.workspaceName },
      engine: state.engine,
      usingDefaults: state.usingDefaults,
      updatedAt: state.updatedAt,
      categories: FEATURE_CATEGORIES,
      // Platform-only capabilities are included only for a platform operator;
      // a client's screen never advertises controls they cannot have.
      features: buildFeatureViews(state, platformAdmin),
      canEdit: platformAdmin,
      platformAdminConfigured: isPlatformAdminConfigured(),
    })
  } catch (error) {
    return apiError(error, "Failed to load WhatsApp features")
  }
}

const putSchema = z.object({
  enabledKeys: z.array(z.string().min(1).max(64)).max(200),
  engine: z.enum(["baileys", "whatsapp-web"]),
})

export async function PUT(request: Request) {
  const originCheck = verifySameOrigin(request)
  if (originCheck) return originCheck

  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    if (!isPlatformAdmin(auth.ctx)) {
      // Deliberately the same answer whether the caller is a workspace owner
      // or platform administration simply isn't configured - neither should
      // be able to probe the difference.
      return NextResponse.json(
        { error: "Only an EasyLife platform administrator can change WhatsApp entitlements." },
        { status: 403 }
      )
    }

    const body = putSchema.parse(await request.json())
    const result = await saveWorkspaceFeatures(
      auth.ctx.workspaceId,
      body.enabledKeys,
      body.engine,
      auth.ctx.userId
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

    // Entitlement changes are exactly the kind of thing that needs a trail:
    // keys only, never anything secret.
    await recordAuditEvent(auth.ctx.workspaceId, "openwa", "features_updated", auth.ctx.userId, {
      engine: body.engine,
      enabledCount: result.state.enabledKeys.length,
    })

    return NextResponse.json({
      engine: result.state.engine,
      usingDefaults: result.state.usingDefaults,
      updatedAt: result.state.updatedAt,
      features: buildFeatureViews(result.state, true),
    })
  } catch (error) {
    return apiError(error, "Failed to save WhatsApp features")
  }
}
