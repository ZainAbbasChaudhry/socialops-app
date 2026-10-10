/** True when `error` (or anything in its cause chain) is a Postgres unique violation.
 * withDb() wraps the driver error as DatabaseUnavailableError -> Drizzle error -> pg error,
 * so the SQLSTATE / message is not on the outer error. */
export function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error
  for (let i = 0; i < 6 && e; i++) {
    if ((e as { code?: unknown }).code === "23505") return true
    if (e instanceof Error && /duplicate key value|unique constraint/i.test(e.message)) return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

/** withDb() wraps every failure - a real connection drop, a pool checkout
 * timeout, or an ordinary query error (bad SQL, constraint violation) -
 * behind the same generic "Database is currently unavailable" message, so
 * logging error.message alone (as every catch block around the app already
 * does) throws away the one thing that would tell a real connection-pool
 * exhaustion apart from an unrelated query bug. This walks the cause chain
 * (DatabaseUnavailableError -> Drizzle error -> pg driver error) and returns
 * a short "message/code" summary from the innermost identifiable layer, safe
 * to put in stderr.log (never includes the connection string). */
export function causeChainSummary(error: unknown, maxDepth = 6): string {
  const parts: string[] = []
  let e: unknown = error
  for (let i = 0; i < maxDepth && e; i++) {
    if (e instanceof Error) {
      const code = (e as { code?: unknown }).code
      parts.push(code ? `${e.name}: ${e.message} (code=${code})` : `${e.name}: ${e.message}`)
    }
    e = e instanceof Error ? (e as { cause?: unknown }).cause : undefined
  }
  return parts.length > 0 ? parts.join(" <- caused by <- ") : "no Error in cause chain"
}
