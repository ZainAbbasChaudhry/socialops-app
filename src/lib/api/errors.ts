import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { DatabaseUnavailableError } from "@/lib/db/client"
import { causeChainSummary } from "@/lib/db/errors"

/**
 * Standardized safe API error responses — never leak stack traces, SQL,
 * or internal paths to the client. Logs the real error server-side (never
 * secrets: passwords/cookies/tokens/API keys/DATABASE_URL are never passed
 * into this function).
 */
export function apiError(error: unknown, fallbackMessage = "Something went wrong"): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 })
  }
  if (error instanceof DatabaseUnavailableError) {
    // Logging just error.cause.message only shows Drizzle's own wrapper
    // message, not the underlying pg driver error (timeout, refused
    // connection, pool exhaustion, bad credentials, etc.) one level further
    // down — walk the full cause chain so that detail actually reaches
    // stderr.log instead of every DB failure looking identical.
    console.error("Database error:", causeChainSummary(error))
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 })
  }

  console.error(fallbackMessage + ":", error instanceof Error ? error.message : error)
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}
