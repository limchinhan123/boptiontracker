import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getConvexClient();
    const review = await client.query(api.weeklyReviews.latest, {
      dashboardSecret: requireDashboardSecret(),
    });
    return NextResponse.json({ review });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Convex request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
