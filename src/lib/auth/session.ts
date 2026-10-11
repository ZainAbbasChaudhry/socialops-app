import { randomBytes, randomUUID, createHash } from "node:crypto"
import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import { eq } from "drizzle-orm"
import { withDb } from "@/lib/db/client"
import { sessions } from "@/lib/db/schema"
import { causeChainSummary } from "@/lib/db/errors"

/**
 * Session design: a random secret is generated per session and never stored
 * raw — only its SHA-256 hash goes in `socialops.sessions.token_hash`. The
 * cookie carries a `jose`-signed JWT containing the session id + that raw
 * secret, so the cookie is tamper-evident on its own, AND every request
 * re-checks the secret's hash against the (revocable, expirable) DB row.
 * Revoking a session (logout, password change) takes effect immediately,
 * even though the JWT signature would otherwise still verify until `exp`.
 */

export const SESSION_COOKIE = "el_session"
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000 // 12h
const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000 // 30d

function getAuthSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not configured")
  return new TextEncoder().encode(secret)
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}

export interface CreateSessionInput {
  userId: string
  workspaceId: string | null
  rememberMe?: boolean
  userAgent?: string | null
  ip?: string | null
}

export interface ActiveSession {
  sessionId: string
  userId: string
  workspaceId: string | null
}

/** Creates a DB session record and returns the signed cookie value. */
export async function createSession(input: CreateSessionInput): Promise<{ cookieValue: string; expiresAt: Date }> {
  const sessionId = randomUUID()
  const secret = randomBytes(32).toString("base64url")
  const tokenHash = hashSecret(secret)
  const ttl = input.rememberMe ? REMEMBER_SESSION_MS : SHORT_SESSION_MS
  const expiresAt = new Date(Date.now() + ttl)

  await withDb(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      tokenHash,
      expiresAt,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    })
  })

  const cookieValue = await new SignJWT({ sid: sessionId, sec: secret })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getAuthSecretKey())

  return { cookieValue, expiresAt }
}

/** Verifies the cookie's signature/expiry, then re-checks the underlying DB
 * session is still valid (not revoked, not expired, secret hash matches).
 * Returns null on any failure — callers must treat that as "unauthenticated",
 * never fall back to a default/mock user. */
export async function verifySessionCookie(cookieValue: string | undefined): Promise<ActiveSession | null> {
  if (!cookieValue) return null

  let payload: JWTPayload
  try {
    const result = await jwtVerify(cookieValue, getAuthSecretKey())
    payload = result.payload
  } catch {
    return null
  }

  if (typeof payload.sid !== "string" || typeof payload.sec !== "string") return null

  try {
    return await withDb(async (db) => {
      const rows = await db.select().from(sessions).where(eq(sessions.id, payload.sid as string)).limit(1)
      const session = rows[0]
      if (!session) return null
      if (session.revokedAt) return null
      if (session.expiresAt.getTime() < Date.now()) return null
      if (hashSecret(payload.sec as string) !== session.tokenHash) return null

      // Best-effort liveness update — not worth failing auth over.
      db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id)).catch(() => {})

      return { sessionId: session.id, userId: session.userId, workspaceId: session.workspaceId }
    })
  } catch (error) {
    // Database unavailable — fail closed, never silently treat as authenticated.
    // This used to swallow the error with no trace at all, so a DB blip showed
    // up only as users mysteriously logged out, with nothing in stderr.log to
    // explain why. Log the full cause chain (never the connection string) so
    // a real outage/pool exhaustion is distinguishable from anything else.
    console.error("[auth] verifySessionCookie:", causeChainSummary(error))
    return null
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  await withDb(async (db) => {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))
  })
}

/** Used on password change: invalidate every other active session for this
 * user, keeping only the current one (if provided) alive. */
export async function revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await withDb(async (db) => {
    const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))
    const now = new Date()
    await Promise.all(
      rows
        .filter((r) => r.id !== exceptSessionId)
        .map((r) => db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, r.id)))
    )
  })
}
