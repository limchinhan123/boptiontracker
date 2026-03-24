/**
 * Upload selected env vars from .env.local to a Vercel project (production + preview).
 *
 * One-time setup:
 *   1. Create a token: https://vercel.com/account/tokens
 *   2. Vercel dashboard → your project → Settings → General → copy Project ID (optional if you use name below)
 *
 * Run (from repo root):
 *   export VERCEL_TOKEN="..."           # required
 *   export VERCEL_PROJECT_NAME="boptiontracker"   # project name in URL, OR use VERCEL_PROJECT_ID
 *   # If the project is under a team (not personal):
 *   # export VERCEL_TEAM_ID="team_xxxxxxxx"
 *   npm run vercel:push-env
 *
 * Then redeploy on Vercel (Deployments → … → Redeploy) so new env applies.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Names that Next.js /api needs on Vercel (matches app code + Convex client). */
const KEYS_TO_PUSH = [
  "NEXT_PUBLIC_CONVEX_URL",
  "DASHBOARD_SECRET",
  "INGEST_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
];

function loadEnvLocal() {
  const envPath = resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) {
    console.error("Missing .env.local at", envPath);
    process.exit(1);
  }
  const raw = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function varType(key) {
  if (key.startsWith("NEXT_PUBLIC_")) return "plain";
  return "encrypted";
}

async function main() {
  const token = process.env.VERCEL_TOKEN;
  const projectId =
    process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME;
  const teamId = process.env.VERCEL_TEAM_ID || "";

  if (!token) {
    console.error(
      "Set VERCEL_TOKEN (create at https://vercel.com/account/tokens)",
    );
    process.exit(1);
  }
  if (!projectId) {
    console.error(
      "Set VERCEL_PROJECT_NAME (e.g. boptiontracker) or VERCEL_PROJECT_ID from Vercel → Settings → General",
    );
    process.exit(1);
  }

  const env = loadEnvLocal();
  const missing = KEYS_TO_PUSH.filter((k) => !env[k]?.length);
  if (missing.length) {
    console.error("Missing values in .env.local for:", missing.join(", "));
    process.exit(1);
  }

  const base = `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`;
  const qs = new URLSearchParams({ upsert: "true" });
  if (teamId) qs.set("teamId", teamId);

  for (const key of KEYS_TO_PUSH) {
    const value = env[key];
    const type = varType(key);
    const url = `${base}?${qs}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
        type,
        target: ["production", "preview"],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`Failed ${key}:`, res.status, JSON.stringify(body));
      process.exit(1);
    }
    console.log("OK", key);
  }

  console.log("\nDone. Redeploy on Vercel so the new env is picked up.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
