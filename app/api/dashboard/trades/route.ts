import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
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
  const limit = searchParams.get("limit")
    ? Number(searchParams.get("limit"))
    : undefined;

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
    const message = e instanceof Error ? e.message : "Convex request failed";
    console.error("[dashboard/trades]", message, e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
