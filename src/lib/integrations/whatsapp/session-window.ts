/** WhatsApp Cloud API's "customer service window": a business can send
 * free-form text only within 24 hours of the customer's last message; after
 * that, only pre-approved template (HSM) messages go through. This isn't a
 * UI nicety - it's an actual send-time constraint - so both the UI (to warn
 * before the agent types a doomed reply) and, longer term, the send
 * endpoint itself should check it. See
 * https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages#customer-service-window
 */
export const SESSION_WINDOW_HOURS = 24

export interface SessionWindowState {
  open: boolean
  /** ISO timestamp the window closes (or closed), or null if no inbound
   * message has ever been recorded for this conversation. */
  expiresAt: string | null
}

export function computeSessionWindow(lastInboundMessageAt: Date | null, now: Date = new Date()): SessionWindowState {
  if (!lastInboundMessageAt) return { open: false, expiresAt: null }
  const expiresAt = new Date(lastInboundMessageAt.getTime() + SESSION_WINDOW_HOURS * 60 * 60 * 1000)
  return { open: expiresAt.getTime() > now.getTime(), expiresAt: expiresAt.toISOString() }
}
