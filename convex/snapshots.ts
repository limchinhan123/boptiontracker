import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { v } from "convex/values";

const snapshotKindV = v.union(v.literal("balance"), v.literal("position"));

const positionRowV = v.object({
  symbol: v.string(),
  description: v.optional(v.string()),
  pctNetLiq: v.optional(v.number()),
  unrealizedPnl: v.optional(v.number()),
  unrealizedPnlPct: v.optional(v.number()),
  changePct: v.optional(v.number()),
});

export const snapshotDoc = v.object({
  _id: v.id("accountSnapshots"),
  _creationTime: v.number(),
  createdAt: v.number(),
  source: v.literal("telegram"),
  messageId: v.string(),
  kind: snapshotKindV,
  imageStorageId: v.optional(v.id("_storage")),
  currency: v.optional(v.string()),
  needsReview: v.boolean(),
  ingestError: v.optional(v.string()),
  modelOutput: v.optional(v.string()),
  confidence: v.optional(v.number()),
  netLiquidation: v.optional(v.number()),
  cash: v.optional(v.number()),
  buyingPower: v.optional(v.number()),
  availableFunds: v.optional(v.number()),
  excessLiquidity: v.optional(v.number()),
  initialMargin: v.optional(v.number()),
  maintenanceMargin: v.optional(v.number()),
  regTMargin: v.optional(v.number()),
  securitiesGrossPositionValue: v.optional(v.number()),
  unrealizedPnl: v.optional(v.number()),
  realizedPnl: v.optional(v.number()),
  sma: v.optional(v.number()),
  theta: v.optional(v.number()),
  spxDelta: v.optional(v.number()),
  vega: v.optional(v.number()),
  positions: v.optional(v.array(positionRowV)),
});

function assertDashboardSecret(secret: string) {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized");
  }
}

export const anySnapshotForMessage = internalQuery({
  args: {
    source: v.literal("telegram"),
    messageId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("accountSnapshots")
      .withIndex("by_source_message", (q) =>
        q.eq("source", args.source).eq("messageId", args.messageId),
      )
      .first();
    return row !== null;
  },
});

export const insertSnapshot = internalMutation({
  args: {
    createdAt: v.number(),
    source: v.literal("telegram"),
    messageId: v.string(),
    kind: snapshotKindV,
    imageStorageId: v.optional(v.id("_storage")),
    currency: v.optional(v.string()),
    needsReview: v.boolean(),
    ingestError: v.optional(v.string()),
    modelOutput: v.optional(v.string()),
    confidence: v.optional(v.number()),
    netLiquidation: v.optional(v.number()),
    cash: v.optional(v.number()),
    buyingPower: v.optional(v.number()),
    availableFunds: v.optional(v.number()),
    excessLiquidity: v.optional(v.number()),
    initialMargin: v.optional(v.number()),
    maintenanceMargin: v.optional(v.number()),
    regTMargin: v.optional(v.number()),
    securitiesGrossPositionValue: v.optional(v.number()),
    unrealizedPnl: v.optional(v.number()),
    realizedPnl: v.optional(v.number()),
    sma: v.optional(v.number()),
    theta: v.optional(v.number()),
    spxDelta: v.optional(v.number()),
    vega: v.optional(v.number()),
    positions: v.optional(v.array(positionRowV)),
  },
  returns: v.id("accountSnapshots"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("accountSnapshots", args);
  },
});

export const list = query({
  args: {
    dashboardSecret: v.string(),
    kind: v.optional(snapshotKindV),
    limit: v.optional(v.number()),
  },
  returns: v.array(snapshotDoc),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const limit = Math.min(args.limit ?? 20, 100);

    if (args.kind) {
      return await ctx.db
        .query("accountSnapshots")
        .withIndex("by_kind_created", (q) => q.eq("kind", args.kind!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("accountSnapshots")
      .withIndex("by_created")
      .order("desc")
      .take(limit);
  },
});

export const latestByKind = query({
  args: { dashboardSecret: v.string() },
  returns: v.object({
    balance: v.union(snapshotDoc, v.null()),
    position: v.union(snapshotDoc, v.null()),
  }),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const balance = await ctx.db
      .query("accountSnapshots")
      .withIndex("by_kind_created", (q) => q.eq("kind", "balance"))
      .order("desc")
      .first();
    const position = await ctx.db
      .query("accountSnapshots")
      .withIndex("by_kind_created", (q) => q.eq("kind", "position"))
      .order("desc")
      .first();
    return { balance, position };
  },
});
