# EasyLife WhatsApp Demo Bridge (QR Demo Connection)

**This is a temporary, isolated demo tool. It is NOT the production WhatsApp
integration.** Production uses the official WhatsApp Business Cloud API
(`src/lib/integrations/whatsapp/`, `/api/webhooks/whatsapp`) - completely
untouched by this tool. This entire `tools/whatsapp-demo-bridge/` folder can
be deleted at any time without affecting the dashboard or production.

It exists to demo a WhatsApp conversation flow live, using `whatsapp-web.js`
(an unofficial WhatsApp Web automation library) instead of the Cloud API,
which requires a Meta Business verification/approval process the demo can't
wait for.

## What it does

A small local Node service, currently configured for **MeriteShop / Merit
Cables**, chatbot identity **"Pluggy"** (`DEMO_CLIENT=meriteshop`):
1. Opens a WhatsApp Web session (via a headless browser) and exposes its QR
   code to the dashboard.
2. Once you scan it with a phone, listens for inbound text messages.
3. For product/price questions, looks up the **structured, synced product
   catalog** (`data/meriteshop-products.json`) first - real current prices,
   never numbers frozen in the system prompt. Falls back to a small
   keyword-based knowledge-base lookup (`demo-knowledge/meriteshop/*.md`) for
   everything else (offices, policies, FAQs, etc).
4. Generates the reply via an AI provider (Gemini or local Ollama) as
   **Pluggy** - the customer never sees "EasyLife" (the platform behind it).
5. Tracks a simple, rule-based MeriteShop purchase-lead score per
   conversation.

The bridge is single-tenant (one WhatsApp session = one client at a time).
The previous EasyLife-branded demo knowledge is preserved under
`demo-knowledge/easylife/` - switch back by setting `DEMO_CLIENT=easylife`
in `.env` (note: the structured product-catalog lookup is MeriteShop-
specific and won't apply to a different client without its own catalog).

## Setup (run this on the Mac doing the demo)

```bash
cd tools/whatsapp-demo-bridge
npm install
cp .env.example .env
npm run sync:meriteshop   # pulls the live current MeriteShop catalog - run this before every demo
```

Edit `.env`:
- `DEMO_RAG_AI_PROVIDER=ollama` is the default - **Gemini's EasyLife platform
  key is currently returning "prepayment credits are depleted" (HTTP 429)**,
  so use Ollama unless that's been resolved before the demo.
- If using Ollama: run `ollama list` first to see what's already pulled, and
  set `OLLAMA_MODEL` to one of those exact names. This bridge will NOT
  download a model for you.
- If using Gemini: set `GEMINI_API_KEY` and `DEMO_RAG_AI_PROVIDER=gemini`.

Start it:

```bash
npm start
```

You should see it print the client workspace/brand/assistant identity, AI
provider, model, knowledge-chunk count, product-catalog count + last sync
time, and start listening on `http://localhost:4001` (or whatever `PORT` you
set).

## Refreshing the catalog before a demo

```bash
npm run sync:meriteshop
```

Fetches the live public MeriteShop product catalog (Shopify's own
`products.json` storefront feed - no admin/private API access, no customer
or order data) and writes `data/meriteshop-products.json`. Safe by design: a
failed sync (network down, site change) always leaves the last good
snapshot in place and prints an honest error - it never silently wipes data
before a demo. The bridge re-reads this file automatically (no restart
needed) whenever it changes.

## Run the dashboard alongside it

Run the dashboard **locally** (`npm run dev` from the repo root, not the
`https://dashboard.easylife.com.pk` production site) on the same Mac during
the demo - a browser page loaded over HTTPS cannot call an `http://localhost`
API (mixed-content blocking), but `http://localhost:3000` calling
`http://localhost:4001` works fine.

Open **Client Mode → WhatsApp** - the "QR Demo Connection" card there talks
directly to this bridge's API from the browser.

## Demo flow

1. Card shows "Connect Demo WhatsApp" → click it (or it's already
   initializing on bridge startup).
2. A QR code appears → scan it with WhatsApp on a phone (Linked Devices →
   Link a Device).
3. Card switches to "WhatsApp Connected" once `ready`.
4. Send a WhatsApp message to that phone from a different number → the bot
   replies using the knowledge base + AI provider, and the card shows the
   last inbound message, last AI reply, and current lead score live.

## Editing the knowledge base before the meeting

Just edit/add `.md` files in `demo-knowledge/`. They're loaded once at
startup; call `POST /reload-knowledge` (or restart the bridge) to pick up
changes without a full reconnect.

## Safety switches

- `DEMO_WHATSAPP_ALLOWED_NUMBERS` (comma-separated, digits only) - if set,
  only those numbers get auto-replies; everyone else's messages are still
  observed/logged but never answered. Leave blank while testing with your
  own second number, consider setting it before the actual client call if
  you want to control exactly who the bot can respond to.
- `DEMO_WHATSAPP_AUTO_REPLY=false` (or the dashboard card's toggle) - stops
  the bot from sending anything, while still showing what it *would* have
  replied, in the dashboard.

## What's NOT persisted anywhere real

Conversation history, qualification state, and lead scores live in the
bridge process's memory only - lost on restart. Nothing is written to the
production PostgreSQL database. The only thing persisted to disk at all is
the WhatsApp session itself, under `.wwebjs_auth/` (gitignored, local-only)
so you don't have to re-scan the QR every time you restart the bridge.
