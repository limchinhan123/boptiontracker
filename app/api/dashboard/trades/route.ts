import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { dashboardJsonError } from "@/lib/dashboard-api-error";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const underlyingPrefix = searchParams.get("underlying") ?? undefined;
  const needsReviewOnly = searchParams.get("needsReview") === "1";
  const rawLimit = searchParams.get("limit");
  const parsedLimit = rawLimit === null ? 500 : Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 500)
    : 500;

  try {
    const client = getConvexClient();
    const secret = requireDashboardSecret();
    const trades = await client.query(api.trades.list, {
      dashboardSecret: secret,
      underlyingPrefix: underlyingPrefix || undefined,
      needsReviewOnly: needsReviewOnly || undefined,
      limit,
    });
    return NextResponse.json({ trades });
  } catch (e) {
    return dashboardJsonError(
      "dashboard/trades",
      e,
      "Trades load failed",
      502,
    );
  }
}
