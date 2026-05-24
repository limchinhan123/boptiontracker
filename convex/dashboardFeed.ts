import { v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { assertDashboardSession } from "./dashboardAuth";

export async function bumpDashboardFeed(ctx: MutationCtx): Promise<void> {
  const row = await ctx.db
    .query("dashboardFeed")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .first();
  const now = Date.now();
  if (row) {
    await ctx.db.patch(row._id, {
      version: row.version + 1,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("dashboardFeed", {
      key: "default",
      version: 1,
      updatedAt: now,
    });
  }
}

export const bump = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await bumpDashboardFeed(ctx);
    return null;
  },
});

export const getVersion = query({
  args: { sessionToken: v.string() },
  returns: v.object({
    version: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    await assertDashboardSession(args.sessionToken);
    const row = await ctx.db
      .query("dashboardFeed")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    return {
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? 0,
    };
  },
});
