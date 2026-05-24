import { v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";

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
  coachLogicVersion: v.optional(v.number()),
  archived: v.optional(v.boolean()),
  archivedAt: v.optional(v.number()),
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
    coachLogicVersion: v.number(),
  },
  returns: v.id("weeklyReviews"),
  handler: async (ctx, args) => {
    const sameWeek = await ctx.db
      .query("weeklyReviews")
      .withIndex("by_week_ending", (q) => q.eq("weekEnding", args.weekEnding))
      .collect();
    const now = Date.now();
    for (const row of sameWeek) {
      if (!row.archived) {
        await ctx.db.patch(row._id, { archived: true, archivedAt: now });
      }
    }
    return await ctx.db.insert("weeklyReviews", {
      ...args,
      archived: false,
    });
  },
});

async function latestActiveReview(ctx: QueryCtx) {
  const rows = await ctx.db
    .query("weeklyReviews")
    .withIndex("by_generated")
    .order("desc")
    .take(20);
  return rows.find((r) => !r.archived) ?? null;
}

export const latest = query({
  args: { dashboardSecret: v.string() },
  returns: v.union(reviewDoc, v.null()),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    return await latestActiveReview(ctx);
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
    const rows = await ctx.db
      .query("weeklyReviews")
      .withIndex("by_generated")
      .order("desc")
      .take(40);
    return rows.filter((r) => !r.archived).slice(0, limit);
  },
});

export const countArchived = query({
  args: { dashboardSecret: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const rows = await ctx.db.query("weeklyReviews").collect();
    return rows.filter((r) => r.archived).length;
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

/** Archive all active reviews — keeps history, excludes from coach memory. */
export const archiveAll = mutation({
  args: { dashboardSecret: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const rows = await ctx.db.query("weeklyReviews").collect();
    let n = 0;
    const now = Date.now();
    for (const row of rows) {
      if (!row.archived) {
        await ctx.db.patch(row._id, { archived: true, archivedAt: now });
        n += 1;
      }
    }
    return n;
  },
});

/** Delete all reviews (nuclear — rarely needed). */
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
