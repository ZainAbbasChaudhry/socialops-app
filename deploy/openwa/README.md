# Running OpenWA as EasyLife's WhatsApp gateway

EasyLife does not ship a WhatsApp gateway. It talks to **OpenWA**, an
independent open-source project, over its HTTP API.

> **What used to be here.** This folder previously held a small Baileys
> gateway written for EasyLife as a stand-in while the integration was being
> built. It has been removed. EasyLife now speaks the real OpenWA contract —
> 61 capabilities covering all 196 of its operations — so running a
> home-grown substitute would mean reimplementing all of it, badly. Nothing
> in the dashboard references the old gateway any more.

- Project: OpenWA (`openwa`), MIT licensed.
- EasyLife adopts its **capability surface** only. All branding, UI, copy and
  product design in the dashboard are EasyLife's own.
- The MIT licence requires the copyright notice to travel with any
  redistribution. If you ship OpenWA (in an image, a bundle, an appliance),
  ship its `LICENSE` file with it.

---

## 1. The engine setting — read this first

OpenWA supports two engines, chosen with `ENGINE_TYPE`:

| `ENGINE_TYPE` | What it is | For EasyLife |
| --- | --- | --- |
| `whatsapp-web.js` | **OpenWA's default.** Drives a real Chromium through Puppeteer. | **Do not use.** |
| `baileys` | A direct WebSocket client. No browser, no Chromium. | **This is the one.** |

**`ENGINE_TYPE=baileys` must be set explicitly.** Leaving it unset gives you
the Puppeteer engine, which EasyLife's requirements rule out. This is the
single most important line in the gateway's configuration, and the easiest to
forget, because it is the default that is wrong for us rather than a missing
value that would fail loudly.

The engine a workspace is configured for in EasyLife
(**WhatsApp → Capabilities → Engine**) must match the gateway's
`ENGINE_TYPE`. Capabilities that exist on only one engine are refused by the
feature gate on the other, with the reason named.

---

## 2. Where it can run

**Not on the cPanel host.** A paired WhatsApp session is a socket that must
stay open between requests and hold credentials in memory. Passenger gives
request-scoped, recyclable processes. That is a property of the runtime, not
something configuration can work around.

A small always-on VPS is enough. Budget for persistent disk: session
credentials and media live on it, and losing that volume unlinks every
paired number.

---

## 3. Stand it up

```bash
git clone https://github.com/<the OpenWA repository> openwa
cd openwa
cp .env.example .env
```

Then edit `.env`. The values EasyLife depends on:

```ini
ENGINE_TYPE=baileys          # NOT the default - see section 1
PORT=2785                    # EasyLife's base URL points at this
BAILEYS_AUTH_DIR=./data/baileys

# Anything durable. SQLite is fine for one workspace; Postgres for more.
DATABASE_TYPE=postgres
DATABASE_HOST=...
DATABASE_NAME=openwa

STORAGE_TYPE=local
STORAGE_LOCAL_PATH=./data/media

AUTO_START_SESSIONS=true     # sessions come back by themselves after a restart
```

Bring it up with its own compose file:

```bash
docker compose up -d
```

It listens on `127.0.0.1:2785` by default — deliberately not on a public
interface. Put a TLS terminator (Caddy, nginx, your provider's load
balancer) in front of it and give it a hostname such as
`wa.easylife.com.pk`. EasyLife will not accept a plaintext gateway URL for a
live workspace, and it should not: the API key travels on every request.

---

## 4. Create the API key EasyLife will use

OpenWA manages keys at `/api/auth/api-keys`. The plaintext key is returned
**once, at creation** — if you lose it, revoke it and make another.

Give EasyLife a key that is **not session-scoped**, because EasyLife creates
and names the session itself, per workspace.

Store it only in EasyLife's Integrations screen, where it is encrypted at
rest (AES-256-GCM, per workspace). Never in the repository, a screenshot, or
a chat message.

---

## 5. Point EasyLife at it

**Integrations → WhatsApp (OpenWA / Baileys NOWEB)**

| Field | Value |
| --- | --- |
| Gateway base URL | `https://wa.easylife.com.pk` — no `/api` suffix; EasyLife adds it |
| Gateway API key | the key from step 4, sent as `X-API-Key` on every call |
| Webhook signing secret | any high-entropy string; the same one on both sides |

Then **Test Connection**. It calls `GET /health` and nothing else — it never
sends a message and never disturbs a live pairing. A successful test is what
unlocks Live mode.

### Webhook back to EasyLife

Register a webhook in OpenWA pointing at:

```
https://dashboard.easylife.com.pk/api/webhooks/openwa
```

with the same signing secret. OpenWA signs each delivery as
`X-OpenWA-Signature` (HMAC-SHA256 over the raw body). EasyLife verifies it in
constant time before trusting anything in the payload — the session id inside
the body is only a hint about *which* workspace's secret to check with.

---

## 6. Pair a number

In EasyLife: **WhatsApp → Connection → Connect**. Two ways, and a workspace
sees only the ones it is entitled to:

- **QR code** — scan from WhatsApp → Linked devices. The QR is fetched on
  demand, passed straight to the browser that asked, and never stored or
  logged.
- **Pairing code** — an 8-character code typed into the phone, for when
  nobody can point a camera at the screen.

The session's name is derived server-side from the workspace
(`deriveSessionId`) and is never read from a request, so one workspace cannot
address, inspect or unlink another's number. The status becomes `connected`
only when the gateway reports the socket is actually open — never because a
connect request was accepted.

If the gateway's volume is ever replaced, EasyLife re-creates the session on
its next call rather than failing forever on a session id the gateway has
forgotten.

---

## 7. Decide what the client may do

**WhatsApp → Capabilities.** 61 capabilities, grouped, each mapped to the
gateway routes it authorises. Turning one off removes it server-side — a
crafted API request is refused exactly as the UI is.

Only an EasyLife platform operator (`PLATFORM_ADMIN_EMAILS`) can change them.
A client sees the same screen read-only.

Start from the recommended set. **Bulk campaigns is off by default and should
stay off** unless the client genuinely has permission to message the people
on their list — WhatsApp restricts and bans numbers for this, and it is the
client's own number at risk.

---

## 8. Verify end to end

Message the paired number from a different phone. Expect, in order:

1. a row in `whatsapp_messages` (inbound)
2. a lead in the CRM with source `whatsapp`
3. a bot reply, stored with `provider_status = 'sent'`

A reply row saying `failed` is the truth being recorded, not a display bug —
the gateway rejected the send. Check the gateway's logs.

---

## Operating notes

- **Back up the session volume.** Losing it unlinks every paired number and
  every client has to scan again.
- **One number per workspace.** EasyLife keys the account on
  `(workspace, provider)`.
- **Never log** API keys, webhook secrets, QR strings, pairing codes or
  message bodies. EasyLife does not; keep the gateway's log level in line.
- **Upgrades:** OpenWA is an independent project on its own release
  schedule. Read its changelog before upgrading — EasyLife's capability
  catalogue is pinned to the routes described in
  `src/lib/integrations/whatsapp/feature-catalog.ts`, and a route that moves
  will be refused by the gate (fail-closed) until the catalogue is updated to
  match. That is the intended behaviour, not a fault.
