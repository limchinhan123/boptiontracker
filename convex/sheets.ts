"use node";

import { google } from "googleapis";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, action } from "./_generated/server";

function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!raw || !spreadsheetId) {
    return { sheets: null as ReturnType<typeof google.sheets> | null, spreadsheetId: null as string | null };
  }
  const credentials = JSON.parse(raw) as Record<string, unknown>;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

function rowFromTrade(trade: Doc<"trades">) {
  return [
    trade._id,
    new Date(trade.createdAt).toISOString(),
    trade.source,
    trade.messageId,
    trade.underlying ?? "",
    trade.optionType ?? "",
    trade.strike ?? "",
    trade.expiration ?? "",
    trade.multiplier ?? "",
    trade.side ?? "",
    trade.quantity ?? "",
    trade.price ?? "",
    trade.total ?? "",
    trade.fees ?? "",
    trade.currency ?? "",
    trade.strategyTag ?? "",
    trade.notes ?? "",
    trade.needsReview ? "TRUE" : "FALSE",
    trade.confidence ?? "",
    trade.ingestError ?? "",
    trade.sheetsSyncError ?? "",
  ];
}

export const syncTradeToSheets = internalAction({
  args: { tradeId: v.id("trades") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { sheets, spreadsheetId } = getSheetsClient();
    const trade = await ctx.runQuery(internal.trades.getById, {
      tradeId: args.tradeId,
    });
    if (!trade) {
      return null;
    }
    if (trade.sheetsSyncedAt) {
      return null;
    }

    if (!sheets || !spreadsheetId) {
      await ctx.runMutation(internal.trades.setSheetsSyncResult, {
        tradeId: args.tradeId,
        ok: false,
        error: "Sheets not configured (missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEETS_SPREADSHEET_ID)",
      });
      return null;
    }

    const range = process.env.GOOGLE_SHEETS_RANGE ?? "Sheet1!A1";

    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [rowFromTrade(trade)],
        },
      });
      await ctx.runMutation(internal.trades.setSheetsSyncResult, {
        tradeId: args.tradeId,
        ok: true,
        syncedAt: Date.now(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.trades.setSheetsSyncResult, {
        tradeId: args.tradeId,
        ok: false,
        error: msg,
      });
    }
    return null;
  },
});

export const retrySheetsSync = action({
  args: {
    dashboardSecret: v.string(),
    tradeId: v.id("trades"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const expected = process.env.DASHBOARD_SECRET;
    if (!expected || args.dashboardSecret !== expected) {
      throw new Error("Unauthorized");
    }
    await ctx.runMutation(internal.trades.clearSheetsSyncForRetry, {
      tradeId: args.tradeId,
    });
    await ctx.scheduler.runAfter(0, internal.sheets.syncTradeToSheets, {
      tradeId: args.tradeId,
    });
    return null;
  },
});
