import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    worthlessExpiration?: boolean;
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
    pnlDate?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const client = getConvexClient();
  try {
    const tradeId = await client.mutation(api.trades.createManualTrade, {
      dashboardSecret: requireDashboardSecret(),
      worthlessExpiration: body.worthlessExpiration ?? true,
      underlying: body.underlying,
      optionType: body.optionType,
      strike: body.strike,
      expiration: body.expiration,
      multiplier: body.multiplier,
      side: body.side,
      quantity: body.quantity,
      price: body.price,
      total: body.total,
      fees: body.fees,
      currency: body.currency,
      strategyTag: body.strategyTag,
      notes: body.notes,
      needsReview: body.needsReview,
      realizedPnl: body.realizedPnl,
      pnlDate: body.pnlDate,
    });
    return NextResponse.json({ ok: true, tradeId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
