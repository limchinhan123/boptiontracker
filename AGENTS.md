<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Learned User Preferences

- Prefer numbered, step-by-step setup and CLI guidance over terse or assumption-heavy instructions; the user gets unstuck faster with explicit “do this next” ordering.
- Do not paste API tokens, bot tokens, or other secrets into chat; use Terminal or provider UIs only and rotate credentials if they were exposed.
- **Deploy / push:** Before `git push` or `npx convex deploy` (prod), give a short summary of user-visible changes (UI, routes, env expectations). Do not push or deploy on the user’s behalf until they confirm—**unless** they explicitly ask to deploy in that message (e.g. “deploy it”, “push to prod”). When they explicitly deploy, a brief recap before running commands is still fine.
- **Milestone / handoff:** Use `docs/CLOSEOUT.md` for lint, build, Convex `tsc`, prod env verification, and optional git tags; README links to it under “Maintenance & close-out”.
- Prefer the dashboard to load on open/reload (and after user actions) with **event-driven** Convex live-sync when the tab is open—not fixed-interval polling—to keep Vercel and Convex reads low.
- Prefer **Account snapshots** and **Weekly coach** collapsed by default on mobile (tap header to expand); desktop keeps them open.
- For monetary values on the dashboard, show an explicit minus sign on negatives (not only red styling).
- Confirm before bulk Convex trade-log changes; produce a proposed fix list and wait for approval before applying patches, deletes, or mass worthless marks.
- For ad-hoc P&L storytelling canvases, prefer H1 + callout + stat row + card layout over stripped hero-only redesigns.

## Learned Workspace Facts

- The project directory name includes a space: `Cursor project` under `Documents`. Shell commands must quote the path (e.g. `cd "/Users/brandonlim/Documents/Cursor project"`) or escape the space.
- `DASHBOARD_SECRET` and `INGEST_SECRET` are set in the Convex dashboard **and** duplicated in `.env.local` for Next.js; Convex does not push those values into the local app automatically. The Convex deployment selected in the dashboard must match `NEXT_PUBLIC_CONVEX_URL`, or dashboard queries return Unauthorized. `.env.local` is a dotfile—show hidden files in macOS Open dialogs (Command–Shift–period); open it from the editor, not Finder double-click.
- For this app, `OPENAI_API_KEY` plus optional `OPENAI_COACH_MODEL` / `OPENAI_VISION_MODEL` are set in the Convex dashboard only, not in `.env.local`. Coach and snapshot OCR default to `gpt-4o` when overrides are unset.
- Web dashboard login uses the same string as `DASHBOARD_SECRET` (not a separate password). Vercel production uses project env vars, not `.env.local`; redeploy after changing them.
- Production deployment: `https://boptiontracker.vercel.app` (Vercel project `boptiontracker`). `git push origin main` triggers Vercel; when Convex schema/functions change, also run `npx convex dev --once` (or prod deploy) against the deployment that matches `NEXT_PUBLIC_CONVEX_URL`. GitHub HTTPS push needs a personal access token (or `gh auth login`), not the account password. Helper scripts: `npm run telegram:set-webhook` (needs `PUBLIC_APP_URL` in `.env.local`); `npm run vercel:push-env`; `npm run convex:sync-secrets` / `convex:sync-secrets:prod`.
- **Telegram ingest:** uncaptioned trade screenshots → trade OCR; photo + case-insensitive caption `balance` or `position` (optional `/snapshot` prefix) → account snapshot OCR (`lib/parse-snapshot-caption.ts`).
- **Trade hygiene / IBKR:** `scripts/import-ibkr-transactions.mjs` is an options-only importer for IBKR Transaction History CSV; it dedupes by `date|underlying|expiration|strike|side|qty|price` match key and must be run with `--dry-run` first for review before importing; reconcile via guided cleanup (user supplies Activity/Flex CSV + dashboard export; propose fixes before applying). PortfolioAnalyst PDF Trade Summary is aggregated by contract (cross-check only, not row-level). Worthless expirations have no IBKR close screen—patch the existing OPEN row via `updateTrade` (`lib/worthless-pnl.ts`): set `realizedPnl`, `pnlDate` to expiration, clear `needsReview`, append `Expired worthless — no IBKR fill`; do not create a separate close row. Monthly P&L uses `pnlDate ?? createdAt` (expiration/close date, not ingest date). Button after expiration strictly past (UTC). Guardrail `hasCloseMatchForHide` skips when a matching close exists (plain **BUY** counts as close).
- Dashboard data: full fetch on mount/reload/filter apply and after edits; **no interval polling**. While `/dashboard` is open, a Convex `dashboardFeed` version subscription (`use-dashboard-live-sync.ts`) refreshes after Telegram trade/snapshot ingest; tab hidden defers refresh until visible. **OpenAI** runs only on weekly coach **Generate review**, not on dashboard refresh. Ad-hoc cumulative P&L charts use the same `pnlDate ?? createdAt` bucketing as `convex/trades.ts` stats; for turnaround arcs, chart P&L-active calendar days only (omit zero-P&L days and flat tail after last activity)—totals still match dashboard MTD.
- Weekly coach logic version is `COACH_LOGIC_VERSION` in `lib/coach-version.ts` (currently **4**); bump when coach payload/rules change. Default profile focuses options margin/concentration, not whole-portfolio stock MTM. `weeklyReviews` stores narrative + rolling memory markdown (exportable); health UI flags stale/generic memory; **Start fresh** archives prior reviews—it does not wipe trade data.
- Trade table has a sortable **Expiration** column (second column); strike stays under **Underlying**. IBKR **position** snapshots (Telegram caption `position`) supply portfolio greeks for desk-style VIX stress sketches; treat badly OCR’d greek fields as unreliable.
- Recharts tooltips: treat values as possibly undefined for typecheck. On the month composed chart, detect P&L via `item.dataKey === "pnl"` (series `name` is `"P&L"`); format negatives with `formatMoney` and red styling, not as trade count.
