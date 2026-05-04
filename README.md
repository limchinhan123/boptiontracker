<div align="center">
  <h1>Options Trade Dashboard 📈</h1>

  **An automated, AI-powered options trade journal and analytics dashboard.**

  [![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
  [![Convex](https://img.shields.io/badge/Convex-Backend-FF5A5F?logo=convex)](https://www.convex.dev/)
  [![OpenAI](https://img.shields.io/badge/OpenAI-Vision_LLM-412991?logo=openai)](https://openai.com/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
</div>

---

## 📖 Overview

**Options Trade Dashboard** solves the friction of manual trade journaling for options traders. Instead of manually entering legs, strikes, and premiums into a spreadsheet, you simply send a screenshot of your **Interactive Brokers (IBKR)** execution screen to a Telegram bot. 

The application automatically downloads the image, processes it through OpenAI's Vision models to extract structured trade data, saves it securely to a Convex database, and visualises your performance on a password-protected Next.js dashboard.

## ✨ Key Features

- **Automated Telegram Ingest:** Send an IBKR screenshot to your bot; the system handles image extraction, runs vision LLM parsing, and maps the output to a strict database schema.
- **AI-Powered Data Extraction:** Uses `gpt-4o` to reliably parse complex option legs, identifying underlying assets, option types (call/put), strikes, expirations, execution prices, fees, and Realized P&L.
- **Interactive Analytics Dashboard:** 
  - **Live Auto-Refresh:** The dashboard polls for new trades every 5 seconds.
  - **Visualizations:** View top underlyings by trade count, monthly trade volume, and P&L breakdowns via Recharts.
  - **Cumulative P&L:** A running cumulative P&L metric that dynamically updates based on your current table sort order.
- **Editable Trade Journal:** Flag ambiguous extractions for manual review (`needsReview`), edit any parsed field, and add custom strategy tags or notes directly from the UI.
- **Excel Export:** Download up to 500 filtered, sorted rows into a clean `.xlsx` workbook using `exceljs`, perfect for tax reporting or deeper spreadsheet analysis.

## 🛠️ Tech Stack

- **Frontend:** [Next.js](https://nextjs.org) (App Router), React 19, Tailwind CSS 4
- **Backend & Database:** [Convex](https://convex.dev) (for real-time queries, mutations, and Node-based server actions)
- **AI Integration:** [OpenAI](https://openai.com/) API (Vision + JSON Schema extraction)
- **Charts & Export:** [Recharts](https://recharts.org) and [ExcelJS](https://github.com/exceljs/exceljs)

## 🚀 Getting Started

### Prerequisites

- Node.js 20+ and npm
- A [Convex](https://dashboard.convex.dev) project
- A [Telegram Bot Token](https://core.telegram.org/bots/tutorial)
- An [OpenAI](https://platform.openai.com/) API key

### Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/limchinhan123/boptiontracker.git
   cd boptiontracker
   npm install
   ```

2. **Configure Environment Variables:**
   Copy the example environment file:
   ```bash
   cp .env.example .env.local
   ```
   *Note: Convex does not read `.env.local`. You must set `OPENAI_API_KEY`, `INGEST_SECRET`, and `DASHBOARD_SECRET` directly in the Convex dashboard for your deployment.*

3. **Start Convex (Terminal 1):**
   ```bash
   npx convex dev
   ```
   This syncs your schema and functions to the Convex dev cloud.

4. **Start Next.js (Terminal 2):**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000), log in using your `DASHBOARD_SECRET`, and navigate to `/dashboard`.

## 🤖 Telegram Webhook Configuration

To enable the automated screenshot pipeline, your app must be reachable via a public HTTPS URL (e.g., deployed on Vercel).

1. Set `PUBLIC_APP_URL` in `.env.local` to your live domain (e.g., `https://your-app.vercel.app`).
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in both `.env.local` and your production hosting environment.
3. Register the webhook by running:
   ```bash
   npm run telegram:set-webhook
   ```
4. Send a photo to your Telegram bot to trigger the ingest pipeline. *(Note: Text messages are ignored by the webhook).*

## 🔒 Security & Environment Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_CONVEX_URL` | Next.js (`.env.local`, Vercel) | Connects the client/server to your Convex instance. |
| `DASHBOARD_SECRET` | Next.js **&** Convex | The password to access the dashboard and secure API routes. |
| `INGEST_SECRET` | Next.js **&** Convex | Shared secret authenticating Telegram webhook calls to Convex. |
| `OPENAI_API_KEY` | **Convex Dashboard Only** | Used in `convex/ingest.ts` for vision extraction. |
| `TELEGRAM_BOT_TOKEN` | Next.js (Vercel) | Required to fetch images from Telegram. |
| `TELEGRAM_WEBHOOK_SECRET`| Next.js (Vercel) | Validates incoming requests from Telegram. |

*Helper scripts like `npm run convex:sync-secrets` are provided to push local secrets to your Convex dev environment.*

## 📚 Documentation & Maintenance

For ongoing maintenance, operations, and contributor guidelines, please refer to the internal documentation:
- [`AGENTS.md`](AGENTS.md): Learned preferences, workspace facts, and AI contributor rules.
- [`docs/CLOSEOUT.md`](docs/CLOSEOUT.md): Pre-deployment checklists, linting, secret rotation, and handoff procedures.

## 📄 License

All rights reserved. This is a private project unless an explicit `LICENSE` file is added.

---
*Repo: [github.com/limchinhan123/boptiontracker](https://github.com/limchinhan123/boptiontracker)*
