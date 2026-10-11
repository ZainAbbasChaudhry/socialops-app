"use client"

import * as React from "react"
import { Clock, CheckCircle2, Users, MessageSquare, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface AgentStats {
  userId: string | null
  name: string
  assigned: number
  resolved: number
  avgFirstResponseMinutes: number | null
  responseSampleSize: number
}

interface WhatsAppAnalytics {
  totals: { conversations: number; open: number; pending: number; resolved: number; snoozed: number }
  responseTime: { avgMinutes: number | null; sampleSize: number }
  resolvedCounts: { today: number; last7Days: number; last30Days: number }
  byAgent: AgentStats[]
  unassigned: AgentStats
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—"
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

function StatTile({ icon: Icon, value, label }: { icon: React.ComponentType<{ className?: string }>; value: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-foreground/10">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col">
        <span className="text-base font-semibold tabular-nums text-foreground">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

function AgentRow({ agent }: { agent: AgentStats }) {
  return (
    <div className="grid grid-cols-5 items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0">
      <span className="truncate font-medium text-foreground">{agent.name}</span>
      <span className="text-center tabular-nums text-muted-foreground">{agent.assigned}</span>
      <span className="text-center tabular-nums text-muted-foreground">{agent.resolved}</span>
      <span className="text-center tabular-nums text-muted-foreground">
        {agent.assigned > 0 ? `${Math.round((agent.resolved / agent.assigned) * 100)}%` : "—"}
      </span>
      <span className="text-center tabular-nums text-muted-foreground">
        {formatMinutes(agent.avgFirstResponseMinutes)}
        {agent.responseSampleSize > 0 && <span className="ml-1 text-[11px] opacity-60">({agent.responseSampleSize})</span>}
      </span>
    </div>
  )
}

/** Reporting tab for the WhatsApp dashboard - response time, resolution
 * counts, and a per-agent breakdown. "Per agent" is attribution by the
 * conversation's assigned lead owner (the same assignment Team assignment
 * added), not individual message authorship, since outbound messages
 * aren't tagged with a specific user. */
export function WhatsAppAnalyticsPanel() {
  const [data, setData] = React.useState<WhatsAppAnalytics | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/whatsapp/analytics", { credentials: "same-origin" })
        if (!res.ok) throw new Error()
        const json = await res.json()
        setData(json)
      } catch {
        setError("Couldn't load WhatsApp reporting data.")
      }
    }
    load()
  }, [])

  if (error) {
    return <p className="py-10 text-center text-sm text-destructive">{error}</p>
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading reports…
      </div>
    )
  }

  const agentRows = [...data.byAgent, ...(data.unassigned.assigned > 0 ? [data.unassigned] : [])]

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={MessageSquare} value={data.totals.conversations} label="Total conversations" />
        <StatTile icon={Clock} value={data.totals.open + data.totals.pending} label="Open / pending" />
        <StatTile icon={CheckCircle2} value={data.totals.resolved} label="Resolved" />
        <StatTile icon={Users} value={agentRows.length} label="Agents with activity" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="gap-2 px-4 py-4">
          <CardHeader className="px-0 py-0">
            <CardTitle className="text-sm">Time to first response</CardTitle>
          </CardHeader>
          <CardContent className="flex items-baseline gap-2 px-0 py-0">
            <span className="text-2xl font-semibold tabular-nums text-foreground">{formatMinutes(data.responseTime.avgMinutes)}</span>
            <span className="text-xs text-muted-foreground">
              average, from first customer message to first reply ({data.responseTime.sampleSize} conversations with a reply)
            </span>
          </CardContent>
        </Card>

        <Card className="gap-2 px-4 py-4">
          <CardHeader className="px-0 py-0">
            <CardTitle className="text-sm">Resolved</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4 px-0 py-0 text-sm">
            <div className="flex flex-col">
              <span className="text-lg font-semibold tabular-nums text-foreground">{data.resolvedCounts.today}</span>
              <span className="text-xs text-muted-foreground">Last 24h</span>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-semibold tabular-nums text-foreground">{data.resolvedCounts.last7Days}</span>
              <span className="text-xs text-muted-foreground">Last 7 days</span>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-semibold tabular-nums text-foreground">{data.resolvedCounts.last30Days}</span>
              <span className="text-xs text-muted-foreground">Last 30 days</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3 px-4 py-4">
        <CardHeader className="px-0">
          <CardTitle className="text-sm">By agent</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {agentRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No assigned conversations yet.</p>
          ) : (
            <div className="rounded-md border border-border">
              <div className="grid grid-cols-5 gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                <span>Agent</span>
                <span className="text-center">Assigned</span>
                <span className="text-center">Resolved</span>
                <span className="text-center">Resolve rate</span>
                <span className="text-center">Avg first response</span>
              </div>
              {agentRows.map((agent) => (
                <AgentRow key={agent.userId ?? "unassigned"} agent={agent} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
