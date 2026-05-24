import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_COACH_PROFILE } from "../lib/coach-version";

function assertDashboardSecret(secret: string) {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized");
  }
}

export const getProfile = query({
  args: { dashboardSecret: v.string() },
  returns: v.object({
    profileNotes: v.string(),
    updatedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const row = await ctx.db
      .query("coachSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    return {
      profileNotes: row?.profileNotes ?? DEFAULT_COACH_PROFILE,
      updatedAt: row?.updatedAt ?? null,
    };
  },
});

export const updateProfile = mutation({
  args: {
    dashboardSecret: v.string(),
    profileNotes: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);
    const existing = await ctx.db
      .query("coachSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        profileNotes: args.profileNotes.trim(),
        updatedAt,
      });
    } else {
      await ctx.db.insert("coachSettings", {
        key: "default",
        profileNotes: args.profileNotes.trim(),
        updatedAt,
      });
    }
    return null;
  },
});
