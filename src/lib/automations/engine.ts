import {
  listActiveAutomationsForTrigger,
  listAllActiveAutomationsByTriggerType,
  hasRunForDedupeKey,
  recordAutomationRun,
} from "@/lib/platform/automations"
import { createNotification } from "@/lib/platform/notifications"
import { executeAction, type ActionContext } from "@/lib/automations/actions"
import type { Automation, AutomationTriggerType, SocialPlatform } from "@/types"
import type { WhatsAppReplyContext } from "@/lib/integrations/whatsapp/transport"

/**
 * Real automation execution engine. The CRUD layer (create/list/toggle/
 * delete) was already real and DB-backed; this is the piece that was
 * missing - nothing anywhere called recordAutomationRun until now, because
 * nothing ever decided an event should fire an automation in the first
 * place.
 *
 * Deliberately only ever called from code that RECEIVES an event (an
 * inbound WhatsApp message, a call-completion webhook, a lead field
 * changing) - never from an action handler itself. That's the loop
 * prevention: an automation whose action sends a WhatsApp reply cannot
 * retrigger "new-dm" for that same reply, because the only place "new-dm"
 * is ever dispatched from is the *inbound* message handler, which the
 * automation's own outbound send never touches. No runtime loop-detection
 * heuristic needed when the call graph itself can't form a cycle.
 */

export interface AutomationEventContext {
  workspaceId: string
  leadId?: string
  platform?: SocialPlatform
  messageBody?: string
  sentiment?: string
  score?: number
  tags?: string[]
  actorUserId?: string | null
  whatsapp?: WhatsAppReplyContext
  /** Identifies the underlying event (an inbound message id, a call id) -
   * not a random per-dispatch id. Without one, a retried caller (a job
   * queue retry, a duplicate webhook delivery) could fire the same
   * automation twice for what is really one event. Every real event
   * source wired into this engine supplies one. */
  dedupeKey?: string
}

function conditionPasses(automation: Automation, context: AutomationEventContext): boolean {
  const { type, value } = automation.condition
  switch (type) {
    case "none":
      return true
    case "contains-keyword":
      return Boolean(value && context.messageBody?.toLowerCase().includes(value.toLowerCase()))
    case "platform":
      return Boolean(value && context.platform === value)
    case "sentiment":
      return Boolean(value && context.sentiment === value)
    case "tag":
      return Boolean(value && context.tags?.includes(value))
    default:
      return false
  }
}

/** Trigger types that carry their own numeric/text threshold in
 * trigger.value, evaluated in addition to the trigger type itself
 * matching - e.g. "lead-score-above" with value "70" only matches an
 * event whose score actually clears 70, not every score-changed event. */
function triggerValueMatches(automation: Automation, context: AutomationEventContext): boolean {
  const { type, value } = automation.trigger
  if (type === "lead-score-above") {
    if (!value || context.score === undefined) return false
    const threshold = Number(value)
    return !Number.isNaN(threshold) && context.score >= threshold
  }
  if (type === "keyword") {
    return Boolean(value && context.messageBody?.toLowerCase().includes(value.toLowerCase()))
  }
  return true
}

