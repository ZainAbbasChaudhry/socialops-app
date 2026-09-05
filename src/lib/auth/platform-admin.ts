import type { AuthContext } from "@/lib/auth/guard"

/**
 * Who counts as an EasyLife platform operator.
 *
 * This is deliberately NOT a workspace role. Workspace roles (owner, admin,
 * manager, sales) describe a CLIENT's own team - a client's owner is the top
 * of their workspace and must still not be able to grant themselves
 * capabilities their plan doesn't include. Platform operators are EasyLife's
 * own staff, and the boundary between "runs a workspace" and "runs the
 * platform" has to live outside the workspace's own data, or a client could
 * cross it by editing their own team.
 *
 * The allowlist is an environment variable rather than a database table on
 * purpose: it is deployment configuration, it must not be editable from
 * inside the product, and an empty value must fail closed.
 */

/** Comma-separated emails in PLATFORM_ADMIN_EMAILS. Compared case-insensitively
 * and trimmed, because that env var will be edited by hand in a cPanel form. */
function allowlist(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** Fails closed: with no allowlist configured, nobody is a platform operator,
 * so an unconfigured deployment cannot accidentally expose platform controls
 * to every workspace owner. */
export function isPlatformAdmin(ctx: AuthContext): boolean {
  const allowed = allowlist()
  if (allowed.length === 0) return false
  return allowed.includes(ctx.userEmail.trim().toLowerCase())
}

/** True when platform administration is configured at all - lets the UI say
 * "not configured on this deployment" instead of "permission denied", which
 * are very different problems to debug. */
export function isPlatformAdminConfigured(): boolean {
  return allowlist().length > 0
}
