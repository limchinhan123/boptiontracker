import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";

const sourceV = v.union(v.literal("telegram"), v.literal("whatsapp"));

const tradeDoc = v.object({
  _id: v.id("trades"),
  _creationTime: v.number(),
  createdAt: v.number(),
  source: sourceV,
  messageId: v.string(),
  legIndex: v.number(),
  imageStorageId: v.optional(v.id("_storage")),
  underlying: v.optional(v.string()),
  optionType: v.optional(
    v.union(v.literal("call"), v.literal("put"), v.literal("unknown")),
  ),
  strike: v.optional(v.number()),
  expiration: v.optional(v.string()),
  multiplier: v.optional(v.number()),
  side: v.optional(v.string()),
  quantity: v.optional(v.number()),
  price: v.optional(v.number()),
  total: v.optional(v.number()),
  fees: v.optional(v.number()),
  currency: v.optional(v.string()),
  strategyTag: v.optional(v.string()),
  notes: v.optional(v.string()),
  confidence: v.optional(v.number()),
  needsReview: v.boolean(),
  modelOutput: v.optional(v.string()),
  ingestError: v.optional(v.string()),
  sheetsSyncedAt: v.optional(v.number()),
  sheetsSyncError: v.optional(v.string()),
});

function assertDashboardSecret(secret: string) {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized");
  }
}

export const getById = internalQuery({
  args: { tradeId: v.id("trades") },
  returns: v.union(tradeDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tradeId);
  },
});

export const anyTradeForMessage = internalQuery({
  args: {
    source: sourceV,
    messageId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("trades")
      .withIndex("by_source_message", (q) =>
        q.eq("source", args.source).eq("messageId", args.messageId),
      )
      .first();
    return row !== null;
  },
});

export const insertTradeLeg = internalMutation({
  args: {
    createdAt: v.number(),
    source: sourceV,
    messageId: v.string(),
    legIndex: v.number(),
    imageStorageId: v.optional(v.id("_storage")),
    underlying: v.optional(v.string()),
    optionType: v.optional(
      v.union(v.literal("call"), v.literal("put"), v.literal("unknown")),
    ),
    strike: v.optional(v.number()),
    expiration: v.optional(v.string()),
    multiplier: v.optional(v.number()),
    side: v.optional(v.string()),
    quantity: v.optional(v.number()),
    price: v.optional(v.number()),
    total: v.optional(v.number()),
    fees: v.optional(v.number()),
    currency: v.optional(v.string()),
    strategyTag: v.optional(v.string()),
    notes: v.optional(v.string()),
    confidence: v.optional(v.number()),
    needsReview: v.boolean(),
    modelOutput: v.optional(v.string()),
    ingestError: v.optional(v.string()),
  },
  returns: v.id("trades"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("trades", {
      createdAt: args.createdAt,
      source: args.source,
      messageId: args.messageId,
      legIndex: args.legIndex,
      imageStorageId: args.imageStorageId,
      underlying: args.underlying,
      optionType: args.optionType,
      strike: args.strike,
      expiration: args.expiration,
      multiplier: args.multiplier,
      side: args.side,
      quantity: args.quantity,
      price: args.price,
      total: args.total,
      fees: args.fees,
      currency: args.currency,
      strategyTag: args.strategyTag,
      notes: args.notes,
      confidence: args.confidence,
      needsReview: args.needsReview,
      modelOutput: args.modelOutput,
      ingestError: args.ingestError,
    });
  },
});

export const setSheetsSyncResult = internalMutation({
  args: {
    tradeId: v.id("trades"),
    ok: v.boolean(),
    error: v.optional(v.string()),
    syncedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.ok) {
      await ctx.db.patch(args.tradeId, {
        sheetsSyncedAt: args.syncedAt,
        sheetsSyncError: undefined,
      });
    } else {
      await ctx.db.patch(args.tradeId, {
        sheetsSyncError: args.error,
      });
    }
    return null;
  },
});

export const clearSheetsSyncForRetry = internalMutation({
  args: { tradeId: v.id("trades") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tradeId, {
      sheetsSyncedAt: undefined,
      sheetsSyncError: undefined,
    });
    return null;
  },
});

export const list = query({
  args: {
    dashboardSecret: v.string(),
    underlyingPrefix: v.optional(v.string()),
    needsReviewOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(tradeDoc),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const limit = Math.min(args.limit ?? 200, 500);

    if (args.needsReviewOnly) {
      const rows = await ctx.db
        .query("trades")
        .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
        .order("desc")
        .take(limit);
      return rows.filter((r) =>
        args.underlyingPrefix
          ? (r.underlying ?? "")
              .toUpperCase()
              .startsWith(args.underlyingPrefix.toUpperCase())
          : true,
      );
    }

    const rows = await ctx.db
      .query("trades")
      .withIndex("by_created")
      .order("desc")
      .take(limit);

    return rows.filter((r) =>
      args.underlyingPrefix
        ? (r.underlying ?? "")
            .toUpperCase()
            .startsWith(args.underlyingPrefix.toUpperCase())
        : true,
    );
  },
});

export const stats = query({
  args: { dashboardSecret: v.string() },
  returns: v.object({
    totalTrades: v.number(),
    needsReview: v.number(),
    sheetsErrors: v.number(),
    totalFees: v.number(),
    byUnderlying: v.array(
      v.object({ underlying: v.string(), count: v.number() }),
    ),
  }),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const all = await ctx.db
      .query("trades")
      .withIndex("by_created")
      .order("desc")
      .take(2000);
    const totalTrades = all.length;
    const needsReview = all.filter((t) => t.needsReview).length;
    const sheetsErrors = all.filter(
      (t) => t.sheetsSyncError && !t.sheetsSyncedAt,
    ).length;
    const totalFees = all.reduce((s, t) => s + (t.fees ?? 0), 0);
    const map = new Map<string, number>();
    for (const t of all) {
      const u = (t.underlying ?? "UNKNOWN").toUpperCase();
      map.set(u, (map.get(u) ?? 0) + 1);
    }
    const byUnderlying = [...map.entries()]
      .map(([underlying, count]) => ({ underlying, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    return {
      totalTrades,
      needsReview,
      sheetsErrors,
      totalFees,
      byUnderlying,
    };
  },
});

export const updateTrade = mutation({
  args: {
    dashboardSecret: v.string(),
    tradeId: v.id("trades"),
    patch: v.object({
      underlying: v.optional(v.string()),
      optionType: v.optional(
        v.union(v.literal("call"), v.literal("put"), v.literal("unknown")),
      ),
      strike: v.optional(v.number()),
      expiration: v.optional(v.string()),
      multiplier: v.optional(v.number()),
      side: v.optional(v.string()),
      quantity: v.optional(v.number()),
      price: v.optional(v.number()),
      total: v.optional(v.number()),
      fees: v.optional(v.number()),
      currency: v.optional(v.string()),
      strategyTag: v.optional(v.string()),
      notes: v.optional(v.string()),
      needsReview: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    await ctx.db.patch(args.tradeId, args.patch);
    return null;
  },
});
