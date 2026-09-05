import { eq, sql } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { workspaceWhatsappFeatures } from "@/lib/db/schema"
import {
  CLIENT_FEATURES,
  DEFAULT_ENABLED_KEYS,
  FEATURE_BY_KEY,
  WHATSAPP_FEATURES,
  featureForRoute,
  type EngineRequirement,
  type WhatsAppFeature,
} from "./feature-catalog"

/**
 * Which WhatsApp capabilities a workspace actually has, and the gate that
 * enforces it.
 *
 * Two rules this module exists to guarantee:
 *
 *  1. **Disabling a feature removes the capability, not just its button.**
 *     Every outbound gateway call goes through `assertRouteAllowed`, so a
 *     client who disables "Bulk campaigns" cannot reach the bulk endpoint by
 *     any route - a crafted API request included.
 *
 *  2. **Entitlements are set by EasyLife, not by the client.** Reading them is
 *     workspace-scoped and open to the workspace; WRITING them is an EasyLife
 *     platform-operator action (see the admin route), so a client cannot
 *     grant themselves a capability their plan doesn't include.
 */

export type WhatsAppEngine = "baileys" | "whatsapp-web"

export interface WorkspaceFeatureState {
  enabledKeys: string[]
  engine: WhatsAppEngine
  /** True when no admin has ever saved a choice, so these are catalogue
   * defaults rather than a deliberate configuration. The admin screen says
   * so, instead of implying someone chose this. */
  usingDefaults: boolean
  updatedAt: string | null
}

function engineSatisfies(required: EngineRequirement, engine: WhatsAppEngine): boolean {
  return required === "any" || required === engine
}

/** Reads a workspace's entitlements, falling back to catalogue defaults when
 * nothing has been configured. Never throws on a missing row. */
export async function getWorkspaceFeatures(workspaceId: string): Promise<WorkspaceFeatureState> {
  const row = await withDb(async (db) => {
    const rows = await db
      .select()
      .from(workspaceWhatsappFeatures)
      .where(eq(workspaceWhatsappFeatures.workspaceId, workspaceId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!row) {
    return { enabledKeys: [...DEFAULT_ENABLED_KEYS], engine: "baileys", usingDefaults: true, updatedAt: null }
  }

  // Keys are filtered against the live catalogue on READ as well as on write:
  // a capability removed from the code must stop working immediately, even if
  // a stale row still lists it.
  return {
    enabledKeys: row.enabledKeys.filter((k) => FEATURE_BY_KEY.has(k)),
    engine: (row.engine as WhatsAppEngine) ?? "baileys",
    usingDefaults: false,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

export type SaveFeaturesResult =
  | { ok: true; state: WorkspaceFeatureState }
  | { ok: false; error: string }

/**
 * Replaces a workspace's entitlements. Rejects unknown keys and capabilities
 * the chosen engine cannot perform, rather than storing something that would
 * fail confusingly at the gateway later.
 */
export async function saveWorkspaceFeatures(
  workspaceId: string,
  keys: string[],
  engine: WhatsAppEngine,
  actorUserId: string | null
): Promise<SaveFeaturesResult> {
  const unique = [...new Set(keys)]

  const unknown = unique.filter((k) => !FEATURE_BY_KEY.has(k))
  if (unknown.length) {
    return { ok: false, error: `Unknown feature${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` }
  }

  const wrongEngine = unique
    .map((k) => FEATURE_BY_KEY.get(k)!)
    .filter((f) => !engineSatisfies(f.engine, engine))
  if (wrongEngine.length) {
    return {
      ok: false,
      error: `${wrongEngine.map((f) => f.label).join(", ")} ${
        wrongEngine.length > 1 ? "are" : "is"
      } not available on the ${engine === "baileys" ? "Baileys" : "WhatsApp Web"} engine.`,
    }
  }

  await withDb(async (db) => {
    await db
      .insert(workspaceWhatsappFeatures)
      .values({ workspaceId, enabledKeys: unique, engine, updatedBy: actorUserId })
      .onConflictDoUpdate({
        target: workspaceWhatsappFeatures.workspaceId,
        set: {
          enabledKeys: unique,
          engine,
          updatedBy: actorUserId,
          updatedAt: sql`now()`,
        },
      })
  })

  return { ok: true, state: await getWorkspaceFeatures(workspaceId) }
}

export interface FeatureView extends WhatsAppFeature {
  enabled: boolean
  /** False when the workspace's engine cannot perform this capability - the
   * admin screen shows it disabled with the reason rather than hiding it,
   * so the limitation is visible rather than mysterious. */
  availableOnEngine: boolean
}

/** The admin screen's data: every client-visible capability with its current
 * state. Platform-only capabilities are excluded unless explicitly asked for. */
export function buildFeatureViews(state: WorkspaceFeatureState, includePlatform = false): FeatureView[] {
  const enabled = new Set(state.enabledKeys)
  const source = includePlatform ? WHATSAPP_FEATURES : CLIENT_FEATURES
  return source.map((f) => ({
    ...f,
    enabled: enabled.has(f.key),
    availableOnEngine: engineSatisfies(f.engine, state.engine),
  }))
}

export type RouteGateResult = { allowed: true } | { allowed: false; reason: string }

/**
 * The gate. Every gateway request passes through here first.
 *
 * Fails CLOSED in both directions: a route no catalogue feature claims is
 * refused (so a new gateway endpoint cannot be reached until it is
 * deliberately catalogued), and a catalogued route whose feature is off is
 * refused with the feature's own name, which is what an operator needs to
 * see in a log.
 */
export function checkRouteAllowed(state: WorkspaceFeatureState, route: string): RouteGateResult {
  const feature = featureForRoute(route)
  if (!feature) {
    return { allowed: false, reason: `No EasyLife capability covers ${route}.` }
  }
  if (!state.enabledKeys.includes(feature.key)) {
    return { allowed: false, reason: `"${feature.label}" is not enabled for this workspace.` }
  }
  if (!engineSatisfies(feature.engine, state.engine)) {
    return { allowed: false, reason: `"${feature.label}" is not available on this workspace's WhatsApp engine.` }
  }
  return { allowed: true }
}

/** Convenience for call sites that want a boolean. */
export function hasFeature(state: WorkspaceFeatureState, key: string): boolean {
  const feature = FEATURE_BY_KEY.get(key)
  if (!feature) return false
  return state.enabledKeys.includes(key) && engineSatisfies(feature.engine, state.engine)
}
