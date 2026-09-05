# Run the dashboard on localhost

```bash
./scripts/local-dev.sh
```

Then open **http://localhost:3000**.

| | |
| --- | --- |
| Email | `owner@easylife.local` |
| Password | `EasyLife!Local2026` |

Change them by setting `LOGIN_EMAIL` / `LOGIN_PASSWORD` before the first run —
after that the account exists in the database and the script leaves it alone.

## What the script does

1. Checks Node is 20 or newer.
2. Starts Postgres in Docker (`deploy/local/docker-compose.yml`, host port
   **5433** so it can't collide with a Postgres you already run).
3. Writes `.env.local` with freshly generated secrets — **only if one doesn't
   already exist**.
4. `npm install` (first run only) and `npm run build`.
5. Applies `migrations/*.sql` through the app's own migration runner — the
   same code path production uses.
6. Creates the first owner account.
7. Serves on port 3000. `Ctrl-C` stops everything.

Re-running is safe. Every step is idempotent, and it never regenerates
`.env.local`: a new `AUTH_SECRET` would log everyone out, and a new
`INTEGRATIONS_ENCRYPTION_KEY` would make every saved credential permanently
undecryptable.

## Already have Postgres?

Skip Docker entirely:

```bash
DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/easylife_dev' ./scripts/local-dev.sh
```

An externally-set `DATABASE_URL` always wins.

## Demo Mode vs Client Mode

The toggle is top-right.

- **Client Mode** — the real dashboard, reading your local Postgres. This is
  what the script sets up.
- **Demo Mode** — fabricated sample data for showing the product. Nothing is
  sent anywhere.

If Client Mode is missing, `CRM_MODE=database` isn't set. The script writes
it; check `.env.local` if you edited it by hand.

## Notes

- `NODE_ENV` is `production` even locally. The script runs the same
  production build and the same `app.js` entry point that ships to cPanel,
  and Next won't prerender a production build under a `development`
  `NODE_ENV`. Browsers treat `http://localhost` as a trustworthy origin, so
  the Secure session cookie still works.
- **`GEMINI_API_KEY` is optional.** Without it the WhatsApp qualification bot
  still runs and still scores leads — it uses its built-in template replies
  instead of Gemini.
- **WhatsApp needs no setup to browse the dashboard.** To actually pair a
  phone you also need the OpenWA gateway running — see
  [`WHATSAPP-SETUP.md`](WHATSAPP-SETUP.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Docker isn't running and DATABASE_URL isn't set" | Start Docker Desktop, or pass your own `DATABASE_URL` |
| Port 3000 in use | `PORT=3001 ./scripts/local-dev.sh` |
| Login fails after re-running | You deleted `.env.local`; the new `AUTH_SECRET` invalidated old sessions. Just log in again |
| "Invalid credentials" on a fresh database | The owner account is created on first run only — check the script's output for whether it said "Created" or "already exists" |
| Want a clean slate | `docker compose -f deploy/local/docker-compose.yml down -v && rm .env.local` |
