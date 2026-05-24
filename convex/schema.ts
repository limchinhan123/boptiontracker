import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  trades: defineTable({
    createdAt: v.number(),
    source: v.union(
      v.literal("telegram"),
      v.literal("whatsapp"),
      v.literal("manual"),
    ),
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

    /** Legacy (Google Sheets export removed); kept so existing rows stay valid. */
    sheetsSyncedAt: v.optional(v.number()),
    sheetsSyncError: v.optional(v.string()),

    /** Realized P&L for this leg (optional; you can set via Edit on the dashboard). */
    realizedPnl: v.optional(v.number()),

    /** When P&L counts for monthly stats; defaults to createdAt when unset. */
    pnlDate: v.optional(v.number()),
  })
    .index("by_source_message", ["source", "messageId"])
    .index("by_message_leg", ["source", "messageId", "legIndex"])
    .index("by_created", ["createdAt"])
    .index("by_needs_review", ["needsReview", "createdAt"]),

  accountSnapshots: defineTable({
    createdAt: v.number(),
    source: v.literal("telegram"),
    messageId: v.string(),
    kind: v.union(v.literal("balance"), v.literal("position")),
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

    positions: v.optional(
      v.array(
        v.object({
          symbol: v.string(),
          description: v.optional(v.string()),
          pctNetLiq: v.optional(v.number()),
          unrealizedPnl: v.optional(v.number()),
          unrealizedPnlPct: v.optional(v.number()),
          changePct: v.optional(v.number()),
        }),
      ),
    ),
  })
    .index("by_created", ["createdAt"])
    .index("by_kind_created", ["kind", "createdAt"])
    .index("by_source_message", ["source", "messageId"]),

  weeklyReviews: defineTable({
    weekEnding: v.string(),
    generatedAt: v.number(),
    factSheetJson: v.string(),
    narrativeMarkdown: v.string(),
    memoryMarkdown: v.string(),
    model: v.string(),
    openQuestion: v.optional(v.string()),
    coachLogicVersion: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_week_ending", ["weekEnding"])
    .index("by_generated", ["generatedAt"])
    .index("by_archived_generated", ["archived", "generatedAt"]),

  coachSettings: defineTable({
    key: v.literal("default"),
    profileNotes: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Bumped when trades/snapshots change so the dashboard can live-sync. */
  dashboardFeed: defineTable({
    key: v.literal("default"),
    version: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
