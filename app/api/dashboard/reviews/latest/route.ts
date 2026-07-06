import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { computeCoachHealth } from "@/lib/coach-health";
import { COACH_LOGIC_VERSION } from "@/lib/coach-version";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { dashboardJsonError } from "@/lib/dashboard-api-error";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getConvexClient();
    const secret = requireDashboardSecret();
    const [review, archivedReviewCount, profile] = await Promise.all([
      client.query(api.weeklyReviews.latest, { dashboardSecret: secret }),
      client.query(api.weeklyReviews.countArchived, { dashboardSecret: secret }),
      client.query(api.coachSettings.getProfile, { dashboardSecret: secret }),
    ]);

    const health = review
      ? computeCoachHealth({
          narrativeMarkdown: review.narrativeMarkdown,
          memoryMarkdown: review.memoryMarkdown,
          reviewLogicVersion: review.coachLogicVersion ?? null,
          archivedReviewCount,
        })
      : null;

    return NextResponse.json({
      review,
      health,
      profileNotes: profile.profileNotes,
      coachLogicVersion: COACH_LOGIC_VERSION,
      archivedReviewCount,
    });
  } catch (e) {
    return dashboardJsonError(
      "dashboard/reviews/latest",
      e,
      "Review load failed",
      502,
    );
  }
}
