/**
 * Read-only audit for IBKR Transaction History backfill rows.
 *
 * Usage:
 *   node scripts/audit-ibkr-backfill.mjs /path/to/file.csv
 */

import fs from "fs";
import os from "os";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const OPT_SYMBOL_RE = /\d{6}[PC]\d{8}/;
const EXPECTED_TRANSACTION_HISTORY_FIELDS = 14;
const BACKFILL_NOTE = "IBKR historical backfill (Jan–Apr 2026)";
const BACKFILL_START = "2026-01-01";
const BACKFILL_END = "2026-04-30";
const PNL_ZERO_FROM_DATE = "2026-03-01";
const EPSILON = 0.005;

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

function parseIbkrOptions(csvText) {
  const rows = [];
  const malformedRows = [];
  for (const line of csvText.split("\n")) {
    if (!line.startsWith("Transaction History,Data,")) continue;
    const parts = splitCsvLine(line);
    if (parts.length !== EXPECTED_TRANSACTION_HISTORY_FIELDS) {
      malformedRows.push({
        reason: `expected ${EXPECTED_TRANSACTION_HISTORY_FIELDS} fields, got ${parts.length}`,
        line,
      });
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
    const commission = Math.abs(parseNumberField(parts[11]) || 0);
    if (!Number.isFinite(qtyRaw) || !Number.isFinite(price) || !Number.isFinite(commission)) {
      malformedRows.push({ reason: "invalid numeric fields", line });
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
  return { rows, malformedRows };
}

function tradeDayMs(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 20, 0, 0);
}

function dateInBackfillScope(date) {
  return date >= BACKFILL_START && date <= BACKFILL_END;
}

function monthFromDate(date) {
  return date.slice(0, 7);
}

function monthFromTs(ts) {
  return new Date(ts).toISOString().slice(0, 7);
}

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

function journalMatchKeyFromTrade(t, usePnlDate = false) {
  if (!t.underlying || t.strike == null || !t.expiration || t.price == null) return null;
  const ts = usePnlDate ? t.pnlDate : t.createdAt;
  if (ts == null) return null;
  const side = (t.side ?? "").toUpperCase();
  const isBuy = side.includes("BUY");
  const d = new Date(ts).toISOString().slice(0, 10);
  const qty = t.quantity ?? 1;
  return `${d}|${t.underlying}|${t.expiration}|${t.strike}|${isBuy ? "Buy" : "Sell"}|${qty}|${t.price}`;
}

function journalMatchKeys(trades) {
  const keys = new Set();
  for (const t of trades) {
    const createdKey = journalMatchKeyFromTrade(t);
    if (createdKey) keys.add(createdKey);
    const pnlKey = journalMatchKeyFromTrade(t, true);
    if (pnlKey) keys.add(pnlKey);
  }
  return keys;
}

function journalPnlByMatchKey(trades) {
  const map = new Map();
  const setPnl = (key, pnl) => {
    const existing = map.get(key);
    if (existing !== undefined && existing !== 0 && pnl === 0) return;
    map.set(key, pnl);
  };

  for (const t of trades) {
    const pnl = t.realizedPnl ?? 0;
    const createdKey = journalMatchKeyFromTrade(t);
    if (createdKey) setPnl(createdKey, pnl);
    const pnlKey = journalMatchKeyFromTrade(t, true);
    if (pnlKey) setPnl(pnlKey, pnl);
  }
  return map;
}

function effectivePnl(row, existingKeys, journalPnl) {
  if (row.qtyMismatch) return { pnl: 0, pnlDate: undefined };
  if (row.date >= PNL_ZERO_FROM_DATE) return { pnl: 0, pnlDate: undefined };
  if (!row.realizedPnl) return { pnl: 0, pnlDate: undefined };
  if (row.pairedOpenKey && existingKeys.has(row.pairedOpenKey)) {
    const openPnl = journalPnl.get(row.pairedOpenKey) ?? 0;
    if (openPnl !== 0) return { pnl: 0, pnlDate: undefined };
  }
  return {
    pnl: row.realizedPnl,
    pnlDate: row.pnlDate ? tradeDayMs(row.pnlDate) : undefined,
  };
}

function groupByKey(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function approxEqual(a, b) {
  return Math.abs((a ?? 0) - (b ?? 0)) <= EPSILON;
}

function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function compactTrade(t) {
  return {
    tradeId: t._id,
    createdAt: t.createdAt,
    createdDate: new Date(t.createdAt).toISOString().slice(0, 10),
    underlying: t.underlying,
    expiration: t.expiration,
    strike: t.strike,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    realizedPnl: t.realizedPnl,
    pnlDate: t.pnlDate,
    notes: t.notes,
    messageId: t.messageId,
  };
}

function addProposedFix(proposedFixes, trade, field, currentValue, proposedValue, reason) {
  proposedFixes.push({
    tradeId: trade._id,
    matchKey: journalMatchKeyFromTrade(trade),
    field,
    currentValue: currentValue ?? null,
    proposedValue: proposedValue ?? null,
    reason,
  });
}

function scoreImportedAgainstExpected(trade, expected) {
  const feeScore = Math.abs((trade.fees ?? 0) - expected.fees);
  const pnlScore = Math.abs((trade.realizedPnl ?? 0) - expected.expectedRealizedPnl);
  const pnlDateScore =
    (trade.pnlDate ?? null) === (expected.expectedPnlDate ?? null) ? 0 : 1000;
  return feeScore + pnlScore + pnlDateScore;
}

function bestImportedMatch(matches, expected) {
  return [...matches].sort(
    (a, b) =>
      scoreImportedAgainstExpected(a, expected) -
        scoreImportedAgainstExpected(b, expected) ||
      a._creationTime - b._creationTime,
  )[0];
}

function pairExpectedToTrades(expectedRows, trades) {
  const remaining = [...trades];
  const pairs = [];
  for (const expected of expectedRows) {
    if (remaining.length === 0) break;
    const imported = bestImportedMatch(remaining, expected);
    const index = remaining.indexOf(imported);
    remaining.splice(index, 1);
    pairs.push({ expected, imported });
  }
  return {
    pairs,
    unmatchedExpected: expectedRows.slice(pairs.length),
    unmatchedTrades: remaining,
  };
}

function comparePair({
  expected,
  imported,
  feeMismatches,
  realizedPnlMismatches,
  suspectedDoubleCountedPnl,
  proposedFixes,
  journalPnl,
}) {
  if (!approxEqual(imported.fees ?? 0, expected.fees)) {
    feeMismatches.push({
      matchKey: expected.matchKey,
      trade: compactTrade(imported),
      csvFees: expected.fees,
      importedFees: imported.fees ?? 0,
    });
    addProposedFix(
      proposedFixes,
      imported,
      "fees",
      imported.fees,
      expected.fees,
      "Imported fee differs from fixed quote-aware CSV commission parse.",
    );
  }

  const importedPnl = imported.realizedPnl ?? 0;
  const expectedPnl = expected.expectedRealizedPnl;
  const importedPnlDate = imported.pnlDate ?? null;
  const expectedPnlDate = expected.expectedPnlDate ?? null;
  const pnlDiffers = !approxEqual(importedPnl, expectedPnl);
  const pnlDateDiffers = importedPnlDate !== expectedPnlDate;
  const qtyMismatchShouldClear =
    expected.qtyMismatch && (importedPnl !== 0 || importedPnlDate !== null);
  if (pnlDiffers || pnlDateDiffers || qtyMismatchShouldClear) {
    realizedPnlMismatches.push({
      matchKey: expected.matchKey,
      trade: compactTrade(imported),
      importedRealizedPnl: importedPnl,
      expectedRealizedPnl: roundMoney(expectedPnl),
      importedPnlDate,
      expectedPnlDate,
      qtyMismatch: expected.qtyMismatch,
      openQty: expected.openQty,
      closeQty: expected.closeQty,
    });
    if (pnlDiffers || qtyMismatchShouldClear) {
      addProposedFix(
        proposedFixes,
        imported,
        "realizedPnl",
        imported.realizedPnl,
        expectedPnl,
        expected.qtyMismatch
          ? "Partial close quantity mismatch should not auto-book P&L."
          : "Imported realized P&L differs from fixed recomputation.",
      );
    }
    if (pnlDateDiffers || qtyMismatchShouldClear) {
      addProposedFix(
        proposedFixes,
        imported,
        "pnlDate",
        imported.pnlDate,
        expected.expectedPnlDate,
        expected.qtyMismatch
          ? "Partial close quantity mismatch should leave pnlDate empty."
          : "Imported pnlDate differs from fixed recomputation.",
      );
    }
  }

  if (
    expected.pairedOpenKey &&
    expected.date < PNL_ZERO_FROM_DATE &&
    (journalPnl.get(expected.pairedOpenKey) ?? 0) !== 0 &&
    importedPnl !== 0
  ) {
    suspectedDoubleCountedPnl.push({
      matchKey: expected.matchKey,
      pairedOpenKey: expected.pairedOpenKey,
      openJournalPnl: journalPnl.get(expected.pairedOpenKey),
      importedClosePnl: importedPnl,
      trade: compactTrade(imported),
    });
  }
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node scripts/audit-ibkr-backfill.mjs <csv>");
    process.exit(1);
  }

  const env = loadEnv();
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  const csv = fs.readFileSync(csvPath, "utf8");
  const parsed = parseIbkrOptions(csv);
  const scopedCsvRows = parsed.rows.filter((r) => dateInBackfillScope(r.date));
  const outOfScopeRows = parsed.rows.filter((r) => !dateInBackfillScope(r.date));

  const existing = await client.query(api.trades.list, {
    dashboardSecret: env.DASHBOARD_SECRET,
    limit: 500,
  });

  const outputPath = path.join(
    os.tmpdir(),
    `ibkr-backfill-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );

  if (existing.length >= 500) {
    const report = {
      generatedAt: new Date().toISOString(),
      convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
      csvPath,
      backfillWindow: { start: BACKFILL_START, end: BACKFILL_END },
      saturated: true,
      error:
        "Audit window saturated: api.trades.list returned 500 rows, so row-by-row audit would be partial.",
      outOfScopePostBackfillTrades: outOfScopeRows.map((r) => ({
        date: r.date,
        matchKey: r.matchKey,
        side: r.side,
      })),
    };
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, outputPath }, null, 2));
    process.exit(1);
  }

  const backfillTrades = existing.filter((t) => t.notes === BACKFILL_NOTE);
  const nonBackfillTrades = existing.filter((t) => t.notes !== BACKFILL_NOTE);
  const existingKeys = journalMatchKeys(nonBackfillTrades);
  const journalPnl = journalPnlByMatchKey(nonBackfillTrades);
  const expectedRows = assignClosePnl(scopedCsvRows).map((row) => {
    const effective = effectivePnl(row, existingKeys, journalPnl);
    return {
      ...row,
      expectedRealizedPnl: effective.pnl,
      expectedPnlDate: effective.pnlDate,
    };
  });

  const expectedByKey = groupByKey(expectedRows, (r) => r.matchKey);
  const backfillByKey = groupByKey(backfillTrades, (t) => journalMatchKeyFromTrade(t));
  const proposedFixes = [];

  const feeMismatches = [];
  const realizedPnlMismatches = [];
  const suspectedDoubleCountedPnl = [];
  const csvRowsMissingFromJournal = [];
  const csvRowsMatchedExistingNonBackfill = [];

  for (const [key, expectedList] of expectedByKey.entries()) {
    const matches = backfillByKey.get(key) ?? [];
    if (matches.length === 0) {
      for (const expected of expectedList) {
        if (existingKeys.has(expected.matchKey)) {
          csvRowsMatchedExistingNonBackfill.push({
            matchKey: expected.matchKey,
            expected: {
              fees: expected.fees,
              realizedPnl: roundMoney(expected.expectedRealizedPnl),
              pnlDate: expected.expectedPnlDate,
              qtyMismatch: expected.qtyMismatch,
            },
          });
          continue;
        }
        csvRowsMissingFromJournal.push({
          matchKey: expected.matchKey,
          expected: {
            fees: expected.fees,
            realizedPnl: roundMoney(expected.expectedRealizedPnl),
            pnlDate: expected.expectedPnlDate,
            qtyMismatch: expected.qtyMismatch,
          },
        });
      }
      continue;
    }

    const { pairs, unmatchedExpected } = pairExpectedToTrades(expectedList, matches);
    for (const pair of pairs) {
      comparePair({
        ...pair,
        feeMismatches,
        realizedPnlMismatches,
        suspectedDoubleCountedPnl,
        proposedFixes,
        journalPnl,
      });
    }

    for (const expected of unmatchedExpected) {
      if (existingKeys.has(expected.matchKey)) {
        csvRowsMatchedExistingNonBackfill.push({
          matchKey: expected.matchKey,
          expected: {
            fees: expected.fees,
            realizedPnl: roundMoney(expected.expectedRealizedPnl),
            pnlDate: expected.expectedPnlDate,
            qtyMismatch: expected.qtyMismatch,
          },
        });
        continue;
      }
      csvRowsMissingFromJournal.push({
        matchKey: expected.matchKey,
        expected: {
          fees: expected.fees,
          realizedPnl: roundMoney(expected.expectedRealizedPnl),
          pnlDate: expected.expectedPnlDate,
          qtyMismatch: expected.qtyMismatch,
        },
      });
      continue;
    }
  }

  const journalBackfillRowsWithNoCsvCounterpart = [];
  for (const trade of backfillTrades) {
    const key = journalMatchKeyFromTrade(trade);
    if (key && !expectedByKey.has(key)) {
      journalBackfillRowsWithNoCsvCounterpart.push({
        matchKey: key,
        trade: compactTrade(trade),
      });
    }
  }

  const duplicateJournalKeys = [];
  for (const [key, rows] of backfillByKey.entries()) {
    const expectedList = expectedByKey.get(key) ?? [];
    if (rows.length > expectedList.length) {
      const { unmatchedTrades } =
        expectedList.length > 0
          ? pairExpectedToTrades(expectedList, rows)
          : { unmatchedTrades: rows };
      duplicateJournalKeys.push({
        matchKey: key,
        csvCount: expectedList.length,
        journalCount: rows.length,
        extraTradeIds: unmatchedTrades.map((row) => row._id),
        trades: rows.map(compactTrade),
      });
      for (const row of unmatchedTrades) {
        addProposedFix(
          proposedFixes,
          row,
          "row",
          "present",
          "delete duplicate",
          "Duplicate IBKR backfill row; another row for the same match key matches the fixed CSV recomputation more closely.",
        );
      }
    }
  }

  const qtyMismatches = expectedRows
    .filter((r) => r.qtyMismatch)
    .map((r) => ({
      date: r.date,
      matchKey: r.matchKey,
      side: r.journalSide,
      openQty: r.openQty,
      closeQty: r.closeQty,
      pairedOpenKey: r.pairedOpenKey,
    }));

  const recomputedByMonth = new Map();
  for (const row of expectedRows) {
    const month = row.expectedPnlDate
      ? monthFromTs(row.expectedPnlDate)
      : monthFromDate(row.date);
    recomputedByMonth.set(
      month,
      roundMoney((recomputedByMonth.get(month) ?? 0) + row.expectedRealizedPnl),
    );
  }

  const stats = await client.query(api.trades.stats, {
    dashboardSecret: env.DASHBOARD_SECRET,
  });
  const affectedMonths = ["2026-01", "2026-02", "2026-03", "2026-04"];
  const dashboardByMonth = new Map(stats.byMonth.map((row) => [row.month, row.pnl]));
  const totalsReconciliation = affectedMonths.map((month) => ({
    month,
    recomputedCsvPnl: roundMoney(recomputedByMonth.get(month) ?? 0),
    dashboardStatsPnl: roundMoney(dashboardByMonth.get(month) ?? 0),
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
    csvPath,
    outputPath,
    backfillWindow: { start: BACKFILL_START, end: BACKFILL_END },
    counts: {
      csvOptionRowsTotal: parsed.rows.length,
      csvOptionRowsInScope: scopedCsvRows.length,
      outOfScopePostBackfillTrades: outOfScopeRows.length,
      malformedRows: parsed.malformedRows.length,
      fetchedJournalRows: existing.length,
      importedBackfillRows: backfillTrades.length,
    },
    outOfScopePostBackfillTrades: outOfScopeRows.map((r) => ({
      date: r.date,
      matchKey: r.matchKey,
      side: r.side,
    })),
    malformedRows: parsed.malformedRows,
    discrepancies: {
      feeMismatches,
      realizedPnlMismatches,
      suspectedDoubleCountedPnl,
      duplicateJournalKeys,
      csvRowsMissingFromJournal,
      csvRowsMatchedExistingNonBackfill,
      journalBackfillRowsWithNoCsvCounterpart,
      qtyMismatches,
    },
    totalsReconciliation,
    proposedFixes,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
