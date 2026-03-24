/**
 * Copies DASHBOARD_SECRET and INGEST_SECRET from .env.local to the Convex
 * deployment your CLI is linked to (same as `npx convex dev`).
 *
 * Usage:
 *   npm run convex:sync-secrets
 *   npm run convex:sync-secrets:prod   # uses `convex env set --prod`
 *
 * Requires: `npx convex login` once, and CONVEX_DEPLOYMENT / project linked.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");

function loadEnvLocal() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local");
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

function setVar(name, value, extraArgs) {
  const r = spawnSync(
    "npx",
    ["convex", "env", "set", name, value, ...extraArgs],
    {
      cwd: resolve(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || `Failed to set ${name}`);
    process.exit(1);
  }
  console.log("OK", name, "(Convex)");
}

const prod = process.argv.includes("--prod");
const extra = prod ? ["--prod"] : [];

const env = loadEnvLocal();
const dash = env.DASHBOARD_SECRET;
const ingest = env.INGEST_SECRET;
if (!dash) {
  console.error("DASHBOARD_SECRET missing in .env.local");
  process.exit(1);
}
if (!ingest) {
  console.error("INGEST_SECRET missing in .env.local");
  process.exit(1);
}

console.log(
  prod
    ? "Syncing to Convex production deployment (--prod)…"
    : "Syncing to Convex dev deployment (default)…",
);
setVar("DASHBOARD_SECRET", dash, extra);
setVar("INGEST_SECRET", ingest, extra);
console.log("Done. Refresh the dashboard.");
