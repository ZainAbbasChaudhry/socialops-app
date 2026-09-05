/**
 * EasyLife WhatsApp feature catalogue.
 *
 * Every capability the WhatsApp gateway can perform, expressed in EasyLife's
 * own product language and grouped the way a EasyLife admin thinks about
 * them - not the way the underlying gateway's API happens to be organised.
 * Nothing here is customer-facing branding from the gateway: the client sees
 * "EasyLife WhatsApp", full stop.
 *
 * This file is the single source of truth for three things at once:
 *  1. what the platform CAN do (the admin's feature list),
 *  2. which gateway endpoints each capability needs (so the adapter and the
 *     server-side gate agree on what a feature actually unlocks), and
 *  3. what it costs or risks, so an admin enabling it is making an informed
 *     choice rather than flipping an unlabelled switch.
 *
 * Adding a capability should mean adding an entry here plus wiring in the
 * adapter - never a scattered `if (feature === ...)` somewhere downstream.
 *
 * Gateway attribution: the self-hosted gateway this maps onto is OpenWA
 * (MIT licence, Copyright (c) 2026 Yudhi Armyndharis and OpenWA
 * Contributors). EasyLife runs it as an internal service; its licence notice
 * ships with the deployment package, and no OpenWA branding is presented to
 * EasyLife's own customers.
 */

/** Which engine a capability needs. The gateway can run either engine; a few
 * capabilities only exist on one of them, and an admin must not be able to
 * enable something the workspace's engine physically cannot do. */
export type EngineRequirement = "any" | "baileys" | "whatsapp-web"

/** Honest risk labelling. WhatsApp's anti-abuse systems treat these
 * differently, and an admin turning one on for a client should see that
 * before, not after. */
export type FeatureRisk =
  /** Ordinary use - replies, lookups, reading. Nothing that draws attention. */
  | "standard"
  /** Touches other people's chats/groups, or writes to the account profile. */
  | "elevated"
  /** Outbound at volume, or first-contact messaging. The main ban vector. */
  | "high"
  /** Destructive or irreversible: unlinking, deleting, ownership transfer. */
  | "destructive"

export type FeatureCategoryId =
  | "connection"
  | "messaging"
  | "media"
  | "conversations"
  | "contacts"
  | "groups"
  | "business"
  | "broadcast"
  | "automation"
  | "insights"
  | "platform"

export interface FeatureCategory {
  id: FeatureCategoryId
  label: string
  description: string
}

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    id: "connection",
    label: "Connection",
    description: "How a client's WhatsApp number is linked to EasyLife and kept online.",
  },
  {
    id: "messaging",
    label: "Messaging",
    description: "Sending and receiving conversation messages.",
  },
  {
    id: "media",
    label: "Media",
    description: "Images, video, audio, documents and the conversion needed to send them.",
  },
  {
    id: "conversations",
    label: "Conversations",
    description: "Managing the chat list itself - reading, archiving, pinning, presence.",
  },
  {
    id: "contacts",
    label: "Contacts",
    description: "Looking up, saving and blocking the people a client talks to.",
  },
  {
    id: "groups",
    label: "Groups",
    description: "Creating and administering WhatsApp groups.",
  },
  {
    id: "business",
    label: "Business tools",
    description: "WhatsApp Business features - labels, catalogue, profile, status.",
  },
  {
    id: "broadcast",
    label: "Campaigns & broadcast",
    description: "Sending to many recipients. The highest-risk area - read each note.",
  },
  {
    id: "automation",
    label: "Automation",
    description: "Templates, auto-replies and event webhooks.",
  },
  {
    id: "insights",
    label: "Insights",
    description: "Search, statistics and audit history.",
  },
  {
    id: "platform",
    label: "Platform administration",
    description: "EasyLife-operator controls. Never exposed to a client workspace.",
  },
]

