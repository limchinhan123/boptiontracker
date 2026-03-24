import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  trades: defineTable({
    createdAt: v.number(),
    source: v.union(v.literal("telegram"), v.literal("whatsapp")),
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
  })
    .index("by_source_message", ["source", "messageId"])
    .index("by_message_leg", ["source", "messageId", "legIndex"])
    .index("by_created", ["createdAt"])
    .index("by_needs_review", ["needsReview", "createdAt"]),
});
