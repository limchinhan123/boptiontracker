import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import type { Doc } from "@/convex/_generated/dataModel";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/** Same filters as `/api/dashboard/trades`; exports up to 500 rows (Convex list cap). */
export async function GET(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const underlyingPrefix = searchParams.get("underlying") ?? undefined;
  const needsReviewOnly = searchParams.get("needsReview") === "1";

  let trades: Doc<"trades">[];
  try {
    const client = getConvexClient();
    const secret = requireDashboardSecret();
    trades = await client.query(api.trades.list, {
      dashboardSecret: secret,
      underlyingPrefix: underlyingPrefix || undefined,
      needsReviewOnly: needsReviewOnly || undefined,
      limit: 500,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Convex request failed";
    console.error("[dashboard/export-excel]", message, e);
    return new Response(message, { status: 502 });
  }

  const sorted = [...trades].sort((a, b) => a.createdAt - b.createdAt);
  let cumulativePnl = 0;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Options trade dashboard";
  const sheet = workbook.addWorksheet("Trades", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = [
    "Convex ID",
    "Created (UTC)",
    "Source",
    "Message ID",
    "Leg",
    "Underlying",
    "Option type",
    "Strike",
    "Expiration",
    "Multiplier",
    "Side",
    "Quantity",
    "Price",
    "Net amount",
    "Fees",
    "Currency",
    "Realized P&L",
    "Cumulative P&L",
    "Strategy tag",
    "Notes",
    "Needs review",
    "Confidence",
    "Ingest error",
  ] as const;

  sheet.addRow([...headers]);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", wrapText: true };

  for (const t of sorted) {
    cumulativePnl += t.realizedPnl ?? 0;
    sheet.addRow(rowFromTrade(t, cumulativePnl));
  }

  sheet.columns = columnWidths(headers.length);

  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `options-trades-${stamp}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function rowFromTrade(
  t: Doc<"trades">,
  cumulativePnl: number,
): (string | number | Date | boolean)[] {
  return [
    t._id,
    new Date(t.createdAt),
    t.source,
    t.messageId,
    t.legIndex,
    t.underlying ?? "",
    t.optionType ?? "",
    t.strike ?? "",
    t.expiration ?? "",
    t.multiplier ?? "",
    t.side ?? "",
    t.quantity ?? "",
    t.price ?? "",
    t.total ?? "",
    t.fees ?? "",
    t.currency ?? "",
    t.realizedPnl ?? "",
    cumulativePnl,
    t.strategyTag ?? "",
    t.notes ?? "",
    t.needsReview,
    t.confidence ?? "",
    t.ingestError ?? "",
  ];
}

function columnWidths(n: number): { width: number }[] {
  const w = [
    28, 20, 10, 14, 6, 12, 10, 10, 12, 10, 22, 8, 10, 12, 10, 8, 12, 14, 14,
    28, 12, 10, 24,
  ];
  return Array.from({ length: n }, (_, i) => ({ width: w[i] ?? 12 }));
}