export interface WhatsAppFeature {
  /** Stable id - persisted per workspace, so never rename one in place. */
  key: string
  label: string
  /** What this lets the client actually do, in their language. */
  description: string
  category: FeatureCategoryId
  engine: EngineRequirement
  risk: FeatureRisk
  /** Gateway routes this capability unlocks. The server-side gate refuses any
   * call whose route isn't covered by an enabled feature, so this list is
   * enforcement, not documentation. */
  routes: string[]
  /** On for a new workspace unless the admin says otherwise. Kept to the
   * safe, obviously-wanted core. */
  defaultEnabled: boolean
  /** Only an EasyLife operator may toggle this; it never appears in a
   * client-facing list at all. */
  platformOnly?: boolean
  /** Shown next to the toggle when there is something an admin must know
   * before enabling. */
  note?: string
}

export const WHATSAPP_FEATURES: WhatsAppFeature[] = [
  // --- Connection ---------------------------------------------------------
  {
    key: "connect.qr",
    label: "Connect by QR code",
    description: "Link a WhatsApp number by scanning a QR code from the phone. The usual way clients connect.",
    category: "connection",
    engine: "any",
    risk: "standard",
    // Deliberately NOT "POST /sessions/{id}/start": bringing a session up is
    // "Start, stop and reconnect". A route may be claimed by exactly one
    // feature (see ROUTE_TO_FEATURE), otherwise whichever appeared first in
    // this array would silently decide the gate and the other feature's
    // toggle would do nothing.
    routes: ["POST /sessions", "GET /sessions", "GET /sessions/{id}/qr", "GET /sessions/{id}"],
    defaultEnabled: true,
  },
  {
    key: "connect.pairing-code",
    label: "Connect by pairing code",
    description:
      "Link by entering an 8-character code on the phone instead of scanning. Useful when the client can't point a camera at the screen - remote setup, or a phone already in someone's hand.",
    category: "connection",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/pairing-code"],
    defaultEnabled: true,
  },
  {
    key: "connect.session-control",
    label: "Start, stop and reconnect",
    description: "Bring the connection up or down without unlinking the phone.",
    category: "connection",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/start", "POST /sessions/{id}/stop"],
    defaultEnabled: true,
  },
  {
    key: "connect.logout",
    label: "Unlink the number",
    description: "Log the number out of EasyLife and clear its stored credentials.",
    category: "connection",
    engine: "any",
    risk: "destructive",
    routes: ["POST /sessions/{id}/logout", "DELETE /sessions/{id}"],
    defaultEnabled: true,
    note: "Reconnecting afterwards needs a fresh QR scan. Conversation history in EasyLife is kept.",
  },
  {
    key: "connect.force-recover",
    label: "Force recovery",
    description: "Hard-restart a connection that has wedged and won't respond to a normal stop.",
    category: "connection",
    engine: "any",
    risk: "elevated",
    routes: ["POST /sessions/{id}/force-kill"],
    defaultEnabled: false,
    note: "Support tool. Leave off for clients; enable when troubleshooting.",
  },
  {
    key: "connect.tuning",
    label: "Connection tuning",
    description: "Per-number settings: proxy, auto-reject calls, engine behaviour.",
    category: "connection",
    engine: "any",
    risk: "elevated",
    routes: ["GET /sessions/{id}/config", "PATCH /sessions/{id}/config"],
    defaultEnabled: false,
  },

  // --- Messaging ----------------------------------------------------------
  {
    key: "message.send-text",
    label: "Send text messages",
    description: "The core of the AI sales agent - every bot reply and agent reply goes through this.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-text"],
    defaultEnabled: true,
  },
  {
    key: "message.receive",
    label: "Receive messages",
    description: "Inbound customer messages reaching the EasyLife inbox and the qualification pipeline.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["GET /sessions/{id}/messages", "GET /sessions/{id}/messages/{chatId}/history"],
    defaultEnabled: true,
  },
  {
    key: "message.reply",
    label: "Quote and reply",
    description: "Reply to a specific message so the customer sees what it refers to.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/reply"],
    defaultEnabled: true,
  },
  {
    key: "message.react",
    label: "Emoji reactions",
    description: "React to a customer's message - a lightweight acknowledgement.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: [
      "POST /sessions/{id}/messages/react",
      "GET /sessions/{id}/messages/{chatId}/{messageId}/reactions",
    ],
    defaultEnabled: true,
  },
  {
    key: "message.edit",
    label: "Edit sent messages",
    description: "Correct a message already sent, within WhatsApp's edit window.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/edit"],
    defaultEnabled: true,
  },
  {
    key: "message.delete",
    label: "Delete messages",
    description: "Remove a sent message for everyone.",
    category: "messaging",
    engine: "any",
    risk: "destructive",
    routes: ["POST /sessions/{id}/messages/delete"],
    defaultEnabled: false,
  },
  {
    key: "message.forward",
    label: "Forward messages",
    description: "Pass a message on to another chat.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/forward"],
    defaultEnabled: false,
  },
  {
    key: "message.pin-star",
    label: "Pin and star messages",
    description: "Mark important messages inside a conversation.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: [
      "POST /sessions/{id}/messages/pin",
      "POST /sessions/{id}/messages/unpin",
      "POST /sessions/{id}/messages/star",
    ],
    defaultEnabled: false,
  },
  {
    key: "message.polls",
    label: "Polls",
    description: "Send a native WhatsApp poll and read the votes back - useful for quick qualification.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-poll", "POST /sessions/{id}/messages/vote-poll"],
    defaultEnabled: false,
  },
  {
    key: "message.location",
    label: "Send location",
    description: "Share a pin - an office address, a site visit location.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-location"],
    defaultEnabled: false,
  },
  {
    key: "message.contact-card",
    label: "Send contact cards",
    description: "Share a saved contact, e.g. handing a lead to a named salesperson.",
    category: "messaging",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-contact"],
    defaultEnabled: false,
  },

  // --- Media --------------------------------------------------------------
  {
    key: "media.images",
    label: "Send images",
    description: "Photos, brochures, screenshots, price lists.",
    category: "media",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-image"],
    defaultEnabled: true,
  },
  {
    key: "media.documents",
    label: "Send documents",
    description: "PDFs, quotes, proposals, contracts.",
    category: "media",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-document"],
    defaultEnabled: true,
  },
  {
    key: "media.video",
    label: "Send video",
    description: "Product or walkthrough video.",
    category: "media",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-video"],
    defaultEnabled: false,
  },
  {
    key: "media.audio",
    label: "Send audio and voice notes",
    description: "Voice notes, which usually get read faster than text.",
    category: "media",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-audio"],
    defaultEnabled: false,
  },
  {
    key: "media.stickers",
    label: "Send stickers",
    description: "Branded stickers.",
    category: "media",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/messages/send-sticker"],
    defaultEnabled: false,
  },
  {
    key: "media.download",
    label: "Download received media",
    description: "Pull a customer's attachment into EasyLife - a site photo, a signed document.",
    category: "media",
    engine: "any",
    risk: "standard",
    routes: ["GET /sessions/{id}/messages/{chatId}/{messageId}/media"],
    defaultEnabled: true,
  },
  {
    key: "media.conversion",
    label: "Automatic media conversion",
    description: "Convert audio and video server-side into the formats WhatsApp accepts.",
    category: "media",
    engine: "any",
    risk: "standard",
    routes: [
      "GET /sessions/{id}/media/convert",
      "POST /sessions/{id}/media/convert/voice",
      "POST /sessions/{id}/media/convert/video",
    ],
    defaultEnabled: false,
    note: "Needs ffmpeg on the gateway host. Without it, files must already be in a supported format.",
  },

  // --- Conversations ------------------------------------------------------
  {
    key: "chat.list",
    label: "Chat list",
    description: "See the client's active WhatsApp conversations inside EasyLife.",
    category: "conversations",
    engine: "any",
    risk: "standard",
    routes: ["GET /sessions/{id}/chats"],
    defaultEnabled: true,
  },
  {
    key: "chat.read-state",
    label: "Read and unread",
    description: "Mark conversations read or unread from the EasyLife inbox.",
    category: "conversations",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/chats/read", "POST /sessions/{id}/chats/unread"],
    defaultEnabled: true,
  },
  {
    key: "chat.typing",
    label: "Typing indicator",
    description: "Show 'typing…' while the AI composes, so replies feel human-paced.",
    category: "conversations",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/chats/typing"],
    defaultEnabled: true,
  },
  {
    key: "chat.presence",
    label: "Online presence",
    description: "Control whether the number appears online, and read a contact's last-seen.",
    category: "conversations",
    engine: "any",
    risk: "elevated",
    routes: [
      "PUT /sessions/{id}/presence",
      "POST /sessions/{id}/presence/subscribe",
      "GET /sessions/{id}/presence/{chatId}",
    ],
    defaultEnabled: false,
  },
  {
    key: "chat.organise",
    label: "Archive, mute and pin chats",
    description: "Keep the client's chat list tidy from inside EasyLife.",
    category: "conversations",
    engine: "any",
    risk: "standard",
    routes: [
      "POST /sessions/{id}/chats/archive",
      "POST /sessions/{id}/chats/mute",
      "POST /sessions/{id}/chats/pin",
    ],
    defaultEnabled: false,
  },
  {
    key: "chat.delete",
    label: "Delete chats",
    description: "Remove a conversation, or clear its messages, from the phone.",
    category: "conversations",
    engine: "any",
    risk: "destructive",
    routes: ["POST /sessions/{id}/chats/delete", "DELETE /sessions/{id}/chats/{chatId}/messages"],
    defaultEnabled: false,
    note: "Deletes on the client's actual phone. Not recoverable.",
  },

  // --- Contacts -----------------------------------------------------------
  {
    key: "contact.list",
    label: "Contact directory",
    description: "Read the account's contacts, with profile pictures resolved in batches.",
    category: "contacts",
    engine: "any",
    risk: "standard",
    routes: [
      "GET /sessions/{id}/contacts",
      "GET /sessions/{id}/contacts/{contactId}",
      "GET /sessions/{id}/contacts/profile-pictures",
      "GET /sessions/{id}/contacts/{contactId}/profile-picture",
    ],
    defaultEnabled: true,
  },
  {
    key: "contact.check-number",
    label: "Check a number is on WhatsApp",
    description:
      "Before spending a message on a lead, confirm the number actually has WhatsApp. Cuts wasted sends and keeps campaign lists clean.",
    category: "contacts",
    engine: "any",
    risk: "standard",
    routes: ["GET /sessions/{id}/contacts/check/{number}", "GET /sessions/{id}/contacts/{contactId}/phone"],
    defaultEnabled: true,
  },
  {
    key: "contact.manage",
    label: "Save and edit contacts",
    description: "Write a qualified lead into the phone's address book.",
    category: "contacts",
    engine: "any",
    risk: "elevated",
    routes: ["PUT /sessions/{id}/contacts/{contactId}", "DELETE /sessions/{id}/contacts/{contactId}"],
    defaultEnabled: false,
  },
  {
    key: "contact.block",
    label: "Block and unblock",
    description: "Block a spammer or abusive contact from the client's number.",
    category: "contacts",
    engine: "any",
    risk: "elevated",
    routes: [
      "POST /sessions/{id}/contacts/{contactId}/block",
      "DELETE /sessions/{id}/contacts/{contactId}/block",
      "GET /sessions/{id}/contacts/blocked",
    ],
    defaultEnabled: false,
  },

  // --- Groups -------------------------------------------------------------
  {
    key: "group.read",
    label: "See groups",
    description: "List the groups the number belongs to and read their details.",
    category: "groups",
    engine: "any",
    risk: "standard",
    routes: ["GET /sessions/{id}/groups", "GET /sessions/{id}/groups/{groupId}"],
    defaultEnabled: false,
  },
  {
    key: "group.create",
    label: "Create groups",
    description: "Open a group for a project, a society, a buyer cohort.",
    category: "groups",
    engine: "any",
    risk: "elevated",
    routes: ["POST /sessions/{id}/groups"],
    defaultEnabled: false,
  },
  {
    key: "group.join",
    label: "Join by invite link",
    description: "Preview a group from its link, then join it.",
    category: "groups",
    engine: "any",
    risk: "elevated",
    routes: ["GET /sessions/{id}/groups/join-info", "POST /sessions/{id}/groups/join"],
    defaultEnabled: false,
  },
  {
    key: "group.participants",
    label: "Manage members",
    description: "Add or remove people, promote and demote admins.",
    category: "groups",
    engine: "any",
    risk: "elevated",
    routes: [
      "POST /sessions/{id}/groups/{groupId}/participants",
      "DELETE /sessions/{id}/groups/{groupId}/participants",
      "POST /sessions/{id}/groups/{groupId}/participants/promote",
      "POST /sessions/{id}/groups/{groupId}/participants/demote",
    ],
    defaultEnabled: false,
    note: "Adding people who never asked to join is a common ban trigger. Prefer invite links.",
  },
  {
    key: "group.requests",
    label: "Approve join requests",
    description: "Review, approve or reject people asking to join.",
    category: "groups",
    engine: "any",
    risk: "standard",
    routes: [
      "GET /sessions/{id}/groups/{groupId}/membership-requests",
      "POST /sessions/{id}/groups/{groupId}/membership-requests/approve",
      "POST /sessions/{id}/groups/{groupId}/membership-requests/reject",
    ],
    defaultEnabled: false,
  },
  {
    key: "group.settings",
    label: "Group settings and branding",
    description: "Name, description, picture, who may post, disappearing-message timer.",
    category: "groups",
    engine: "any",
    risk: "elevated",
    routes: [
      "GET /sessions/{id}/groups/{groupId}/settings",
      "PUT /sessions/{id}/groups/{groupId}/settings",
      "PUT /sessions/{id}/groups/{groupId}/subject",
      "PUT /sessions/{id}/groups/{groupId}/description",
      "GET /sessions/{id}/groups/{groupId}/picture",
      "PUT /sessions/{id}/groups/{groupId}/picture",
      "DELETE /sessions/{id}/groups/{groupId}/picture",
    ],
    defaultEnabled: false,
  },
  {
    key: "group.invite-links",
    label: "Invite links",
    description: "Generate a group invite link, and revoke it when a campaign ends.",
    category: "groups",
    engine: "any",
    risk: "standard",
    routes: [
      "GET /sessions/{id}/groups/{groupId}/invite-code",
      "POST /sessions/{id}/groups/{groupId}/invite-code/revoke",
    ],
    defaultEnabled: false,
  },
  {
    key: "group.leave",
    label: "Leave groups",
    description: "Remove the client's number from a group.",
    category: "groups",
    engine: "any",
    risk: "destructive",
    routes: ["POST /sessions/{id}/groups/{groupId}/leave"],
    defaultEnabled: false,
  },

  // --- Business tools -----------------------------------------------------
  {
    key: "business.labels",
    label: "Chat labels",
    description:
      "WhatsApp Business labels on chats - and EasyLife can mirror them to CRM stages, so the phone and the pipeline agree.",
    category: "business",
    engine: "any",
    risk: "standard",
    routes: [
      "GET /sessions/{id}/labels",
      "GET /sessions/{id}/labels/{labelId}",
      "PUT /sessions/{id}/labels/{labelId}",
      "DELETE /sessions/{id}/labels/{labelId}",
      "GET /sessions/{id}/labels/{labelId}/chats",
      "GET /sessions/{id}/labels/chat/{chatId}",
      "POST /sessions/{id}/labels/chat/{chatId}",
      "DELETE /sessions/{id}/labels/chat/{chatId}/{labelId}",
    ],
    defaultEnabled: false,
    note: "Requires the connected number to be a WhatsApp Business account.",
  },
  {
    key: "business.profile",
    label: "Account profile",
    description: "Set the number's display name, about text and profile picture from EasyLife.",
    category: "business",
    engine: "any",
    risk: "elevated",
    routes: [
      "PUT /sessions/{id}/profile/name",
      "PUT /sessions/{id}/profile/status",
      "PUT /sessions/{id}/profile/picture",
      "DELETE /sessions/{id}/profile/picture",
    ],
    defaultEnabled: false,
  },
  {
    key: "business.status",
    label: "Status / stories",
    description: "Post text, image, video or voice status updates, and read contacts' status.",
    category: "business",
    engine: "any",
    risk: "elevated",
    routes: [
      "GET /sessions/{id}/status",
      "GET /sessions/{id}/status/{id}",
      "DELETE /sessions/{id}/status/{id}",
      "GET /sessions/{id}/status/{statusId}/media",
      "POST /sessions/{id}/status/send-text",
      "POST /sessions/{id}/status/send-image",
      "POST /sessions/{id}/status/send-video",
      "POST /sessions/{id}/status/send-voice",
    ],
    defaultEnabled: false,
  },
  {
    key: "business.catalog",
    label: "Product catalogue",
    description: "Read the business catalogue and send a product straight into a chat.",
    category: "business",
    engine: "baileys",
    risk: "standard",
    routes: [
      "GET /sessions/{id}/catalog",
      "GET /sessions/{id}/catalog/products",
      "GET /sessions/{id}/catalog/products/{productId}",
      "POST /sessions/{id}/messages/send-product",
    ],
    defaultEnabled: false,
    note: "Available only on the Baileys engine.",
  },
  {
    key: "business.channels",
    label: "Channels",
    description: "Create, subscribe to and post in WhatsApp Channels.",
    category: "business",
    engine: "any",
    risk: "elevated",
    routes: [
      "GET /sessions/{id}/channels",
      "POST /sessions/{id}/channels",
      "GET /sessions/{id}/channels/{channelId}",
      "DELETE /sessions/{id}/channels/{channelId}",
      "GET /sessions/{id}/channels/{channelId}/messages",
      "POST /sessions/{id}/channels/{channelId}/delete",
      "POST /sessions/{id}/channels/{channelId}/mute",
      "POST /sessions/{id}/channels/{channelId}/admins/demote",
      "POST /sessions/{id}/channels/{channelId}/owner/transfer",
      "POST /sessions/{id}/channels/subscribe",
    ],
    defaultEnabled: false,
  },
  {
    key: "business.calls",
    label: "Call links and call handling",
    description: "Share a WhatsApp call link, and reject unwanted incoming calls automatically.",
    category: "business",
    engine: "any",
    risk: "standard",
    routes: ["POST /sessions/{id}/calls/link", "POST /sessions/{id}/calls/{callId}/reject"],
    defaultEnabled: false,
  },

  // --- Campaigns ----------------------------------------------------------
  {
    key: "broadcast.bulk",
    label: "Bulk campaigns",
    description: "Queue a message to many recipients as a batch, with progress and cancellation.",
    category: "broadcast",
    engine: "any",
    risk: "high",
    routes: [
      "POST /sessions/{id}/messages/send-bulk",
      "GET /sessions/{id}/messages/batch/{batchId}",
      "POST /sessions/{id}/messages/batch/{batchId}/cancel",
    ],
    defaultEnabled: false,
    note:
      "The single most likely way to get a client's number banned. Only enable for opted-in recipients, and keep the gateway's rate limit on.",
  },
  {
    key: "broadcast.templates",
    label: "Message templates",
    description: "Reusable message templates with variables, so the team sends consistent copy.",
    category: "automation",
    engine: "any",
    risk: "standard",
    routes: [
      "POST /sessions/{id}/templates",
      "GET /sessions/{id}/templates",
      "GET /sessions/{id}/templates/{id}",
      "PUT /sessions/{id}/templates/{id}",
      "DELETE /sessions/{id}/templates/{id}",
      "POST /sessions/{id}/messages/send-template",
    ],
    defaultEnabled: false,
  },

  // --- Automation ---------------------------------------------------------
  {
    key: "automation.autoreply",
    label: "Auto-reply rules",
    description:
      "Keyword rules that answer instantly at the gateway - useful for out-of-hours or a first acknowledgement before the AI replies.",
    category: "automation",
    engine: "any",
    risk: "standard",
    routes: [
      "POST /sessions/{id}/automation-rules",
      "GET /sessions/{id}/automation-rules",
      "GET /sessions/{id}/automation-rules/{ruleId}",
      "PUT /sessions/{id}/automation-rules/{ruleId}",
      "DELETE /sessions/{id}/automation-rules/{ruleId}",
    ],
    defaultEnabled: false,
    note: "These fire before EasyLife's AI. Two systems answering the same message is confusing - use for narrow cases.",
  },
  {
    key: "automation.webhooks",
    label: "Outgoing webhooks",
    description: "Push WhatsApp events to another system the client runs.",
    category: "automation",
    engine: "any",
    risk: "elevated",
    routes: [
      "POST /sessions/{id}/webhooks",
      "GET /sessions/{id}/webhooks",
      "GET /sessions/{id}/webhooks/{id}",
      "PUT /sessions/{id}/webhooks/{id}",
      "DELETE /sessions/{id}/webhooks/{id}",
      "POST /sessions/{id}/webhooks/{id}/test",
      "GET /webhooks",
      "GET /webhooks/delivery-failures",
    ],
    defaultEnabled: false,
    note: "EasyLife's own inbound webhook is separate and always on - this is for the client's third-party systems.",
  },

  // --- Insights -----------------------------------------------------------
  {
    key: "insights.search",
    label: "Message search",
    description: "Search across the client's WhatsApp conversations.",
    category: "insights",
    engine: "any",
    risk: "standard",
    routes: ["GET /search"],
    defaultEnabled: false,
  },
  {
    key: "insights.stats",
    label: "Messaging statistics",
    description: "Volume over time, per number - what the dashboard's WhatsApp charts read from.",
    category: "insights",
    engine: "any",
    risk: "standard",
    routes: ["GET /stats/overview", "GET /stats/messages", "GET /stats/sessions/{id}", "GET /sessions/stats/overview"],
    defaultEnabled: true,
  },

  // --- Platform administration (EasyLife operators only) ------------------
  {
    key: "platform.engine-control",
    label: "Engine selection",
    description: "Choose which WhatsApp engine the gateway runs, and read engine health.",
    category: "platform",
    engine: "any",
    risk: "elevated",
    routes: ["GET /infra/engines", "GET /infra/engines/current", "GET /infra/status", "GET /infra/health"],
    defaultEnabled: false,
    platformOnly: true,
  },
  {
    key: "platform.infrastructure",
    label: "Gateway infrastructure",
    description: "Gateway configuration, restart, and data export/import.",
    category: "platform",
    engine: "any",
    risk: "destructive",
    routes: [
      "GET /infra/config",
      "PUT /infra/config",
      "POST /infra/restart",
      "GET /infra/export-data",
      "POST /infra/import-data",
      "GET /infra/storage/files/count",
      "GET /infra/storage/export",
      "POST /infra/storage/import",
    ],
    defaultEnabled: false,
    platformOnly: true,
    note: "Restart drops every connected number until it comes back. Import replaces existing data.",
  },
  {
    key: "platform.api-keys",
    label: "Gateway API keys",
    description: "Issue and revoke the keys EasyLife uses to reach the gateway.",
    category: "platform",
    engine: "any",
    risk: "destructive",
    routes: [
      "POST /auth/api-keys",
      "GET /auth/api-keys",
      "GET /auth/api-keys/{id}",
      "PUT /auth/api-keys/{id}",
      "DELETE /auth/api-keys/{id}",
      "POST /auth/api-keys/{id}/revoke",
    ],
    defaultEnabled: false,
    platformOnly: true,
  },
  {
    key: "platform.plugins",
    label: "Gateway plugins",
    description: "Install and configure gateway plugins and their per-client instances.",
    category: "platform",
    engine: "any",
    risk: "elevated",
    routes: [
      "GET /plugins",
      "POST /plugins/install",
      "POST /plugins/install-url",
      "GET /plugins/catalog",
      "GET /plugins/{id}",
      "DELETE /plugins/{id}",
      "POST /plugins/{id}/enable",
      "POST /plugins/{id}/disable",
      "PUT /plugins/{id}/config",
      "PUT /plugins/{id}/config/{id}",
      "PUT /plugins/{id}/sessions",
      "POST /plugins/{id}/update",
      "GET /plugins/{id}/config-ui",
      "GET /plugins/{id}/health",
    ],
    defaultEnabled: false,
    platformOnly: true,
  },
  {
    key: "platform.integrations",
    label: "Third-party integration fabric",
    description:
      "Sandboxed connectors the gateway can run per client (helpdesk, chatbot builders), plus the inbound routes those connectors expose.",
    category: "platform",
    engine: "any",
    risk: "elevated",
    routes: [
      "POST /integration/plugins/{pluginId}/instances",
      "GET /integration/plugins/{pluginId}/instances",
      "GET /integration/plugins/{pluginId}/instances/{instanceId}",
      "PATCH /integration/plugins/{pluginId}/instances/{instanceId}",
      "DELETE /integration/plugins/{pluginId}/instances/{instanceId}",
      "POST /integration/plugins/{pluginId}/instances/{instanceId}/regenerate-secret",
      "POST /integration/instances/{pluginId}/{instanceId}/redrive",
      "GET /ingress/{pluginId}/{instanceId}/{path}",
      "POST /ingress/{pluginId}/{instanceId}/{path}",
      "PUT /ingress/{pluginId}/{instanceId}/{path}",
      "PATCH /ingress/{pluginId}/{instanceId}/{path}",
      "DELETE /ingress/{pluginId}/{instanceId}/{path}",
    ],
    defaultEnabled: false,
    platformOnly: true,
  },
  {
    key: "platform.monitoring",
    label: "Gateway health and metrics",
    description:
      "Liveness and readiness probes, Prometheus metrics, and the gateway's effective settings. Read-only, and what EasyLife's own status checks use.",
    category: "platform",
    engine: "any",
    risk: "standard",
    routes: ["GET /health", "GET /health/live", "GET /health/ready", "GET /metrics", "GET /settings", "POST /auth/validate"],
    defaultEnabled: true,
    platformOnly: true,
  },
  {
    key: "platform.audit",
    label: "Gateway audit log",
    description: "Who did what on the gateway - key changes, session actions, admin operations.",
    category: "platform",
    engine: "any",
    risk: "standard",
    routes: ["GET /audit"],
    defaultEnabled: false,
    platformOnly: true,
  },
]

