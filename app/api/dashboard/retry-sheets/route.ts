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
  let body: { tradeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.tradeId) {
    return NextResponse.json({ error: "tradeId required" }, { status: 400 });
  }
  const client = getConvexClient();
  await client.action(api.sheets.retrySheetsSync, {
    dashboardSecret: requireDashboardSecret(),
    tradeId: body.tradeId as Id<"trades">,
  });
  return NextResponse.json({ ok: true });
}
