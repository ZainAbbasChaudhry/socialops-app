/** How long a customer's message can sit unanswered before the dashboard
 * flags it. A single constant for now, same level of configurability as
 * SESSION_WINDOW_HOURS in session-window.ts - a workspace-level setting is
 * a reasonable next step, not something this needs on day one. */
export const SLA_THRESHOLD_MINUTES = 15

export interface SlaStatus {
  /** True when the customer's last message is newer than any reply this
   * conversation has sent back - i.e. nothing has answered it yet. */
  awaitingReply: boolean
  minutesWaiting: number | null
  breached: boolean
}

/** Comparing the two timestamps (both already tracked on the conversation
 * row) tells us "waiting on a reply" without re-reading the full message
 * thread - important since this runs once per row on the conversation
 * list, not just for the one open conversation. */
export function computeSlaStatus(
  lastInboundMessageAt: Date | null,
  lastOutboundMessageAt: Date | null,
  now: Date = new Date()
): SlaStatus {
  if (!lastInboundMessageAt) return { awaitingReply: false, minutesWaiting: null, breached: false }

  const awaitingReply = !lastOutboundMessageAt || lastInboundMessageAt.getTime() > lastOutboundMessageAt.getTime()
  if (!awaitingReply) return { awaitingReply: false, minutesWaiting: null, breached: false }

  const minutesWaiting = Math.max(0, Math.floor((now.getTime() - lastInboundMessageAt.getTime()) / 60000))
  return { awaitingReply: true, minutesWaiting, breached: minutesWaiting >= SLA_THRESHOLD_MINUTES }
}
