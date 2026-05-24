import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

const reviewDoc = v.object({
  _id: v.id("weeklyReviews"),
  _creationTime: v.number(),
  weekEnding: v.string(),
  generatedAt: v.number(),
  factSheetJson: v.string(),
  narrativeMarkdown: v.string(),
  memoryMarkdown: v.string(),
  model: v.string(),
  openQuestion: v.optional(v.string()),
});

function assertDashboardSecret(secret: string) {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized");
  }
}

export const insertReview = internalMutation({
  args: {
    weekEnding: v.string(),
    generatedAt: v.number(),
    factSheetJson: v.string(),
    narrativeMarkdown: v.string(),
    memoryMarkdown: v.string(),
    model: v.string(),
    openQuestion: v.optional(v.string()),
  },
  returns: v.id("weeklyReviews"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weeklyReviews")
      .withIndex("by_week_ending", (q) => q.eq("weekEnding", args.weekEnding))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return await ctx.db.insert("weeklyReviews", args);
  },
});

export const latest = query({
  args: { dashboardSecret: v.string() },
  returns: v.union(reviewDoc, v.null()),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    return await ctx.db
      .query("weeklyReviews")
      .withIndex("by_generated")
      .order("desc")
      .first();
  },
});

export const listRecent = query({
  args: {
    dashboardSecret: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(reviewDoc),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const limit = Math.min(args.limit ?? 8, 20);
    return await ctx.db
      .query("weeklyReviews")
      .withIndex("by_generated")
      .order("desc")
      .take(limit);
  },
});

export const getById = query({
  args: {
    dashboardSecret: v.string(),
    reviewId: v.id("weeklyReviews"),
  },
  returns: v.union(reviewDoc, v.null()),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    return await ctx.db.get(args.reviewId);
  },
});

/** Delete all stored coach reviews and memory (dashboard admin). */
export const resetAll = mutation({
  args: { dashboardSecret: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const all = await ctx.db.query("weeklyReviews").collect();
    for (const row of all) {
      await ctx.db.delete(row._id);
    }
    return all.length;
  },
});
