import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { dashboardJsonError } from "@/lib/dashboard-api-error";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getConvexClient();
    const result = await client.action(api.generateWeeklyReview.generateWeeklyReview, {
      dashboardSecret: requireDashboardSecret(),
    });
    const review = await client.query(api.weeklyReviews.getById, {
      dashboardSecret: requireDashboardSecret(),
      reviewId: result.reviewId,
    });
    return NextResponse.json({ ok: true, review, ...result });
  } catch (e) {
    return dashboardJsonError(
      "dashboard/reviews/generate",
      e,
      "Review generation failed",
      502,
    );
  }
}
