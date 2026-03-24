import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { cookieName, verifySessionCookie } from "@/lib/session";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: {
    tradeId?: string;
    patch?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.tradeId || !body.patch) {
    return NextResponse.json(
      { error: "tradeId and patch required" },
      { status: 400 },
    );
  }
  const client = getConvexClient();
  await client.mutation(api.trades.updateTrade, {
    dashboardSecret: requireDashboardSecret(),
    tradeId: body.tradeId as Id<"trades">,
    patch: body.patch as {
      underlying?: string;
      optionType?: "call" | "put" | "unknown";
      strike?: number;
      expiration?: string;
      multiplier?: number;
      side?: string;
      quantity?: number;
      price?: number;
      total?: number;
      fees?: number;
      currency?: string;
      strategyTag?: string;
      notes?: string;
      needsReview?: boolean;
      realizedPnl?: number;
    },
  });
  return NextResponse.json({ ok: true });
}
