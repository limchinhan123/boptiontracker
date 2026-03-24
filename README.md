# Options trade dashboard

Capture **Interactive Brokers (IBKR)** option trades from **Telegram** screenshots, extract structured fields with **OpenAI**, store them in **Convex**, and review them on a password-protected **Next.js** dashboard—with charts, sorting, monthly P&amp;L summaries, and **Excel export**.

## Features

- **Telegram ingest** — Send a screenshot to your bot; the app downloads the image, runs vision LLM extraction, and writes trade legs to Convex.
- **Dashboard** — Filter by underlying / “needs review”, edit fields (including realized P&amp;L), charts by underlying and by month, **sortable** table columns, running **cumulative P&amp;L** (follows current sort order).
- **Excel export** — `Download Excel` on the dashboard (authenticated); respects filters, up to 500 rows per export.
- **Convex backend** — Queries/mutations/actions for trades, ingest pipeline, and scheduled work.

## Tech stack

| Layer | Technology |
|--------|------------|
| App | [Next.js](https://nextjs.org) 16 (App Router), React 19, Tailwind CSS 4 |
| Backend | [Convex](https://convex.dev) (queries, mutations, Node actions for OpenAI) |
| Charts | [Recharts](https://recharts.org) |
| Export | [exceljs](https://github.com/exceljs/exceljs) |

## Prerequisites

- Node.js 20+ recommended  
- npm  
- A [Convex](https://dashboard.convex.dev) project  
- A [Telegram Bot](https://core.telegram.org/bots/tutorial) token  
- An [OpenAI](https://platform.openai.com/) API key (used from Convex)

## Quick start (local)

1. **Clone and install**

   ```bash
   git clone https://github.com/limchinhan123/boptiontracker.git
   cd boptiontracker
   npm install
   ```

2. **Environment** — Copy the example file and fill in values (never commit real secrets):

   ```bash
   cp .env.example .env.local
   ```

   See [Environment variables](#environment-variables) below.

3. **Convex** — In one terminal:

   ```bash
   npx convex dev
   ```

   This syncs functions, sets `NEXT_PUBLIC_CONVEX_URL` for dev, and opens the dashboard link. Set **Convex → Settings → Environment variables** for `OPENAI_API_KEY`, `INGEST_SECRET`, and `DASHBOARD_SECRET` (and keep the same secrets in `.env.local` for Next.js where noted).

4. **Next.js** — In another terminal:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), sign in at `/login` with `DASHBOARD_SECRET`, then open `/dashboard`.

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_CONVEX_URL` | Next.js (`.env.local`, Vercel) | Convex deployment URL for the browser and server Convex client |
| `DASHBOARD_SECRET` | Next.js **and** Convex | Dashboard login password; secures dashboard API routes and Convex dashboard-gated queries |
| `INGEST_SECRET` | Next.js **and** Convex | Shared secret so the Telegram webhook can call Convex ingest |
| `OPENAI_API_KEY` | **Convex dashboard only** | Vision + JSON extraction in `convex/ingest.ts` |
| `OPENAI_VISION_MODEL` | Convex (optional) | Defaults to `gpt-4o` |
| `TELEGRAM_BOT_TOKEN` | Next.js (Vercel) | Bot API token to fetch photos |
| `TELEGRAM_WEBHOOK_SECRET` | Next.js (Vercel) | Must match Telegram `setWebhook` `secret_token` |
| `PUBLIC_APP_URL` | `.env.local` (for script) | HTTPS origin, no trailing slash — used by `npm run telegram:set-webhook` |

Convex does not read `.env.local`. Duplicate `DASHBOARD_SECRET` and `INGEST_SECRET` in the Convex dashboard for the **same** deployment as `NEXT_PUBLIC_CONVEX_URL`, or dashboard/API calls will fail with unauthorized errors.

Helper: `npm run convex:sync-secrets` / `npm run convex:sync-secrets:prod` copies `DASHBOARD_SECRET` and `INGEST_SECRET` from `.env.local` to the Convex deployment the CLI targets (see script headers for details).

## Telegram webhook

After the app is reachable at a public **HTTPS** URL (e.g. Vercel):

1. Set `PUBLIC_APP_URL` in `.env.local` (e.g. `https://your-app.vercel.app`).
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in `.env.local` and in **Vercel** env for production.
3. Run:

   ```bash
   npm run telegram:set-webhook
   ```

4. Send a **photo** (screenshot) to the bot. Non-photo messages are ignored by the webhook handler.

Webhook path: `POST /api/telegram/webhook`.

## Production deploy

1. **Convex** — `npx convex deploy` to your production deployment; set production env vars in the Convex dashboard.
2. **Vercel** (or similar) — Connect the Git repo, set the same Next.js env vars as `.env.local`, ensure `NEXT_PUBLIC_CONVEX_URL` points at **production** Convex.
3. Re-run **`npm run telegram:set-webhook`** with `PUBLIC_APP_URL` set to the production site so Telegram hits the live webhook.
4. Redeploy the Next app after changing environment variables.

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and run |
| `npm run convex:dev` | Convex dev sync (or use `npx convex dev`) |
| `npm run telegram:set-webhook` | Register Telegram webhook from `.env.local` |
| `npm run convex:sync-secrets` | Push selected secrets from `.env.local` → Convex dev |
| `npm run convex:sync-secrets:prod` | Same for production Convex |
| `npm run vercel:push-env` | Push env to Vercel (requires `VERCEL_TOKEN`, etc.) |

## Repository layout (high level)

```
app/                 # Next.js App Router (pages, dashboard, API routes)
convex/              # Convex schema, trades, ingest, internal helpers
lib/                 # Session cookie helpers, Convex HTTP client
scripts/             # Webhook + env sync utilities
```

## Security notes

- Do not commit `.env.local` or API keys.
- Treat `DASHBOARD_SECRET` as the dashboard password; use a long random value.
- Rotate credentials if they are ever exposed in chat or logs.

## License

Private project unless you add a license file.