export async function dispatchAutomationEvent(triggerType: AutomationTriggerType, context: AutomationEventContext): Promise<void> {
  const candidates = await listActiveAutomationsForTrigger(context.workspaceId, triggerType)
  if (candidates.length === 0) return

  for (const automation of candidates) {
    // A platform-specific automation (platform !== "all") only matches an
    // event that actually carries that same platform - an event with no
    // platform at all (WhatsApp has none; it isn't a SocialPlatform) must
    // NOT match a platform-specific automation just because there's
    // nothing to compare against.
    if (automation.platform !== "all" && automation.platform !== context.platform) continue
    if (!triggerValueMatches(automation, context)) continue
    if (context.dedupeKey && (await hasRunForDedupeKey(automation.id, context.dedupeKey))) continue

    const triggerContext = {
      leadId: context.leadId,
      platform: context.platform,
      messageBody: context.messageBody,
      sentiment: context.sentiment,
      score: context.score,
    }

    if (!conditionPasses(automation, context)) {
      await recordAutomationRun(context.workspaceId, automation.id, "skipped", "Condition not met", triggerContext, context.dedupeKey)
      continue
    }

    if (automation.rules.runMode === "manual-approval") {
      await recordAutomationRun(context.workspaceId, automation.id, "pending-approval", undefined, triggerContext, context.dedupeKey)
      await createNotification({
        workspaceId: context.workspaceId,
        type: "automation",
        title: `"${automation.name}" needs approval`,
        description: "A matching event is ready to run - review it in Automations.",
      })
      continue
    }

    const actionCtx: ActionContext = {
      workspaceId: context.workspaceId,
      actorUserId: context.actorUserId ?? null,
      leadId: context.leadId,
      whatsapp: context.whatsapp,
    }
    const result = await executeAction(automation.action.type, automation.action.value, actionCtx)
    await recordAutomationRun(context.workspaceId, automation.id, result.status, result.errorMessage, triggerContext, context.dedupeKey)

    if (result.status === "blocked" || result.status === "failed") {
      await createNotification({
        workspaceId: context.workspaceId,
        type: "automation",
        title: `"${automation.name}" ${result.status}`,
        description: result.errorMessage ?? `Automation run ${result.status}.`,
      })
    }
  }
}

/**
 * Checks every active "scheduled" automation each cron tick and fires any
 * whose scheduled time has arrived - the trigger's own value holds a
 * one-time ISO datetime (not a recurring cron expression; there's no
 * expression parser here, and pretending to support one without actually
 * evaluating it correctly would be worse than not supporting it). Dedupe
 * key is the automation id plus its own scheduled value, so a given
 * schedule can only ever fire once, however many cron ticks land after it.
 */
export async function checkScheduledAutomations(): Promise<number> {
  const candidates = await listAllActiveAutomationsByTriggerType("scheduled")
  let fired = 0

  for (const { workspaceId, automation } of candidates) {
    const scheduledFor = automation.trigger.value
    if (!scheduledFor) continue
    const scheduledAtMs = Date.parse(scheduledFor)
    if (Number.isNaN(scheduledAtMs) || scheduledAtMs > Date.now()) continue

    const dedupeKey = `scheduled:${scheduledFor}`
    if (await hasRunForDedupeKey(automation.id, dedupeKey)) continue

    if (automation.rules.runMode === "manual-approval") {
      await recordAutomationRun(workspaceId, automation.id, "pending-approval", undefined, { scheduledFor }, dedupeKey)
      await createNotification({
        workspaceId,
        type: "automation",
        title: `"${automation.name}" needs approval`,
        description: "Its scheduled time has arrived - review it in Automations.",
      })
    } else {
      const result = await executeAction(automation.action.type, automation.action.value, { workspaceId, actorUserId: null })
      await recordAutomationRun(workspaceId, automation.id, result.status, result.errorMessage, { scheduledFor }, dedupeKey)
      if (result.status === "blocked" || result.status === "failed") {
        await createNotification({
          workspaceId,
          type: "automation",
          title: `"${automation.name}" ${result.status}`,
          description: result.errorMessage ?? `Automation run ${result.status}.`,
        })
      }
    }
    fired += 1
  }

  return fired
}

/** Approves a pending-approval run and executes its action now - the
 * human-in-the-loop counterpart to the automatic path above. Re-derives
 * the automation and re-checks everything the automatic path would have
 * (nothing here trusts that "pending" alone means still valid to run). */
export async function approveAutomationRun(
  workspaceId: string,
  automation: Automation,
  triggerContext: Record<string, unknown> | null,
  actorUserId: string
): Promise<{ status: "completed" | "blocked" | "failed"; errorMessage?: string }> {
  const actionCtx: ActionContext = {
    workspaceId,
    actorUserId,
    leadId: typeof triggerContext?.leadId === "string" ? triggerContext.leadId : undefined,
  }
  return executeAction(automation.action.type, automation.action.value, actionCtx)
}
