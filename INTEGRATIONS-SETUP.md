# One-click integrations: what EasyLife has to do once

The product rule is that a client never does technical work. They open
Integrations, press **Integrate**, sign in, and the connection configures,
tests and switches itself on.

That is possible for everything except one thing, and this file is about
that one thing.

## The single unavoidable step

An OAuth provider will not let an application connect on a client's behalf
unless the *application* is registered with that provider first. That
registration belongs to EasyLife, once, for all clients — not to each
client. Until it exists, the only alternative is for every business to
create their own Google Cloud project, which is exactly the experience this
design exists to prevent.

So: register EasyLife's own app with each provider, and put its credentials
in the server environment.

```
# Google — covers Sheets, Calendar and Gmail (one app, three scopes)
GOOGLE_PLATFORM_CLIENT_ID=...
GOOGLE_PLATFORM_CLIENT_SECRET=...

# Meta — covers Facebook Pages and Instagram
META_PLATFORM_CLIENT_ID=...
META_PLATFORM_CLIENT_SECRET=...
```

The dashboard checks these at runtime. If they are set, the client sees one
button. If they are not, the card says so in plain words rather than
offering a button that leads to a developer console — nothing pretends to be
one-click when it cannot be.

Add the callback URL to each provider's app configuration:

```
https://<your-domain>/api/oauth/<provider>/callback
```

…where `<provider>` is `google-sheets`, `google-calendar`, `gmail`,
`facebook`, `linkedin`, `tiktok`, `x` or `youtube`.

## What happens after the client presses Integrate

| Provider | What the client does | What the system then does on its own |
| --- | --- | --- |
| Google Sheets | Sign in, allow | Finds or creates "EasyLife CRM - Leads", writes the header row, maps all thirteen columns, tests, activates. Leads and their meetings sync into it from then on. |
| Google Calendar | Sign in, allow | Selects the primary calendar and reads its real timezone, tests, activates. The WhatsApp bot can then offer genuinely free slots and book them with reminders. |
| Gmail | Sign in, allow | Confirms which address it will send as, tests, activates. |
| Facebook | Sign in, allow | If the account manages exactly one Page, connects it, links any Instagram account on it, and subscribes to comment webhooks. More than one Page is the one case it asks — guessing which Page a business posts as is not a decision to make for them. |
| WhatsApp | Scan a QR code | The gateway session, the webhook and its signing secret are all handled server-side. |
| AI model | Paste one key (or a server URL) | Tests it, activates it, and makes it the model the whole CRM uses — WhatsApp replies, lead qualification, summaries, the inbox assistant. |
| Custom API | Address, how it authenticates, key | Calls it and reports whether it answered. |

## What it will not do

- Activate anything on a test that did not pass. A key the provider rejects
  leaves the connection saved and switched off, showing the provider's own
  message.
- Overwrite a choice the client already made. Reconnecting keeps the sheet
  and the calendar they had chosen.
- Claim a step it did not complete. A connection that authorized but could
  not finish its setup shows amber and says what is outstanding.

## When a connection breaks

Tokens expire and access gets revoked. When a refresh genuinely runs out of
road, the connection is marked expired automatically — the card turns amber
and offers **Reconnect**, which is the same one click as the first time.
Nothing waits for the client to notice that things quietly stopped working.