/** Lookup by key. Built once - the catalogue is static. */
export const FEATURE_BY_KEY = new Map(WHATSAPP_FEATURES.map((f) => [f.key, f]))

/** Features a client workspace may ever see. Platform-only capabilities are
 * excluded entirely rather than shown greyed out, so a client's admin screen
 * never advertises controls they cannot have. */
export const CLIENT_FEATURES = WHATSAPP_FEATURES.filter((f) => !f.platformOnly)

/** What a brand-new workspace starts with. */
export const DEFAULT_ENABLED_KEYS = CLIENT_FEATURES.filter((f) => f.defaultEnabled).map((f) => f.key)

export function featuresByCategory(features: WhatsAppFeature[] = CLIENT_FEATURES) {
  return FEATURE_CATEGORIES.map((category) => ({
    category,
    features: features.filter((f) => f.category === category.id),
  })).filter((group) => group.features.length > 0)
}

/**
 * Which feature (if any) authorises a given gateway route. The server-side
 * gate calls this before every outbound gateway request: a route no enabled
 * feature covers is refused, so disabling a feature genuinely removes the
 * capability rather than merely hiding its button.
 */
export const ROUTE_TO_FEATURE: ReadonlyMap<string, WhatsAppFeature> = (() => {
  const index = new Map<string, WhatsAppFeature>()
  const clashes: string[] = []
  for (const feature of WHATSAPP_FEATURES) {
    for (const route of feature.routes) {
      const existing = index.get(route)
      if (existing) {
        clashes.push(`${route} is claimed by both "${existing.key}" and "${feature.key}"`)
        continue
      }
      index.set(route, feature)
    }
  }
  // A route claimed twice is not a cosmetic duplicate: the gate would resolve
  // it to whichever feature happened to be listed first, so the OTHER
  // feature's toggle would appear in the admin screen and control nothing.
  // Failing loudly at load turns that into a build failure instead of a
  // permission that silently does not apply.
  if (clashes.length) {
    throw new Error(`WhatsApp feature catalogue: each gateway route must belong to exactly one feature. ${clashes.join("; ")}`)
  }
  return index
})()

export function featureForRoute(route: string): WhatsAppFeature | null {
  // `route` is the full catalogue template, e.g. "POST /sessions/{id}/start" -
  // method included. Taking method and path separately invited exactly one
  // bug: a caller that already had the combined string passed it as the path
  // and produced "POST POST /sessions", which matched nothing and refused
  // every call. One argument, one shape.
  const needle = route.trim().replace(/\s+/g, " ")
  return ROUTE_TO_FEATURE.get(needle) ?? null
}

export const RISK_LABEL: Record<FeatureRisk, string> = {
  standard: "Standard",
  elevated: "Elevated",
  high: "High risk",
  destructive: "Destructive",
}
