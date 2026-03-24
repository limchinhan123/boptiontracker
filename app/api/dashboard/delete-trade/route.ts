import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { cookieName, verifySessionCookie } from "@/lib/session";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { tradeId?: string; clearAll?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const secret = requireDashboardSecret();
  const client = getConvexClient();
  try {
    if (body.clearAll === true) {
      const n = await client.mutation(api.trades.clearAllTrades, {
        dashboardSecret: secret,
      });
      return NextResponse.json({ ok: true, deleted: n });
    }
    if (!body.tradeId) {
      return NextResponse.json(
        { error: "tradeId or clearAll required" },
        { status: 400 },
      );
    }
    await client.mutation(api.trades.deleteTrade, {
      dashboardSecret: secret,
      tradeId: body.tradeId as Id<"trades">,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    console.error("[dashboard/delete-trade]", message, e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
