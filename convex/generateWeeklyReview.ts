"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { sanitizeMemoryMarkdown } from "../lib/coach-payload";
import { COACH_LOGIC_VERSION } from "../lib/coach-version";
import {
  buildWeeklyFactSheet,
  type WeeklyFactSheet,
} from "../lib/weekly-fact-sheet";
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

    const [trades, stats, snapshots, priorReviews, profileRow] =
      await Promise.all([
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
          limit: 8,
        }),
        ctx.runQuery(api.coachSettings.getProfile, {
          dashboardSecret: args.dashboardSecret,
        }),
      ]);

    const priorForCoach = priorReviews
      .filter((r) => r.weekEnding !== weekEndingFromNow())
      .map((r) => ({
        weekEnding: r.weekEnding,
        generatedAt: r.generatedAt,
        memoryMarkdown: r.memoryMarkdown,
        narrativeMarkdown: r.narrativeMarkdown,
        openQuestion: r.openQuestion,
      }));

    let priorFactSheet: WeeklyFactSheet | null = null;
    const priorWithSheet = priorReviews.find(
      (r) => r.weekEnding !== weekEndingFromNow() && r.factSheetJson,
    );
    if (priorWithSheet?.factSheetJson) {
      try {
        priorFactSheet = JSON.parse(
          priorWithSheet.factSheetJson,
        ) as WeeklyFactSheet;
      } catch {
        priorFactSheet = null;
      }
    }

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
      priorReviews: priorForCoach.slice(0, 4),
      priorFactSheet,
    });

    const coachProfile = profileRow.profileNotes.trim();

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
Write ONLY from coachPayload JSON. Obey coachPayload.constraints and coachPayload.coachProfile.

FORBIDDEN in narrativeMarkdown and memoryMarkdown:
- Comparing portfolioUnrealizedPnl to trades.totalRealizedPnl as a risk
- Leading What changed with portfolio MTM or portfolioUnrealizedPnl
- Claiming dozens of "open legs without closures" from log gaps
- Treating portfolio MTM as something the user should "manage down" soon
- Generic macro/defensive advice without numbers

## What changed
- If weekOverWeek exists: cite netLiquidationDelta, excessLiqPctDelta, initMarginPctDelta, topSymbolPctDelta with numbers
- Else: cite trades.lastThreeMonths and snapshot ages — not portfolio MTM

## Top risks (max 3, numbered)
- If excessLiqPctOfNetLiq > 50: ONE short "liquidity buffer OK" line max
- Remaining slots MUST cite greeks (theta, spxDelta, vega) and/or concentration tickers with pctNetLiq

## Data gaps
- Snapshot ages, needsReviewCount, expiredOpenLegsAwaitingClose only

## One question for next week
- One concrete question tied to the numbers above

memoryMarkdown: max 6 bullets for next week. EACH bullet MUST contain at least one digit. No forbidden topics.`,
        },
        {
          role: "user",
          content: `coachPayload:\n${coachPayloadForPrompt(factSheet, priorForCoach, coachProfile)}`,
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

    const memoryMarkdown = sanitizeMemoryMarkdown(parsed.memoryMarkdown, 6);

    const reviewId: Id<"weeklyReviews"> = await ctx.runMutation(
      internal.weeklyReviews.insertReview,
      {
        weekEnding: factSheet.weekEnding,
        generatedAt: Date.now(),
        factSheetJson: JSON.stringify(factSheet),
        narrativeMarkdown: parsed.narrativeMarkdown,
        memoryMarkdown,
        model,
        openQuestion: parsed.openQuestion,
        coachLogicVersion: COACH_LOGIC_VERSION,
      },
    );

    return { reviewId, weekEnding: factSheet.weekEnding };
  },
});

function weekEndingFromNow(now = Date.now()): string {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
