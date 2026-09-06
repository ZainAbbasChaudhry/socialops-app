# WhatsApp Setup

The dashboard supports **two independent WhatsApp transports**. A workspace
picks one; the rest of the system — inbox, qualification bot, lead scoring,
CRM, automations, Google Sheets — behaves identically either way, because
everything above `src/lib/integrations/whatsapp/transport.ts` is
transport-blind.

| | **OpenWA (Baileys NOWEB)** | **Meta Cloud API** |
| --- | --- | --- |
| How a number is connected | Scan a QR with the phone | Meta Business verification + WABA |
| Cost per message | None | Meta's conversation pricing |
| Approval needed | None | Meta business + app review |
| Runs on cPanel | **No** — needs its own always-on host | Yes |
| Risk | Unofficial protocol; the number can be restricted or banned | None — it is the official API |
| Provider id | `openwa` | `whatsapp` |
| Webhook | `/api/webhooks/openwa` | `/api/webhooks/whatsapp` |

Both are fully implemented and both stay working. Switching a workspace is a
configuration change in Integrations, not a code change.

---

## Option A — OpenWA gateway (Baileys NOWEB)

### 1. Stand the gateway up

EasyLife does not ship a gateway. It talks to **OpenWA** — an independent
MIT-licensed project — over its HTTP API. Full instructions in
[`deploy/openwa/README.md`](deploy/openwa/README.md).

In short: clone OpenWA onto a small always-on VPS, an `A` record for `wa`
pointing at it, then `docker compose up -d`.

> **Set `ENGINE_TYPE=baileys` in the gateway's `.env`.** OpenWA's own default
> is `whatsapp-web.js`, which drives Chromium through Puppeteer — ruled out
> for EasyLife. Nothing fails loudly if you forget; you simply get the wrong
> engine. It is the single most important line in that file.

**This cannot run on the cPanel host.** A paired WhatsApp session is a socket
that must stay open between requests and hold credentials in memory;
Passenger gives request-scoped, recyclable processes. That is a property of
the runtime, not something a code change can work around.

### 2. Point DNS at it

```
wa    A    <YOUR_OPENWA_SERVER_IP>
```

The IP is whatever your VPS provider assigned. Caddy cannot issue a
certificate until this resolves publicly. `easylife.com.pk` and
`dashboard.easylife.com.pk` are untouched by this record.

### 3. Configure the workspace

**Integrations → WhatsApp (OpenWA / Baileys NOWEB)**:

| Field | Value |
| --- | --- |
| Gateway base URL | `https://wa.easylife.com.pk` |
| Gateway API key | the same `OPENWA_API_KEY` from the gateway's `.env` |
| Webhook signing secret | the same `OPENWA_WEBHOOK_SECRET` |

Then **Test Connection**. It calls `GET /health` only — it never sends a
message and never disturbs a live pairing. A successful test is what unlocks
Live mode; the dashboard will not let a workspace go live on an untested
connection.

### 4. Pair the phone

**WhatsApp → Connection → Connect.** Two ways, and a workspace is offered
only the ones it is entitled to:

- **QR code** — scan from **WhatsApp → Linked devices**. The QR is fetched on
  demand, handed to the browser that asked, and never stored or logged.
- **Pairing code** — an 8-character code typed into the phone, for remote
  setup where nobody can point a camera at the screen.

The state becomes `connected` only when the gateway reports the socket is
actually open — never optimistically. If the gateway ever loses the session
(its volume is replaced, an idle session is pruned), EasyLife re-creates it
on the next call instead of failing forever on an id the gateway has
forgotten.

The session id is derived server-side from the workspace id
(`deriveSessionId`) and is never read from the request. One workspace cannot
address, inspect, or disconnect another's session.

### 5. Verify end to end

Message the paired number from a different phone. Expect, in order:

1. `whatsapp_messages` gains an inbound row
2. a lead appears in the CRM with source `whatsapp`
3. a bot reply is sent and stored with `provider_status = 'sent'`

If the reply row says `failed`, the gateway rejected the send — that is the
truth being recorded, not a display bug. Check the gateway's logs.

### 6. Decide what the client may do

**WhatsApp → Capabilities.** 61 capabilities covering all 196 OpenWA
operations, each mapped to the gateway routes it authorises. Turning one off
removes it server-side, so a crafted API request is refused exactly as the UI
is. Only an EasyLife platform operator (`PLATFORM_ADMIN_EMAILS`) can change
them; the client sees the same screen read-only.

Bulk campaigns is off by default and should stay off unless the client
genuinely has permission to message their list — it is their own number that
WhatsApp restricts.

---

## Option B — Meta WhatsApp Cloud API

Unchanged. **Integrations → WhatsApp Cloud API** takes the WABA ID, Phone
Number ID, access token, webhook verify token and Meta App secret. In the
Meta App Dashboard set the callback to
`https://dashboard.easylife.com.pk/api/webhooks/whatsapp` and the verify
token to the same string. See [`META-SETUP.md`](META-SETUP.md).

---

## Security model (identical for both)

- **Every inbound delivery is signature-verified before anything is trusted.**
  Meta signs with the workspace's App secret (`X-Hub-Signature-256`); the
  OpenWA gateway signs with the workspace's webhook secret
  (`X-OpenWA-Signature`). Both are HMAC-SHA256 over the raw body, compared
  in constant time. The session/WABA id inside the body is only a routing
  hint used to find *which* workspace's secret to check with.
- **Every delivery is idempotent.** `webhook_events(provider,
  external_event_id)` and `whatsapp_messages(conversation_id,
  external_message_id)` both reject a redelivery, so a retrying provider
  cannot double-charge a lead score or send a duplicate reply.
- **Credentials are AES-256-GCM encrypted per workspace** and resolved at
  send time, never carried through the automation engine's event context and
  never written to `automation_runs`.
- **Nothing is ever reported as sent without provider confirmation.** A send
  that returns no message id is recorded as `failed`.
- **Never logged:** access tokens, gateway API keys, webhook secrets, QR
  pairing strings, or message bodies.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Test Connection: "rejected this API key" | `OPENWA_API_KEY` differs between the gateway `.env` and Integrations |
| Webhook returns 401 | `OPENWA_WEBHOOK_SECRET` differs between the two, or a proxy is re-serializing the body |
| Webhook returns 404 | No OpenWA account for that session id — press Connect in the dashboard once first |
| Status stuck on `qr` | QR expired unscanned; press Connect again for a fresh one |
| Status `error`, "gave up reconnecting" | Reconnect budget exhausted (default 8). Check the gateway host's network, then press Connect |
| Everything works, then stops after a redeploy | The `openwa-sessions` volume was not persisted — every workspace must re-scan |
