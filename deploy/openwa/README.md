# EasyLife OpenWA Gateway

The persistent WhatsApp service behind `wa.easylife.com.pk`. The dashboard
talks to it over HTTPS; it talks to WhatsApp over Baileys' **NOWEB** engine —
a direct WebSocket implementation of WhatsApp's multi-device protocol.

There is **no browser** in this service: no Puppeteer, no Chromium, no
`whatsapp-web.js`, no page scraping. That is what NOWEB means, and it is why
this image is a plain `node:20-slim` rather than a browser image.

## Why this is a separate service

A paired WhatsApp session is a socket that must stay open between requests
and hold credentials in memory. The EasyLife dashboard runs on cPanel under
Passenger, where handlers are request-scoped and the process can be recycled
at any time. **cPanel cannot host this** — not a limitation of the code, a
property of the runtime. So the gateway runs on its own host and the
dashboard calls it.

```
Customer's phone
      ↓  WhatsApp
OpenWA gateway (this service, Baileys NOWEB)   ← wa.easylife.com.pk
      ↓  signed webhook
EasyLife dashboard  /api/webhooks/openwa       ← dashboard.easylife.com.pk
      ↓
Postgres → RAG → AI reply → back out through the gateway
```

## What you need before deploying

- A host that can run Docker and keep a process alive (any small VPS; 1 vCPU
  / 1 GB is enough for a handful of sessions).
- A DNS **A record** pointing `wa` at that host's public IPv4 address:

  ```
  wa    A    <YOUR_SERVER_IP>
  ```

  The IP is whatever your VPS provider assigned — this repo does not and
  cannot know it. Caddy will not be able to obtain a certificate until this
  record resolves publicly.
- Ports 80 and 443 reachable from the internet (Let's Encrypt validation).

## Deploy

```bash
cp .env.example .env
# fill in OPENWA_API_KEY, OPENWA_WEBHOOK_SECRET, DASHBOARD_WEBHOOK_URL
#   openssl rand -hex 32     # run twice, once per secret

# put the real hostname in the Caddyfile if it is not wa.easylife.com.pk
docker compose up -d --build
docker compose logs -f openwa
```

Verify it is up (from the gateway host):

```bash
curl -s -H "X-Api-Key: $OPENWA_API_KEY" https://wa.easylife.com.pk/health
# {"ok":true,"engine":"baileys-noweb","uptimeSeconds":12}
```

A request without the header must return `401`. If it does not, stop and fix
that before pairing a phone.

## Connect it to the dashboard

1. In the dashboard: **Integrations → WhatsApp (OpenWA / Baileys NOWEB)**.
2. Enter the gateway base URL (`https://wa.easylife.com.pk`), the same
   `OPENWA_API_KEY`, and the same `OPENWA_WEBHOOK_SECRET`.
3. **Test Connection** — this hits `/health` only. It never sends a message
   and never disturbs a live pairing, so it is free and safe to repeat.
4. Activate the provider, then pair a phone from the WhatsApp page.

## API

Every route requires `X-Api-Key`. Session ids are chosen by the dashboard
(derived there from the workspace id) and validated here against
`^[A-Za-z0-9_-]{4,64}$` before touching the filesystem.

| Method | Path                             | Purpose                                       |
| ------ | -------------------------------- | --------------------------------------------- |
| GET    | `/health`                        | Liveness + API key check                      |
| GET    | `/sessions/:id`                  | Current state, including the pairing QR        |
| POST   | `/sessions/:id/start`            | Bring the session up (idempotent)              |
| POST   | `/sessions/:id/logout`           | End the session and clear its credentials      |
| POST   | `/sessions/:id/messages`         | `{ "to": "923001234567", "text": "..." }`      |

`status` is one of `disconnected`, `connecting`, `qr`, `connected`, `error`.

A send returns `{ "ok": true, "id": "<wamid>" }` only when WhatsApp actually
assigned an id. If it did not, the gateway returns an error rather than a
synthesized id — so the dashboard can never display "sent" for a message
WhatsApp never accepted.

## Webhooks out

Every delivery to `DASHBOARD_WEBHOOK_URL` is signed:

```
X-OpenWA-Signature: sha256=<hex HMAC-SHA256 of the exact request body>
```

computed with `OPENWA_WEBHOOK_SECRET`. The dashboard recomputes it over the
raw body and rejects a mismatch with `401`. Two event shapes are sent:

```jsonc
{ "event": "message", "sessionId": "ws_…",
  "message": { "id": "…", "from": "923001234567", "pushName": "Ali",
               "type": "text", "text": "…", "fromMe": false, "timestamp": 0 } }

{ "event": "session.status", "sessionId": "ws_…",
  "session": { "status": "connected", "connectedNumber": "923001234567", "error": null } }
```

Group chats, broadcasts and status updates are dropped at the gateway.
History-sync batches are ignored (`type !== "notify"`), so re-pairing a phone
does not replay old conversations into the lead pipeline.

## Operating notes

- **`openwa-sessions` is the volume that matters.** It holds paired
  credentials. Back it up; losing it means every workspace re-scans a QR.
- **Reconnects are bounded** — exponential backoff up to
  `MAX_RECONNECT_ATTEMPTS` (default 8), then the session parks in `error`.
  An unbounded retry loop against WhatsApp's servers is how a number gets
  rate-limited.
- **A logout from the phone is terminal.** The gateway does not retry it;
  pairing again needs a new QR.
- **Nothing sensitive is logged.** No message bodies, no credentials, no QR
  strings — recipient numbers and status codes only.

## Secrets

`.env` is not committed and must never be. Both secrets are 32-byte random
values; rotate them by updating `.env`, restarting the gateway, and saving
the new values in the dashboard's Integrations page. Rotation does not
unpair any phone.

## Compliance note, stated plainly

Baileys is an unofficial implementation of WhatsApp's protocol. It is not
endorsed by WhatsApp or Meta, and using it carries a real risk that the
paired number is restricted or banned — a risk the official Cloud API does
not carry. That trade-off (no Meta Business verification, no per-message
fee, versus that risk) is a business decision, not a technical one. The
dashboard keeps the Cloud API transport fully working alongside this one, so
switching a workspace over later is a configuration change, not a rewrite.
