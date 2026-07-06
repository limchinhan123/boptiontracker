import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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
    const stats = await client.query(api.trades.stats, {
      dashboardSecret: requireDashboardSecret(),
    });
    return NextResponse.json(stats);
  } catch (e) {
    return dashboardJsonError("dashboard/stats", e, "Stats load failed", 502);
  }
}
