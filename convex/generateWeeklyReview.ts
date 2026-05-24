"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { buildWeeklyFactSheet } from "../lib/weekly-fact-sheet";
import { coachPayloadForPrompt } from "../lib/coach-payload";

function assertDashboardSecret(secret: string) {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized");
  }
}

export const generateWeeklyReview = action({
  args: { dashboardSecret: v.string() },
  returns: v.object({
    reviewId: v.id("weeklyReviews"),
    weekEnding: v.string(),
  }),
  handler: async (ctx, args) => {
    assertDashboardSecret(args.dashboardSecret);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const [trades, stats, snapshots, priorReviews] = await Promise.all([
      ctx.runQuery(api.trades.list, {
        dashboardSecret: args.dashboardSecret,
        limit: 500,
      }),
      ctx.runQuery(api.trades.stats, {
        dashboardSecret: args.dashboardSecret,
      }),
      ctx.runQuery(api.snapshots.latestByKind, {
        dashboardSecret: args.dashboardSecret,
      }),
      ctx.runQuery(api.weeklyReviews.listRecent, {
        dashboardSecret: args.dashboardSecret,
        limit: 4,
      }),
    ]);

    const factSheet = buildWeeklyFactSheet({
      trades: trades.map((t) => ({
        _id: t._id,
        underlying: t.underlying,
        side: t.side,
        strike: t.strike,
        expiration: t.expiration,
        optionType: t.optionType,
        realizedPnl: t.realizedPnl,
        needsReview: t.needsReview,
        createdAt: t.createdAt,
      })),
      stats,
      balance: snapshots.balance
        ? {
            createdAt: snapshots.balance.createdAt,
            netLiquidation: snapshots.balance.netLiquidation,
            excessLiquidity: snapshots.balance.excessLiquidity,
            initialMargin: snapshots.balance.initialMargin,
            maintenanceMargin: snapshots.balance.maintenanceMargin,
            buyingPower: snapshots.balance.buyingPower,
            cash: snapshots.balance.cash,
          }
        : null,
      position: snapshots.position
        ? {
            createdAt: snapshots.position.createdAt,
            maintenanceMargin: snapshots.position.maintenanceMargin,
            unrealizedPnl: snapshots.position.unrealizedPnl,
            realizedPnl: snapshots.position.realizedPnl,
            theta: snapshots.position.theta,
            spxDelta: snapshots.position.spxDelta,
            vega: snapshots.position.vega,
            positions: snapshots.position.positions,
          }
        : null,
      priorReviews: priorReviews.map((r) => ({
        weekEnding: r.weekEnding,
        generatedAt: r.generatedAt,
        memoryMarkdown: r.memoryMarkdown,
        narrativeMarkdown: r.narrativeMarkdown,
        openQuestion: r.openQuestion,
      })),
    });

    const priorForCoach = priorReviews
      .filter((r) => r.weekEnding !== factSheet.weekEnding)
      .map((r) => ({
        weekEnding: r.weekEnding,
        generatedAt: r.generatedAt,
        memoryMarkdown: r.memoryMarkdown,
        narrativeMarkdown: r.narrativeMarkdown,
        openQuestion: r.openQuestion,
      }));

    const model =
      process.env.OPENAI_COACH_MODEL ??
      process.env.OPENAI_VISION_MODEL ??
      "gpt-4o";

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a margin and risk coach for an experienced options trader using IBKR.
Write ONLY from coachPayload JSON. Obey every string in coachPayload.constraints.

FORBIDDEN in narrativeMarkdown and memoryMarkdown:
- Comparing portfolioUnrealizedPnl to trades.totalRealizedPnl as a risk
- Claiming dozens of "open legs without closures" from log gaps
- Treating portfolio MTM as something the user should "manage down" soon

REQUIRED focus for Top risks: initMarginPctOfNetLiq, excessLiqPctOfNetLiq, maintMarginPctOfNetLiq, theta/spxDelta/vega, concentration.topPositionSymbols (tickers + pctNetLiq).

narrativeMarkdown headings:
## What changed
## Top risks (max 3, numbered)
## Data gaps
## One question for next week

memoryMarkdown: max 12 bullets for next week. Never repeat forbidden topics.`,
        },
        {
          role: "user",
          content: `coachPayload:\n${coachPayloadForPrompt(factSheet, priorForCoach)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "coach_review",
          strict: true,
          schema: {
            type: "object",
            properties: {
              narrativeMarkdown: { type: "string" },
              memoryMarkdown: { type: "string" },
              openQuestion: { type: "string" },
            },
            required: ["narrativeMarkdown", "memoryMarkdown", "openQuestion"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("Empty model response");
    }

    const parsed = JSON.parse(raw) as {
      narrativeMarkdown: string;
      memoryMarkdown: string;
      openQuestion: string;
    };

    const reviewId: Id<"weeklyReviews"> = await ctx.runMutation(
      internal.weeklyReviews.insertReview,
      {
        weekEnding: factSheet.weekEnding,
        generatedAt: Date.now(),
        factSheetJson: JSON.stringify(factSheet),
        narrativeMarkdown: parsed.narrativeMarkdown,
        memoryMarkdown: parsed.memoryMarkdown,
        model,
        openQuestion: parsed.openQuestion,
      },
    );

    return { reviewId, weekEnding: factSheet.weekEnding };
  },
});
