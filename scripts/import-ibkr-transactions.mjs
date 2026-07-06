/**
 * Import IBKR Transaction History CSV — options only — into Convex trades.
 *
 * Usage:
 *   node scripts/import-ibkr-transactions.mjs /path/to/file.csv [--dry-run]
 */

import fs from "fs";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const OPT_SYMBOL_RE = /\d{6}[PC]\d{8}/;
const EXPECTED_TRANSACTION_HISTORY_FIELDS = 14;

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .map((l) => l.replace(/\r$/, "").trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const withoutExport = l.startsWith("export ") ? l.slice("export ".length).trim() : l;
        const i = withoutExport.indexOf("=");
        const key = withoutExport.slice(0, i).trim();
        let value = withoutExport.slice(i + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value.trim()];
      }),
  );
  if (!env.NEXT_PUBLIC_CONVEX_URL || !env.DASHBOARD_SECRET) {
    console.error("Missing NEXT_PUBLIC_CONVEX_URL or DASHBOARD_SECRET in .env.local");
    process.exit(1);
  }
  return env;
}

function parseOptionSymbol(sym) {
  const m = sym.trim().match(/^(\w+)\s+(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/);
  if (!m) return null;
  const [, und, yy, mm, dd, pc, strikeRaw] = m;
  return {
    underlying: und.trim(),
    expiration: `20${yy}-${mm}-${dd}`,
    optionType: pc === "P" ? "put" : "call",
    strike: parseInt(strikeRaw, 10) / 1000,
  };
}

function splitCsvLine(line) {
  const fields = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields.map((part) => part.trim());
}

function parseNumberField(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseIbkrOptions(csvText) {
  const rows = [];
  for (const line of csvText.split("\n")) {
    if (!line.startsWith("Transaction History,Data,")) continue;
    const parts = splitCsvLine(line);
    if (parts.length !== EXPECTED_TRANSACTION_HISTORY_FIELDS) {
      console.warn(
        `Skipping malformed Transaction History row: expected ${EXPECTED_TRANSACTION_HISTORY_FIELDS} fields, got ${parts.length}: ${line}`,
      );
      continue;
    }
    const date = parts[2];
    const txType = parts[5];
    const sym = parts[6];
    if (txType !== "Buy" && txType !== "Sell") continue;
    if (!OPT_SYMBOL_RE.test(sym)) continue;

    const parsed = parseOptionSymbol(sym);
    if (!parsed) continue;

    const qtyRaw = parseNumberField(parts[7]);
    const qty = Math.abs(qtyRaw);
    const price = parseNumberField(parts[8]);
    // Cols: ... Price(8), Currency(9), Gross(10), Commission(11), Net(12), Transaction Fees(13)
    const commission = Math.abs(parseNumberField(parts[11]) || 0);
    if (!Number.isFinite(qtyRaw) || !Number.isFinite(price) || !Number.isFinite(commission)) {
      console.warn(`Skipping Transaction History row with invalid numeric fields: ${line}`);
      continue;
    }
    const isBuy = txType === "Buy";

    rows.push({
      date,
      ...parsed,
      isBuy,
      qty,
      price,
      fees: commission,
      total: price * 100 * qty,
      side: isBuy ? "BUY" : "SELL",
      matchKey: `${date}|${parsed.underlying}|${parsed.expiration}|${parsed.strike}|${isBuy ? "Buy" : "Sell"}|${qty}|${price}`,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.matchKey.localeCompare(b.matchKey));
  return rows;
}

function tradeDayMs(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 20, 0, 0);
}

function journalMatchKeys(trades) {
  const keys = new Set();
  for (const t of trades) {
    if (!t.underlying || t.strike == null || !t.expiration || t.price == null) continue;
    const side = (t.side ?? "").toUpperCase();
    const isBuy = side.includes("BUY");
    const d = new Date(t.createdAt).toISOString().slice(0, 10);
    const qty = t.quantity ?? 1;
    keys.add(`${d}|${t.underlying}|${t.expiration}|${t.strike}|${isBuy ? "Buy" : "Sell"}|${qty}|${t.price}`);
    // Also match backfills tagged manual with pnlDate-based date
    if (t.pnlDate) {
      const pd = new Date(t.pnlDate).toISOString().slice(0, 10);
      keys.add(`${pd}|${t.underlying}|${t.expiration}|${t.strike}|${isBuy ? "Buy" : "Sell"}|${qty}|${t.price}`);
    }
  }
  return keys;
}

/** FIFO pairing: assign realized P&L to closing legs (CSP / covered call friendly). */
function assignClosePnl(rows) {
  const pos = new Map();
  const out = rows.map((r) => ({
    ...r,
    realizedPnl: 0,
    journalSide: "",
    pnlDate: undefined,
    pairedOpenKey: undefined,
    qtyMismatch: false,
    openQty: undefined,
    closeQty: undefined,
  }));

  for (const row of out) {
    const key = `${row.underlying}|${row.expiration}|${row.strike}|${row.optionType}`;
    const stack = pos.get(key) ?? [];

    if (row.isBuy) {
      const shortOpen = stack.find((o) => o.dir === "short");
      if (shortOpen) {
        row.journalSide = "BUY TO CLOSE";
        row.pairedOpenKey = shortOpen.matchKey;
        if (row.qty !== shortOpen.qty) {
          row.qtyMismatch = true;
          row.openQty = shortOpen.qty;
          row.closeQty = row.qty;
          pos.set(key, stack);
          continue;
        }
        const i = stack.indexOf(shortOpen);
        stack.splice(i, 1);
        row.realizedPnl =
          (shortOpen.price - row.price) * 100 * row.qty - shortOpen.fees - row.fees;
        row.pnlDate = row.date;
      } else {
        stack.push({
          dir: "long",
          price: row.price,
          fees: row.fees,
          qty: row.qty,
          matchKey: row.matchKey,
        });
        row.journalSide = "BUY TO OPEN";
      }
    } else {
      const longOpen = stack.find((o) => o.dir === "long");
      if (longOpen) {
        row.journalSide = "SELL TO CLOSE";
        row.pairedOpenKey = longOpen.matchKey;
        if (row.qty !== longOpen.qty) {
          row.qtyMismatch = true;
          row.openQty = longOpen.qty;
          row.closeQty = row.qty;
          pos.set(key, stack);
          continue;
        }
        const i = stack.indexOf(longOpen);
        stack.splice(i, 1);
        row.realizedPnl =
          (row.price - longOpen.price) * 100 * row.qty - longOpen.fees - row.fees;
        row.pnlDate = row.date;
      } else {
        stack.push({
          dir: "short",
          price: row.price,
          fees: row.fees,
          qty: row.qty,
          matchKey: row.matchKey,
        });
        row.journalSide = "SELL TO OPEN";
      }
    }
    pos.set(key, stack);
  }
  return out;
}

function journalPnlByMatchKey(trades) {
  const map = new Map();
  const setPnl = (key, pnl) => {
    const existing = map.get(key);
    if (existing !== undefined && existing !== 0 && pnl === 0) return;
    map.set(key, pnl);
  };
  for (const t of trades) {
    if (!t.underlying || t.strike == null || !t.expiration || t.price == null) continue;
    const side = (t.side ?? "").toUpperCase();
    const isBuy = side.includes("BUY");
    const d = new Date(t.createdAt).toISOString().slice(0, 10);
    const qty = t.quantity ?? 1;
    const pnl = t.realizedPnl ?? 0;
    const key = `${d}|${t.underlying}|${t.expiration}|${t.strike}|${isBuy ? "Buy" : "Sell"}|${qty}|${t.price}`;
    setPnl(key, pnl);
    if (t.pnlDate) {
      const pd = new Date(t.pnlDate).toISOString().slice(0, 10);
      const pnlKey = `${pd}|${t.underlying}|${t.expiration}|${t.strike}|${isBuy ? "Buy" : "Sell"}|${qty}|${t.price}`;
      setPnl(pnlKey, pnl);
    }
  }
  return map;
}

/** Skip P&L on imported closes when Telegram already booked it on the open leg. */
function effectivePnl(row, existingKeys, journalPnl) {
  if (row.qtyMismatch) {
    return { pnl: 0, pnlDate: undefined };
  }
  // Mar–Apr already have Telegram P&L — import legs for history only.
  if (row.date >= "2026-03-01") {
    return { pnl: 0, pnlDate: undefined };
  }
  if (!row.realizedPnl) return { pnl: 0, pnlDate: undefined };
  if (row.pairedOpenKey && existingKeys.has(row.pairedOpenKey)) {
    const openPnl = journalPnl.get(row.pairedOpenKey) ?? 0;
    if (openPnl !== 0) {
      return { pnl: 0, pnlDate: undefined };
    }
  }
  return {
    pnl: row.realizedPnl,
    pnlDate: row.pnlDate ? tradeDayMs(row.pnlDate) : undefined,
  };
}

async function main() {
  const csvPath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!csvPath) {
    console.error("Usage: node scripts/import-ibkr-transactions.mjs <csv> [--dry-run]");
    process.exit(1);
  }

  const env = loadEnv();
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  const secret = env.DASHBOARD_SECRET;

  const csv = fs.readFileSync(csvPath, "utf8");
  const ibkrRows = parseIbkrOptions(csv);
  const paired = assignClosePnl(ibkrRows);

  const existing = await client.query(api.trades.list, { dashboardSecret: secret, limit: 500 });
  const dedupeWarning =
    existing.length >= 500
      ? "Dedupe window saturated: api.trades.list returned 500 rows, so older journal rows may be outside the match window."
      : undefined;
  const existingKeys = journalMatchKeys(existing);
  const journalPnl = journalPnlByMatchKey(existing);

  const toImport = paired.filter((r) => !existingKeys.has(r.matchKey));
  const skipped = paired.filter((r) => existingKeys.has(r.matchKey));

  const importPnl = toImport.reduce((s, r) => {
    const { pnl } = effectivePnl(r, existingKeys, journalPnl);
    return s + pnl;
  }, 0);

  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "import",
    warning: dedupeWarning,
    ibkrOptionExecutions: ibkrRows.length,
    alreadyInJournal: skipped.length,
    toImport: toImport.length,
    qtyMismatches: paired
      .filter((r) => r.qtyMismatch)
      .map((r) => ({
        date: r.date,
        matchKey: r.matchKey,
        side: r.journalSide,
        openQty: r.openQty,
        closeQty: r.closeQty,
        pairedOpenKey: r.pairedOpenKey,
      })),
    additionalRealizedPnl: +importPnl.toFixed(2),
    sampleImport: toImport.slice(0, 8).map((r) => {
      const { pnl } = effectivePnl(r, existingKeys, journalPnl);
      return {
        date: r.date,
        leg: `${r.underlying} ${r.strike}${r.optionType[0].toUpperCase()} ${r.expiration}`,
        side: r.journalSide,
        price: r.price,
        pnl,
      };
    }),
  }, null, 2));

  if (dryRun) return;
  if (existing.length >= 500) {
    console.error(
      "Dedupe window saturated: api.trades.list returned 500 rows. Re-run would risk duplicate imports for older trades; aborting before mutations.",
    );
    process.exit(1);
  }

  for (const r of toImport) {
    const { pnl, pnlDate } = effectivePnl(r, existingKeys, journalPnl);
    await client.mutation(api.trades.createManualTrade, {
      dashboardSecret: secret,
      worthlessExpiration: false,
      createdAt: tradeDayMs(r.date),
      underlying: r.underlying,
      optionType: r.optionType,
      strike: r.strike,
      expiration: r.expiration,
      multiplier: 100,
      side: r.journalSide,
      quantity: r.qty,
      price: r.price,
      total: r.total,
      fees: r.fees,
      currency: "USD",
      realizedPnl: r.qtyMismatch ? 0 : pnl || undefined,
      pnlDate,
      needsReview: false,
      notes: "IBKR historical backfill (Jan–Apr 2026)",
    });
  }

  const stats = await client.query(api.trades.stats, { dashboardSecret: secret });
  console.log("\nAfter import:", JSON.stringify({
    totalRealizedPnl: +stats.totalRealizedPnl.toFixed(2),
    byMonth: stats.byMonth,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
