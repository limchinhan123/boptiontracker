import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCoachExportMarkdown } from "@/lib/coach-markdown";
import type { WeeklyFactSheet } from "@/lib/weekly-fact-sheet";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { dashboardTextError } from "@/lib/dashboard-api-error";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const reviewId = searchParams.get("reviewId") as Id<"weeklyReviews"> | null;
  const kind = searchParams.get("kind") ?? "full";

  try {
    const client = getConvexClient();
    const secret = requireDashboardSecret();
    const review = reviewId
      ? await client.query(api.weeklyReviews.getById, {
          dashboardSecret: secret,
          reviewId,
        })
      : await client.query(api.weeklyReviews.latest, {
          dashboardSecret: secret,
        });

    if (!review) {
      return new Response("No review found", { status: 404 });
    }

    let factSheet: WeeklyFactSheet;
    try {
      factSheet = JSON.parse(review.factSheetJson) as WeeklyFactSheet;
    } catch {
      factSheet = {
        generatedAt: review.generatedAt,
        weekEnding: review.weekEnding,
        account: {
          netLiquidation: null,
          excessLiquidity: null,
          initialMargin: null,
          maintenanceMargin: null,
          buyingPower: null,
          cash: null,
          portfolioUnrealizedPnl: null,
          portfolioRealizedPnl: null,
          initMarginPctOfNetLiq: null,
          maintMarginPctOfNetLiq: null,
          excessLiqPctOfNetLiq: null,
          theta: null,
          spxDelta: null,
          vega: null,
          balanceSnapshotAgeDays: null,
          positionSnapshotAgeDays: null,
          portfolioPositionCount: null,
        },
        context: {
          unrealizedPnlScope: "",
          tradeLogScope: "",
        },
        trades: {
          totalTrades: 0,
          totalRealizedPnl: 0,
          needsReviewCount: 0,
          activeOptionLegsInLog: 0,
          expiredOpenLegsAwaitingClose: 0,
          historicalOpensMissingCloseRow: 0,
          topUnderlyingsByCount: [],
          topUnderlyingsByPnl: [],
          lastThreeMonths: [],
          optionRealizedPnl: 0,
        },
        concentration: { topPositionSymbols: [] },
        flags: [],
        priorMemory: [],
        weekOverWeek: null,
      };
    }

    const body =
      kind === "memory"
        ? `# Coach memory — ${review.weekEnding}\n\n${review.memoryMarkdown.trim()}\n`
        : formatCoachExportMarkdown({
            weekEnding: review.weekEnding,
            generatedAt: review.generatedAt,
            model: review.model,
            factSheet,
            narrativeMarkdown: review.narrativeMarkdown,
            memoryMarkdown: review.memoryMarkdown,
          });

    const suffix = kind === "memory" ? "memory" : "review";
    const filename = `coach-${suffix}-${review.weekEnding}.md`;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return dashboardTextError(
      "dashboard/reviews/export",
      e,
      "Export failed",
      502,
    );
  }
}
