import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/** Archive active reviews (keeps history, excludes from coach memory). Optional ?generate=1 */
export async function POST(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const shouldGenerate = searchParams.get("generate") === "1";

  try {
    const client = getConvexClient();
    const secret = requireDashboardSecret();
    const archived = await client.mutation(api.weeklyReviews.archiveAll, {
      dashboardSecret: secret,
    });

    if (!shouldGenerate) {
      return NextResponse.json({ ok: true, archived, review: null });
    }

    const result = await client.action(
      api.generateWeeklyReview.generateWeeklyReview,
      { dashboardSecret: secret },
    );
    const review = await client.query(api.weeklyReviews.getById, {
      dashboardSecret: secret,
      reviewId: result.reviewId,
    });
    return NextResponse.json({ ok: true, archived, review, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Archive failed";
    console.error("[dashboard/reviews/archive]", message, e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
