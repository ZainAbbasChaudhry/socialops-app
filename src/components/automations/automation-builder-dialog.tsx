"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlatformIcon, PLATFORM_LABEL } from "@/components/dashboard/platform-icon"
import { TRIGGER_OPTIONS, CONDITION_OPTIONS, ACTION_OPTIONS, labelFor } from "@/lib/automation-options"
import { DEFAULT_CREATE_MEETING_CONFIG, serializeCreateMeetingConfig, type CreateMeetingConfig } from "@/lib/automations/create-meeting-config"
import { useDashboardViewMode } from "@/lib/dashboard-view-mode-context"
import { generateAutomationId } from "@/lib/store/automations-store"
import type {
  Automation,
  AutomationActionType,
  AutomationConditionType,
  AutomationRunMode,
  AutomationTriggerType,
  SocialPlatform,
} from "@/types"

const PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "x"]

interface AutomationBuilderDialogProps {
  onCreated: (automation: Automation) => void
}

export function AutomationBuilderDialog({ onCreated }: AutomationBuilderDialogProps) {
  const { mode } = useDashboardViewMode()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [name, setName] = React.useState("")
  const [platform, setPlatform] = React.useState<SocialPlatform | "all">("all")
  const [triggerType, setTriggerType] = React.useState<AutomationTriggerType>("new-comment")
  const [triggerValue, setTriggerValue] = React.useState("")
  const [conditionType, setConditionType] = React.useState<AutomationConditionType>("none")
  const [conditionValue, setConditionValue] = React.useState("")
  const [actionType, setActionType] = React.useState<AutomationActionType>("reply")
  const [actionValue, setActionValue] = React.useState("")
  const [meetingConfig, setMeetingConfig] = React.useState<CreateMeetingConfig>(DEFAULT_CREATE_MEETING_CONFIG)
  const [runMode, setRunMode] = React.useState<AutomationRunMode>("manual-approval")
  const [workingHoursOnly, setWorkingHoursOnly] = React.useState(true)
  const [delayMinutes, setDelayMinutes] = React.useState(0)
  const [maxAttempts, setMaxAttempts] = React.useState(1)
  const [escalateAfterFailures, setEscalateAfterFailures] = React.useState(false)

  function reset() {
    setName("")
    setPlatform("all")
    setTriggerType("new-comment")
    setTriggerValue("")
    setConditionType("none")
    setConditionValue("")
    setActionType("reply")
    setActionValue("")
    setMeetingConfig(DEFAULT_CREATE_MEETING_CONFIG)
    setRunMode("manual-approval")
    setWorkingHoursOnly(true)
    setDelayMinutes(0)
    setMaxAttempts(1)
    setEscalateAfterFailures(false)
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return

    const isCreateMeeting = actionType === "create-meeting"
    const resolvedActionValue = isCreateMeeting ? serializeCreateMeetingConfig(meetingConfig) : actionValue || undefined
    const actionLabelSuffix = isCreateMeeting
      ? `: ${meetingConfig.delayHours}h delay, ${meetingConfig.durationMinutes}min`
      : actionValue
        ? `: "${actionValue}"`
        : ""

    // A datetime-local input yields "2026-09-06T14:30" with no zone. The
    // engine parses the stored value with Date.parse on the SERVER, which
    // would read that as the server's local time, not the person's - so the
    // wall-clock time they picked is converted to an absolute instant here,
    // in their own browser, where the offset is actually known.
    const normalisedTriggerValue =
      triggerOption?.valueKind === "datetime" && triggerValue
        ? (() => {
            const parsed = new Date(triggerValue)
            return Number.isNaN(parsed.getTime()) ? triggerValue : parsed.toISOString()
          })()
        : triggerValue

    const trigger = {
      type: triggerType,
      label:
        labelFor(TRIGGER_OPTIONS, triggerType) +
        (triggerValue
          ? triggerOption?.valueKind === "datetime"
            ? `: ${new Date(triggerValue).toLocaleString()}`
            : `: "${triggerValue}"`
          : ""),
      value: normalisedTriggerValue || undefined,
    }
    const condition = {
      type: conditionType,
      label: labelFor(CONDITION_OPTIONS, conditionType) + (conditionValue ? `: "${conditionValue}"` : ""),
      value: conditionValue || undefined,
    }
    const action = {
      type: actionType,
      label: labelFor(ACTION_OPTIONS, actionType) + actionLabelSuffix,
      value: resolvedActionValue,
    }
    const rules = { runMode, workingHoursOnly, delayMinutes, maxAttempts, escalateAfterFailures }

    // Demo Mode never reaches a real endpoint - the automation is built
    // entirely client-side and only ever lands in the in-memory demo
    // store, same as every other demo mutation.
    if (mode === "demo") {
      onCreated({
        id: generateAutomationId(),
        name: name.trim(),
        status: "draft",
        platform,
        trigger,
        condition,
        action,
        rules,
        runsLast30d: 0,
        lastRunAt: null,
      })
      reset()
      setOpen(false)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: name.trim(), platform, trigger, condition, action, rules }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to create automation.")
        return
      }
      onCreated(data.automation as Automation)
      reset()
      setOpen(false)
    } catch {
      setError("Couldn't reach the server.")
    } finally {
      setSaving(false)
    }
  }

  const triggerOption = TRIGGER_OPTIONS.find((o) => o.value === triggerType)
  const triggerNeedsValue = triggerOption?.needsValue
  const conditionNeedsValue = CONDITION_OPTIONS.find((o) => o.value === conditionType)?.needsValue
  const actionNeedsValue = ACTION_OPTIONS.find((o) => o.value === actionType)?.needsValue

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={<Button />}>
        <Sparkles />
        Create automation
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleCreate} className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create automation</DialogTitle>
            <DialogDescription>Build a simple when → if → then rule. Runs against demo data only.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auto-name">Name</Label>
            <Input
              id="auto-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Pricing question auto-reply"
              className="h-9"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Platform scope</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as SocialPlatform | "all")}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    <PlatformIcon platform={p} accent size={14} />
                    {PLATFORM_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <StepRow label="WHEN">
              <Select value={triggerType} onValueChange={(v) => setTriggerType(v as AutomationTriggerType)}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </StepRow>
            {triggerNeedsValue && (
              <Input
                type={
                  triggerOption?.valueKind === "datetime"
                    ? "datetime-local"
                    : triggerOption?.valueKind === "number"
                      ? "number"
                      : "text"
                }
                value={triggerValue}
                onChange={(event) => setTriggerValue(event.target.value)}
                placeholder={triggerOption?.valueHint ?? "Value…"}
                className="h-8"
              />
            )}

            <StepRow label="IF">
              <Select value={conditionType} onValueChange={(v) => setConditionType(v as AutomationConditionType)}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </StepRow>
            {conditionNeedsValue && (
              <Input
                value={conditionValue}
                onChange={(event) => setConditionValue(event.target.value)}
                placeholder="Value…"
                className="h-8"
              />
            )}

            <StepRow label="THEN">
              <Select value={actionType} onValueChange={(v) => setActionType(v as AutomationActionType)}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </StepRow>
            {actionType === "create-meeting" ? (
              <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Delay (hours)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={meetingConfig.delayHours}
                    onChange={(e) => setMeetingConfig((c) => ({ ...c, delayHours: Math.max(0, Number(e.target.value) || 0) }))}
                    className="h-8"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Duration (minutes)</Label>
                  <Input
                    type="number"
                    min={5}
                    value={meetingConfig.durationMinutes}
                    onChange={(e) => setMeetingConfig((c) => ({ ...c, durationMinutes: Math.max(5, Number(e.target.value) || 5) }))}
                    className="h-8"
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Meeting title ({"{name}"} = lead&apos;s name)</Label>
                  <Input
                    value={meetingConfig.titleTemplate}
                    onChange={(e) => setMeetingConfig((c) => ({ ...c, titleTemplate: e.target.value }))}
                    className="h-8"
                  />
                </div>
              </div>
            ) : (
              actionNeedsValue && (
                <Input
                  value={actionValue}
                  onChange={(event) => setActionValue(event.target.value)}
                  placeholder="Value…"
                  className="h-8"
                />
              )
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <span className="text-xs font-semibold text-muted-foreground">Rules</span>

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="auto-run-mode" className="text-sm font-normal">
                Run mode
              </Label>
              <Select value={runMode} onValueChange={(v) => setRunMode(v as AutomationRunMode)}>
                <SelectTrigger id="auto-run-mode" size="sm" className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual-approval">Manual approval</SelectItem>
                  <SelectItem value="automatic">Automatic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="auto-working-hours" className="text-sm font-normal">
                Working hours only
              </Label>
              <Switch id="auto-working-hours" checked={workingHoursOnly} onCheckedChange={setWorkingHoursOnly} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auto-delay" className="text-xs text-muted-foreground">
                  Delay (minutes)
                </Label>
                <Input
                  id="auto-delay"
                  type="number"
                  min={0}
                  value={delayMinutes}
                  onChange={(event) => setDelayMinutes(Number(event.target.value) || 0)}
                  className="h-8"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auto-max-attempts" className="text-xs text-muted-foreground">
                  Max attempts
                </Label>
                <Input
                  id="auto-max-attempts"
                  type="number"
                  min={1}
                  value={maxAttempts}
                  onChange={(event) => setMaxAttempts(Math.max(1, Number(event.target.value) || 1))}
                  className="h-8"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="auto-escalate" className="text-sm font-normal">
                Escalate to human after failures
              </Label>
              <Switch id="auto-escalate" checked={escalateAfterFailures} onCheckedChange={setEscalateAfterFailures} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            {/* A trigger that needs a value and hasn't got one saves an
                automation that can never fire - which is exactly how every
                scheduled automation used to end up. Blocked here instead. */}
            <Button type="submit" disabled={!name.trim() || saving || (triggerNeedsValue && !triggerValue.trim())}>
              {saving ? "Saving..." : "Save automation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StepRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}
