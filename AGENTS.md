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

## Learned Workspace Facts

- The project directory name includes a space: `Cursor project` under `Documents`. Shell commands must quote the path (e.g. `cd "/Users/brandonlim/Documents/Cursor project"`) or escape the space.
- `DASHBOARD_SECRET` and `INGEST_SECRET` are set in the Convex dashboard **and** duplicated in `.env.local` for Next.js; Convex does not push those values into the local app automatically.
- `.env.local` is a dotfile; macOS Open dialogs often hide it until hidden files are shown (e.g. Command–Shift–period). Double‑clicking it in Finder may show “no application” — open it from the editor (Quick Open / Open With) instead.
- For this app, `OPENAI_API_KEY` is set in the Convex dashboard only, not in `.env.local`.
- Web dashboard login uses the same string as `DASHBOARD_SECRET` (not a separate password).
