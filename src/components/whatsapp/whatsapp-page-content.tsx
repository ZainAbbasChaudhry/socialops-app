"use client"

import * as React from "react"
import { MessageCircle, Target } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConnectionCard } from "@/components/whatsapp/connection-card"
import { GatewayConnectionCard } from "@/components/whatsapp/gateway-connection-card"
import { FeatureControlPanel } from "@/components/whatsapp/feature-control-panel"
import { ContactsPanel } from "@/components/whatsapp/contacts-panel"
import { GroupsPanel } from "@/components/whatsapp/groups-panel"
import { CampaignsPanel } from "@/components/whatsapp/campaigns-panel"
import { WhatsAppInbox } from "@/components/whatsapp/whatsapp-inbox"
import { QrDemoConnectionCard } from "@/components/whatsapp/qr-demo-connection-card"
import { QrLinkCard } from "@/components/whatsapp/qr-link-card"
import { ChatbotDemo } from "@/components/whatsapp/chatbot-demo"
import { LeadInboxList } from "@/components/whatsapp/lead-inbox-list"
import { LiveConversationsList } from "@/components/whatsapp/live-conversations-list"
import { WhatsAppIcon } from "@/components/whatsapp/whatsapp-icon"
import { AnimatedNumber } from "@/components/dashboard/animated-number"
import { LEAD_STAGE_ORDER } from "@/lib/lead-status"
import { formatCompactNumber } from "@/lib/format"
import { useLeads } from "@/lib/store/leads-store"
import { useDashboardViewMode } from "@/lib/dashboard-view-mode-context"

export function WhatsAppPageContent() {
  const { mode } = useDashboardViewMode()
  // Once a number is linked, the WhatsApp workspace IS the page - the two
  // headline counters are a stand-in for having nothing connected yet, and
  // keeping them above a live inbox just pushes the client's actual work
  // below the fold. The counters stay reachable on the Leads screen.
  const [linked, setLinked] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/whatsapp/session")
        const json = await res.json()
        if (!cancelled && res.ok) setLinked(json?.session?.status === "connected")
      } catch {
        /* not linked, or EasyLife unreachable - the page falls back to the
           counters and the Connection tab, which is where you would go to
           fix either. */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const { leads } = useLeads()
  const whatsappLeads = leads.filter((l) => l.whatsappNumber)
  const qualifiedIndex = LEAD_STAGE_ORDER.indexOf("qualified")
  const qualifiedLeads = whatsappLeads.filter((l) => LEAD_STAGE_ORDER.indexOf(l.stage) >= qualifiedIndex)

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <WhatsAppIcon size={20} />
          WhatsApp
        </h2>
        <p className="text-sm text-muted-foreground">
          One EasyLife WhatsApp Business number — from QR scan to AI-qualified lead, all in one place.
        </p>
      </div>

      {/* The live inbox replaces the counters as soon as a number is linked. */}
      {linked && mode === "client" && <WhatsAppInbox />}

      <div className={`grid grid-cols-2 gap-3 sm:max-w-sm${linked && mode === "client" ? " hidden" : ""}`}>
        <div className="flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-foreground/10 transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
          <MessageCircle className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-col">
            <span className="text-base font-semibold tabular-nums text-foreground">
              <AnimatedNumber value={whatsappLeads.length} format={formatCompactNumber} />
            </span>
            <span className="truncate text-xs text-muted-foreground">Leads received</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-foreground/10 transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
          <Target className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-col">
            <span className="text-base font-semibold tabular-nums text-foreground">
              <AnimatedNumber value={qualifiedLeads.length} format={formatCompactNumber} />
            </span>
            <span className="truncate text-xs text-muted-foreground">Qualified leads</span>
          </div>
        </div>
      </div>

      {/* Real and demo tabs are never mixed on screen at once - Client Mode
          shows only the real connection/conversation tabs, Demo Mode shows
          only the demo-oriented ones, matching whichever the header
          switcher is currently set to. */}
      {mode === "client" ? (
        <Tabs defaultValue="connection">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="live">Live Conversations</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            <TabsTrigger value="qr-demo">QR Demo</TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="pt-4">
            <div className="flex flex-col gap-4">
              {/* QR / pairing-code linking through EasyLife's own WhatsApp
                  gateway - the path most clients use, since it needs no Meta
                  Business verification. The Cloud API card stays below for
                  workspaces on the official API. */}
              <GatewayConnectionCard />
              <ConnectionCard />
            </div>
          </TabsContent>

          <TabsContent value="live" className="pt-4">
            <LiveConversationsList />
          </TabsContent>

          <TabsContent value="contacts" className="pt-4">
            <ContactsPanel />
          </TabsContent>

          <TabsContent value="groups" className="pt-4">
            <GroupsPanel />
          </TabsContent>

          <TabsContent value="campaigns" className="pt-4">
            <CampaignsPanel />
          </TabsContent>

          {/* Every WhatsApp capability EasyLife can grant this workspace.
              Read-only for the client; an EasyLife platform operator can
              change what the client is entitled to. */}
          <TabsContent value="capabilities" className="pt-4">
            <FeatureControlPanel />
          </TabsContent>

          <TabsContent value="qr-demo" className="pt-4">
            <QrDemoConnectionCard />
          </TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue="connection">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="qr">QR & Link</TabsTrigger>
            <TabsTrigger value="chatbot">Chatbot Demo</TabsTrigger>
            <TabsTrigger value="inbox">Lead Inbox</TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="pt-4">
            <div className="flex flex-col gap-4">
              {/* QR / pairing-code linking through EasyLife's own WhatsApp
                  gateway - the path most clients use, since it needs no Meta
                  Business verification. The Cloud API card stays below for
                  workspaces on the official API. */}
              <GatewayConnectionCard />
              <ConnectionCard />
            </div>
          </TabsContent>

          <TabsContent value="qr" className="pt-4">
            <QrLinkCard />
          </TabsContent>

          <TabsContent value="chatbot" className="pt-4">
            <ChatbotDemo />
          </TabsContent>

          <TabsContent value="inbox" className="pt-4">
            <LeadInboxList />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
