/**
 * Registers your bot webhook with Telegram (setWebhook).
 *
 * Required in .env.local:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_WEBHOOK_SECRET
 *   PUBLIC_APP_URL   — your live Next.js origin, e.g. https://my-app.vercel.app (no trailing slash)
 *
 * Usage: npm run telegram:set-webhook
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");

function loadEnvLocal() {
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

async function main() {
  const env = loadEnvLocal();
  const token = env.TELEGRAM_BOT_TOKEN;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  let base = env.PUBLIC_APP_URL?.replace(/\/$/, "");

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is missing from .env.local");
    process.exit(1);
  }
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is missing from .env.local");
    process.exit(1);
  }
  if (!base) {
    console.error(
      "PUBLIC_APP_URL is missing from .env.local.\n" +
        "Add one line, for example:\n" +
        "  PUBLIC_APP_URL=https://your-deployment.vercel.app\n" +
        "(no trailing slash; must be the same host where /api/telegram/webhook is reachable)",
    );
    process.exit(1);
  }

  if (!base.startsWith("https://")) {
    console.error("PUBLIC_APP_URL must start with https://");
    process.exit(1);
  }

  const webhookUrl = `${base}/api/telegram/webhook`;

  const setRes = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
      }),
    },
  );
  const setJson = await setRes.json();

  if (!setJson.ok) {
    console.error("setWebhook failed:", JSON.stringify(setJson, null, 2));
    process.exit(1);
  }

  console.log("setWebhook OK");
  console.log("  url:", webhookUrl);

  const infoRes = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`,
  );
  const infoJson = await infoRes.json();
  if (infoJson.ok && infoJson.result) {
    const r = infoJson.result;
    console.log("\ngetWebhookInfo:");
    console.log("  url:", r.url);
    console.log("  pending_update_count:", r.pending_update_count);
    if (r.last_error_message) {
      console.log("  last_error_message:", r.last_error_message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
