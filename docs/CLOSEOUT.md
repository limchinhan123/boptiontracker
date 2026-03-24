# Project close-out checklist

Use this when wrapping a milestone, before a long break, or when handing the repo to someone else.

## Code & repo

1. **`npm run lint`** and **`npm run build`** — both must pass on `main`.
2. **`npx tsc --noEmit -p convex/tsconfig.json`** — Convex TypeScript is clean.
3. Search for **`TODO`**, **`FIXME`**, **`debugger`**, and noisy **`console.log`** in `app/` and `convex/`; remove or file an issue.
4. **`npm outdated`** (optional) — note major upgrades for later; avoid risky upgrades during close-out unless needed.
5. Merge or delete **stale git branches**; keep **`main`** deployable.
6. Confirm **`.env.local`** is not committed and **`.env.example`** is up to date.

## Production

7. **Convex** (production deployment): `OPENAI_API_KEY`, `INGEST_SECRET`, `DASHBOARD_SECRET` set; deployment matches **`NEXT_PUBLIC_CONVEX_URL`** on Vercel.
8. **Vercel**: env vars complete; latest deployment **Ready**; redeploy after env changes.
9. **Telegram**: `PUBLIC_APP_URL` and **`npm run telegram:set-webhook`** point at the **production** HTTPS URL if the bot is live.
10. **Rotate secrets** if anything was pasted into chat, tickets, or logs.

## Documentation

11. **README.md** — Features, setup, and env table still match reality.
12. **AGENTS.md** — Workspace facts and preferences (e.g. deploy preview before push) for AI assistants.
13. **This file** — Adjust bullets if your runbook changes.

## Optional

14. **Git tag**: `git tag -a v1.0.0 -m "Milestone"` and `git push origin v1.0.0` for a named snapshot.
15. **Convex data** — If trades are the system of record, plan exports or backups per your risk tolerance.

## After “close-out”

Commits do **not** freeze the repo. Continue on `main` with new features anytime; tags and history preserve earlier states.
