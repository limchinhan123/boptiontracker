"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  appendWorthlessNote,
  canMarkWorthlessExpiration,
  computeNetAmount,
  computeWorthlessExpirationPnl,
  expirationToPnlDate,
  getWorthlessCloseWarning,
  hasCloseMatchForHide,
  hasStrictCloseMatch,
  hasUnsetRealizedPnl,
  isOpenSide,
} from "@/lib/worthless-pnl";

const DashboardCharts = dynamic(() => import("./dashboard-charts"), {
  ssr: false,
  loading: () => (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
    </section>
  ),
});

export type TradeRow = {
  _id: string;
  _creationTime: number;
  createdAt: number;
  source: "telegram" | "whatsapp" | "manual";
  messageId: string;
  legIndex: number;
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
  confidence?: number;
  needsReview: boolean;
  ingestError?: string;
  realizedPnl?: number;
  pnlDate?: number;
};

function formatMoney(
  n: number | null | undefined,
  currency = "USD",
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatOptionType(t?: TradeRow["optionType"]): string {
  if (t === "call") return "Call";
  if (t === "put") return "Put";
  if (t === "unknown") return "Unknown";
  return "—";
}


function ManualAddWorthlessSection(props: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    underlying: "",
    optionType: "put" as TradeRow["optionType"],
    strike: "",
    expiration: "",
    side: "SELL TO OPEN",
    quantity: "1",
    price: "",
    fees: "",
    multiplier: "100",
    notes: "",
  });

  const preview = useMemo(() => {
    return computeWorthlessExpirationPnl({
      side: form.side,
      quantity: form.quantity === "" ? undefined : Number(form.quantity),
      price: form.price === "" ? undefined : Number(form.price),
      fees: form.fees === "" ? undefined : Number(form.fees),
      multiplier: form.multiplier === "" ? undefined : Number(form.multiplier),
    });
  }, [form]);

  async function submitManual() {
    if (!form.underlying.trim() || !form.expiration) {
      window.alert("Underlying and expiration are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/create-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          worthlessExpiration: true,
          underlying: form.underlying.trim().toUpperCase(),
          optionType: form.optionType,
          strike: form.strike === "" ? undefined : Number(form.strike),
          expiration: form.expiration,
          side: form.side,
          quantity: form.quantity === "" ? undefined : Number(form.quantity),
          price: form.price === "" ? undefined : Number(form.price),
          fees: form.fees === "" ? undefined : Number(form.fees),
          multiplier:
            form.multiplier === "" ? undefined : Number(form.multiplier),
          notes: form.notes || undefined,
          needsReview: false,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Create failed");
      }
      setOpen(false);
      props.onCreated();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-800 dark:text-zinc-200"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Add expired worthless (no screenshot)</span>
        <span className="text-xs text-zinc-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Fallback when you never sent the open screenshot. P&amp;L counts in
            the expiration month.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-zinc-500">
              Underlying
              <input
                className="mt-0.5 block w-24 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.underlying}
                onChange={(e) =>
                  setForm((f) => ({ ...f, underlying: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Type
              <select
                className="mt-0.5 block w-24 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.optionType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    optionType: e.target.value as TradeRow["optionType"],
                  }))
                }
              >
                <option value="put">Put</option>
                <option value="call">Call</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Strike
              <input
                className="mt-0.5 block w-20 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.strike}
                onChange={(e) =>
                  setForm((f) => ({ ...f, strike: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Expiration
              <input
                type="date"
                required
                className="mt-0.5 block rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.expiration}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiration: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Side
              <select
                className="mt-0.5 block w-36 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.side}
                onChange={(e) =>
                  setForm((f) => ({ ...f, side: e.target.value }))
                }
              >
                <option value="SELL TO OPEN">SELL TO OPEN</option>
                <option value="BUY TO OPEN">BUY TO OPEN</option>
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Qty
              <input
                className="mt-0.5 block w-16 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.quantity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, quantity: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Price
              <input
                className="mt-0.5 block w-24 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.price}
                onChange={(e) =>
                  setForm((f) => ({ ...f, price: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Fees
              <input
                className="mt-0.5 block w-20 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={form.fees}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fees: e.target.value }))
                }
              />
            </label>
          </div>
          <p className="mt-3 text-sm">
            P&amp;L preview:{" "}
            <span className={`font-semibold ${pnlClass(preview ?? 0)}`}>
              {preview != null ? formatMoney(preview) : "—"}
            </span>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={saving}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-60 dark:bg-emerald-600"
              onClick={() => void submitManual()}
            >
              {saving ? "Saving…" : "Add trade"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function pnlClass(n: number): string {
  if (n > 0)
    return "text-emerald-700 tabular-nums dark:text-emerald-400";
  if (n < 0)
    return "text-red-600 tabular-nums dark:text-red-400";
  return "tabular-nums text-zinc-700 dark:text-zinc-300";
}

type Stats = {
  totalTrades: number;
  totalRealizedPnl: number;
  byUnderlying: { underlying: string; count: number }[];
  byUnderlyingPnl: { underlying: string; pnl: number }[];
  byMonth: { month: string; count: number; pnl: number }[];
};

type AccountSnapshotRow = {
  _id: string;
  createdAt: number;
  kind: "balance" | "position";
  currency?: string;
  needsReview: boolean;
  ingestError?: string;
  netLiquidation?: number;
  excessLiquidity?: number;
  initialMargin?: number;
  maintenanceMargin?: number;
  buyingPower?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  positions?: { symbol: string }[];
};

type LatestSnapshots = {
  balance: AccountSnapshotRow | null;
  position: AccountSnapshotRow | null;
};

export type { LatestSnapshots, AccountSnapshotRow };

function formatMonthKey(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

type SortKey =
  | "createdAt"
  | "underlying"
  | "side"
  | "optionType"
  | "price"
  | "net"
  | "realizedPnl";

/** Compare for ascending order; caller may invert for desc. */
function compareTradesByKey(a: TradeRow, b: TradeRow, key: SortKey): number {
  switch (key) {
    case "createdAt":
      return a.createdAt - b.createdAt;
    case "underlying":
      return (a.underlying ?? "").localeCompare(b.underlying ?? "", undefined, {
        sensitivity: "base",
      });
    case "side":
      return (a.side ?? "").localeCompare(b.side ?? "", undefined, {
        sensitivity: "base",
      });
    case "optionType":
      return (a.optionType ?? "").localeCompare(b.optionType ?? "");
    case "price": {
      const pa = a.price;
      const pb = b.price;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    }
    case "net": {
      const na = computeNetAmount(a);
      const nb = computeNetAmount(b);
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      return na - nb;
    }
    case "realizedPnl": {
      const pa = a.realizedPnl;
      const pb = b.realizedPnl;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    }
    default:
      return 0;
  }
}

function SortTh({
  label,
  columnKey,
  currentKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  columnKey: SortKey;
  currentKey: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = currentKey === columnKey;
  const alignClass = align === "right" ? "text-right" : "text-left";
  const btnAlign = align === "right" ? "justify-end" : "justify-start";
  return (
    <th
      scope="col"
      className={`px-3 py-2.5 ${alignClass}`}
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`inline-flex w-full items-center gap-1 font-medium uppercase tracking-wide ${btnAlign} text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200`}
      >
        <span>{label}</span>
        <span className="select-none text-[10px] opacity-70" aria-hidden>
          {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

export default function DashboardClient({
  initialSnapshots = null,
}: {
  initialSnapshots?: LatestSnapshots | null;
}) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [snapshots, setSnapshots] = useState<LatestSnapshots | null>(
    initialSnapshots,
  );
  const [underlying, setUnderlying] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (underlying.trim()) params.set("underlying", underlying.trim());
      if (needsReviewOnly) params.set("needsReview", "1");
      const [tRes, sRes, snapRes] = await Promise.all([
        fetch(`/api/dashboard/trades?${params}`, { credentials: "include" }),
        fetch("/api/dashboard/stats", { credentials: "include" }),
        fetch("/api/dashboard/snapshots", { credentials: "include" }),
      ]);
      if (tRes.status === 401 || sRes.status === 401 || snapRes.status === 401) {
        window.location.href = "/login";
        return { ok: false as const };
      }
      if (!tRes.ok || !sRes.ok) {
        let detail = "Failed to load data";
        try {
          const bad = !tRes.ok ? tRes : sRes;
          const j = (await bad.json()) as { error?: string };
          if (j.error) detail = j.error;
        } catch {
          /* ignore */
        }
        return { ok: false as const, error: detail };
      }
      const tRaw: unknown = await tRes.json();
      const sRaw: unknown = await sRes.json();
      const trades = Array.isArray((tRaw as { trades?: unknown }).trades)
        ? ((tRaw as { trades: TradeRow[] }).trades)
        : [];
      const so =
        sRaw && typeof sRaw === "object"
          ? (sRaw as Partial<Stats>)
          : ({} as Partial<Stats>);
      const stats: Stats = {
        totalTrades: Number(so.totalTrades) || 0,
        totalRealizedPnl: Number(so.totalRealizedPnl) || 0,
        byUnderlying: Array.isArray(so.byUnderlying) ? so.byUnderlying : [],
        byUnderlyingPnl: Array.isArray(so.byUnderlyingPnl)
          ? so.byUnderlyingPnl
          : [],
        byMonth: Array.isArray(so.byMonth) ? so.byMonth : [],
      };
      let latestSnapshots: LatestSnapshots = { balance: null, position: null };
      if (snapRes.ok) {
        const snapRaw = (await snapRes.json()) as LatestSnapshots;
        latestSnapshots = {
          balance: snapRaw.balance ?? null,
          position: snapRaw.position ?? null,
        };
      }
      return { ok: true as const, trades, stats, snapshots: latestSnapshots };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unexpected error loading dashboard";
      return { ok: false as const, error: message };
    }
  }, [underlying, needsReviewOnly]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await load();
      if (cancelled) return;
      if (result.ok === false) {
        if ("error" in result && result.error) {
          setErr(result.error);
        }
        setLoading(false);
        return;
      }
      setErr(null);
      setTrades(result.trades);
      setStats(result.stats);
      setSnapshots(result.snapshots);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        try {
          const result = await load();
          if (!result.ok || !("trades" in result)) return;
          setTrades(result.trades);
          setStats(result.stats);
          if ("snapshots" in result) setSnapshots(result.snapshots);
        } catch {
          /* ignore background refresh errors */
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const monthChartData = useMemo(() => {
    if (!stats?.byMonth?.length) return [];
    return stats.byMonth.map((row) => ({
      ...row,
      monthLabel: formatMonthKey(row.month),
    }));
  }, [stats]);

  /**
   * Prefer Convex `byUnderlyingPnl` (sums over the same sample as other stats).
   * If the field is missing (older deployment) or empty while tickers exist,
   * derive P&L from the loaded trade rows so the chart is not blank.
   */
  const underlyingPnlChartData = useMemo(() => {
    const fromApi = stats?.byUnderlyingPnl;
    if (fromApi && fromApi.length > 0) return fromApi;

    const order = stats?.byUnderlying ?? [];
    if (!order.length) return [];

    const pnlByU = new Map<string, number>();
    for (const t of trades) {
      const u = (t.underlying ?? "UNKNOWN").toUpperCase();
      pnlByU.set(u, (pnlByU.get(u) ?? 0) + (t.realizedPnl ?? 0));
    }
    return order.map(({ underlying }) => ({
      underlying,
      pnl: pnlByU.get(underlying.toUpperCase()) ?? 0,
    }));
  }, [stats?.byUnderlyingPnl, stats?.byUnderlying, trades]);

  function onSortColumn(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  /** Sorted rows; cumulative P&L is running total in **current display order**. */
  const tableRows = useMemo(() => {
    const list = Array.isArray(trades) ? trades : [];
    const sorted = [...list].sort((a, b) => {
      const c = compareTradesByKey(a, b, sortKey);
      return sortDir === "asc" ? c : -c;
    });
    return sorted.reduce<{ trade: TradeRow; cumulativePnl: number }[]>(
      (acc, trade) => {
        const prev = acc.at(-1)?.cumulativePnl ?? 0;
        return [
          ...acc,
          { trade, cumulativePnl: prev + (trade.realizedPnl ?? 0) },
        ];
      },
      [],
    );
  }, [trades, sortKey, sortDir]);

  const monthPnlRows = useMemo(() => {
    if (!stats?.byMonth?.length) return [];
    return [...stats.byMonth].sort((a, b) => a.month.localeCompare(b.month));
  }, [stats]);

  async function deleteOneTrade(tradeId: string) {
    if (!window.confirm("Delete this trade? This cannot be undone.")) return;
    const res = await fetch("/api/dashboard/delete-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tradeId }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(j.error ?? "Delete failed");
      return;
    }
    void load();
  }

  async function clearAllTrades() {
    if (
      !window.confirm(
        `Delete all ${trades.length} trade(s)? This cannot be undone.`,
      )
    ) {
      return;
    }
    const res = await fetch("/api/dashboard/delete-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ clearAll: true }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(j.error ?? "Clear failed");
      return;
    }
    void load();
  }

  function downloadExcel() {
    const params = new URLSearchParams();
    if (underlying.trim()) params.set("underlying", underlying.trim());
    if (needsReviewOnly) params.set("needsReview", "1");
    const q = params.toString();
    window.location.assign(
      `/api/dashboard/export-excel${q ? `?${q}` : ""}`,
    );
  }

  if (loading && !trades.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Options trades
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Live view (refreshes every 5s). Trades are oldest → newest; set{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              P&amp;L
            </span>{" "}
            per row in Edit, or use{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              Mark expired worthless
            </span>{" "}
            on open legs. Sort columns to reorder; cumulative P&amp;L updates in
            that order. Use{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              Download Excel
            </span>{" "}
            to export (respects filters; up to 500 rows). Telegram: trade
            screenshots with no caption; IBKR account screenshots with caption{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              balance
            </span>{" "}
            or{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              position
            </span>{" "}
            (any capitalization).
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Home
        </Link>
      </header>

      {stats ? (
        <section className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <StatCard label="Total trades" value={String(stats.totalTrades)} />
          <StatCard
            label="Total profit & loss"
            value={formatMoney(stats.totalRealizedPnl)}
            valueClassName={pnlClass(stats.totalRealizedPnl)}
          />
        </section>
      ) : null}

      <AccountSnapshotsSection snapshots={snapshots} />

      {monthPnlRows.length > 0 ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Profit &amp; loss by month
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Realized P&amp;L grouped by calendar month (uses expiration / P&amp;L date when set).
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[18rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="py-2 pr-4 font-medium">Month</th>
                  <th className="py-2 pr-4 text-right font-medium">Trades</th>
                  <th className="py-2 text-right font-medium">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {monthPnlRows.map((row) => (
                  <tr
                    key={row.month}
                    className="border-b border-zinc-100 dark:border-zinc-800/80"
                  >
                    <td className="py-2 pr-4 text-zinc-800 dark:text-zinc-200">
                      {formatMonthKey(row.month)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                      {row.count}
                    </td>
                    <td
                      className={`py-2 text-right font-medium tabular-nums ${pnlClass(row.pnl)}`}
                    >
                      {formatMoney(row.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <DashboardCharts
        byUnderlying={stats?.byUnderlying ?? []}
        byUnderlyingPnl={underlyingPnlChartData}
        monthChartData={monthChartData}
      />

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          Underlying prefix
          <input
            value={underlying}
            onChange={(e) => setUnderlying(e.target.value)}
            placeholder="e.g. SPY"
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={needsReviewOnly}
            onChange={(e) => setNeedsReviewOnly(e.target.checked)}
          />
          Needs review only
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => downloadExcel()}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
        >
          Download Excel
        </button>
        {trades.length > 0 ? (
          <button
            type="button"
            onClick={() => void clearAllTrades()}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Clear all trades
          </button>
        ) : null}
      </section>

      {err ? (
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      ) : null}

      <ManualAddWorthlessSection onCreated={() => void load()} />

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[72rem] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <SortTh
                label="Underlying"
                columnKey="underlying"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
              />
              <SortTh
                label="Action"
                columnKey="side"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
              />
              <SortTh
                label="Type"
                columnKey="optionType"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
              />
              <SortTh
                label="Price"
                columnKey="price"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
                align="right"
              />
              <SortTh
                label="Date entered"
                columnKey="createdAt"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
              />
              <SortTh
                label="Net amount"
                columnKey="net"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
                align="right"
              />
              <SortTh
                label="P&L"
                columnKey="realizedPnl"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
                align="right"
              />
              <th
                className="px-3 py-2.5 text-right font-medium"
                title="Running total of realized P&amp;L in the current sort order"
              >
                Cumulative P&amp;L
              </th>
              <th className="px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ trade: t, cumulativePnl }) => (
              <TradeTableRow
                key={t._id}
                trade={t}
                allTrades={trades}
                cumulativePnl={cumulativePnl}
                onDelete={() => void deleteOneTrade(t._id)}
                onUpdated={() => void load()}
              />
            ))}
          </tbody>
        </table>
        {trades.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            No trades yet. Send a SELL TO OPEN screenshot to your Telegram bot, or
            use <span className="font-medium">Add expired worthless</span> below if
            you have no screenshot.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName ?? "text-zinc-900 dark:text-zinc-50"}`}
      >
        {value}
      </p>
    </div>
  );
}

function AccountSnapshotsSection(props: {
  snapshots: LatestSnapshots | null;
}) {
  const { snapshots } = props;
  if (!snapshots?.balance && !snapshots?.position) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Account snapshots
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Send IBKR Balances screenshot to Telegram with caption{" "}
          <span className="font-medium">balance</span>, then Portfolio →
          Positions with caption <span className="font-medium">position</span>.
        </p>
      </section>
    );
  }

  function fmtSnap(n?: number, currency?: string) {
    if (n == null) return "—";
    return formatMoney(n, currency ?? "USD");
  }

  function fmtWhen(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Account snapshots
      </h2>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Latest Telegram uploads (caption balance / position).
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {snapshots.balance ? (
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-xs font-medium uppercase text-zinc-500">Balance</p>
            <p className="mt-1 text-xs text-zinc-500">
              {fmtWhen(snapshots.balance.createdAt)}
              {snapshots.balance.needsReview ? " · needs review" : ""}
            </p>
            <p className="mt-2 text-sm">
              Net liq {fmtSnap(snapshots.balance.netLiquidation, snapshots.balance.currency)}
            </p>
            <p className="text-sm">
              Excess liq{" "}
              {fmtSnap(snapshots.balance.excessLiquidity, snapshots.balance.currency)}
            </p>
            <p className="text-sm">
              Init margin{" "}
              {fmtSnap(snapshots.balance.initialMargin, snapshots.balance.currency)}
            </p>
          </div>
        ) : null}
        {snapshots.position ? (
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-xs font-medium uppercase text-zinc-500">Position</p>
            <p className="mt-1 text-xs text-zinc-500">
              {fmtWhen(snapshots.position.createdAt)}
              {snapshots.position.needsReview ? " · needs review" : ""}
            </p>
            <p className="mt-2 text-sm">
              Unrealized{" "}
              {fmtSnap(snapshots.position.unrealizedPnl, snapshots.position.currency)}
            </p>
            <p className="text-sm">
              Maint margin{" "}
              {fmtSnap(
                snapshots.position.maintenanceMargin,
                snapshots.position.currency,
              )}
            </p>
            <p className="text-sm">
              Positions tracked: {snapshots.position.positions?.length ?? 0}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function tradeDraftFromTrade(t: TradeRow) {
  return {
    underlying: t.underlying ?? "",
    side: t.side ?? "",
    optionType: t.optionType ?? "",
    expiration: t.expiration ?? "",
    price:
      t.price === undefined || t.price === null ? "" : String(t.price),
    realizedPnl:
      t.realizedPnl === undefined || t.realizedPnl === null
        ? ""
        : String(t.realizedPnl),
    pnlDate:
      t.pnlDate == null
        ? ""
        : new Date(t.pnlDate).toISOString().slice(0, 10),
    strike: t.strike === undefined || t.strike === null ? "" : String(t.strike),
    quantity:
      t.quantity === undefined || t.quantity === null ? "" : String(t.quantity),
    fees: t.fees === undefined || t.fees === null ? "" : String(t.fees),
    notes: t.notes ?? "",
    needsReview: t.needsReview,
  };
}

function TradeTableRow(props: {
  trade: TradeRow;
  allTrades: TradeRow[];
  cumulativePnl: number;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const { trade: t, allTrades, cumulativePnl, onDelete, onUpdated } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => tradeDraftFromTrade(t));
  const [worthlessOpen, setWorthlessOpen] = useState(false);
  const [worthlessExpiration, setWorthlessExpiration] = useState(
    t.expiration ?? "",
  );
  const [worthlessSaving, setWorthlessSaving] = useState(false);

  async function save() {
    const pnlDateTs =
      draft.pnlDate === ""
        ? undefined
        : expirationToPnlDate(draft.pnlDate) ?? undefined;
    await fetch("/api/dashboard/update-trade", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        tradeId: t._id,
        patch: {
          underlying: draft.underlying || undefined,
          side: draft.side || undefined,
          optionType:
            draft.optionType === ""
              ? undefined
              : (draft.optionType as TradeRow["optionType"]),
          expiration: draft.expiration || undefined,
          price: draft.price === "" ? undefined : Number(draft.price),
          realizedPnl:
            draft.realizedPnl === "" ? undefined : Number(draft.realizedPnl),
          pnlDate: pnlDateTs,
          strike: draft.strike === "" ? undefined : Number(draft.strike),
          quantity: draft.quantity === "" ? undefined : Number(draft.quantity),
          fees: draft.fees === "" ? undefined : Number(draft.fees),
          notes: draft.notes || undefined,
          needsReview: draft.needsReview,
        },
      }),
    });
    setEditing(false);
    onUpdated();
  }

  async function confirmMarkWorthless() {
    if (hasCloseMatchForHide(t, allTrades)) {
      window.alert(
        "A matching close row exists for this contract (same strike). P&L is on the close row — do not mark worthless here.",
      );
      return;
    }
    const warning = getWorthlessCloseWarning(t, allTrades);
    if (
      warning &&
      !window.confirm(`${warning}\n\nMark as expired worthless anyway?`)
    ) {
      return;
    }
    const expiration = worthlessExpiration.trim() || t.expiration;
    if (!expiration) {
      window.alert("Enter an expiration date (YYYY-MM-DD) first.");
      return;
    }
    const pnl = computeWorthlessExpirationPnl(t);
    if (pnl == null) {
      window.alert("Cannot compute P&L from this row (missing qty/price).");
      return;
    }
    const pnlDate = expirationToPnlDate(expiration);
    if (pnlDate == null) {
      window.alert("Expiration must be YYYY-MM-DD.");
      return;
    }
    setWorthlessSaving(true);
    try {
      await fetch("/api/dashboard/update-trade", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          tradeId: t._id,
          patch: {
            expiration,
            realizedPnl: pnl,
            pnlDate,
            notes: appendWorthlessNote(t.notes),
            needsReview: false,
          },
        }),
      });
      setWorthlessOpen(false);
      onUpdated();
    } finally {
      setWorthlessSaving(false);
    }
  }

  const showMarkWorthless = canMarkWorthlessExpiration(t, allTrades);
  const worthlessPreview = computeWorthlessExpirationPnl(t);
  const worthlessWarning = getWorthlessCloseWarning(t, allTrades);

  const net = computeNetAmount(t);
  const pnl = t.realizedPnl;
  const dateEntered = new Date(t.createdAt);

  const COLS = 9;

  if (editing) {
    return (
      <>
        <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/80">
          <td colSpan={COLS} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-zinc-500">
                Underlying
                <input
                  className="mt-0.5 block w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.underlying}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, underlying: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Action
                <input
                  className="mt-0.5 block w-40 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.side}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, side: e.target.value }))
                  }
                  placeholder="e.g. SELL TO OPEN"
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Type
                <select
                  className="mt-0.5 block w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.optionType}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, optionType: e.target.value }))
                  }
                >
                  <option value="">—</option>
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Expiration
                <input
                  type="date"
                  className="mt-0.5 block rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.expiration}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, expiration: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                P&amp;L date
                <input
                  type="date"
                  className="mt-0.5 block rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.pnlDate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, pnlDate: e.target.value }))
                  }
                  title="Month this P&L counts toward (defaults to date entered)"
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Price
                <input
                  className="mt-0.5 block w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.price}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, price: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                P&amp;L
                <input
                  className="mt-0.5 block w-28 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.realizedPnl}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, realizedPnl: e.target.value }))
                  }
                  placeholder="Realized"
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Strike
                <input
                  className="mt-0.5 block w-20 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.strike}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, strike: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Qty
                <input
                  className="mt-0.5 block w-16 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.quantity}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, quantity: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Fees
                <input
                  className="mt-0.5 block w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
                  value={draft.fees}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, fees: e.target.value }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 pt-4 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.needsReview}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, needsReview: e.target.checked }))
                  }
                />
                Needs review
              </label>
            </div>
            <label className="mt-3 block text-xs font-medium text-zinc-500">
              Notes
              <input
                className="mt-1 w-full max-w-2xl rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
              />
            </label>
            <p className="mt-1 text-[11px] text-zinc-500">
              Type: {formatOptionType(t.optionType)} · Exp {t.expiration ?? "—"}{" "}
              · Date entered {dateEntered.toLocaleString()}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white dark:bg-emerald-600"
                onClick={() => void save()}
              >
                Save
              </button>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
            {t.ingestError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                Ingest: {t.ingestError}
              </p>
            ) : null}
          </td>
        </tr>
      </>
    );
  }

  return (
    <>
      <tr className="border-b border-zinc-100 dark:border-zinc-800">
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {t.underlying ?? "—"}
            </span>
            {isOpenSide(t.side) && hasUnsetRealizedPnl(t.realizedPnl) ? (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                Open
              </span>
            ) : null}
            {t.needsReview ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Review
              </span>
            ) : null}
          </div>
          {t.strike != null || t.expiration ? (
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {t.strike != null ? `${t.strike} ` : ""}
              {t.expiration ?? ""}
            </p>
          ) : null}
        </td>
        <td className="max-w-[10rem] px-3 py-2.5 text-xs leading-snug text-zinc-700 dark:text-zinc-300">
          {t.side ?? "—"}
        </td>
        <td className="px-3 py-2.5 text-zinc-800 dark:text-zinc-200">
          {formatOptionType(t.optionType)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
          {t.price != null ? formatMoney(t.price) : "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600 dark:text-zinc-400">
          <span className="block text-zinc-900 dark:text-zinc-100">
            {dateEntered.toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="text-[11px]">
            {dateEntered.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
          {formatMoney(net)}
        </td>
        <td
          className={`px-3 py-2.5 text-right font-medium ${pnl !== undefined && pnl !== null ? pnlClass(pnl) : "text-zinc-400"}`}
        >
          {pnl !== undefined && pnl !== null ? formatMoney(pnl) : "—"}
        </td>
        <td
          className={`px-3 py-2.5 text-right font-semibold ${pnlClass(cumulativePnl)}`}
        >
          {formatMoney(cumulativePnl)}
        </td>
        <td className="space-x-2 px-3 py-2.5 whitespace-nowrap">
          {showMarkWorthless ? (
            <button
              type="button"
              className="text-sm text-sky-700 dark:text-sky-400"
              onClick={() => {
                setWorthlessExpiration(t.expiration ?? "");
                setWorthlessOpen(true);
              }}
            >
              Mark expired worthless
            </button>
          ) : null}
          <button
            type="button"
            className="text-sm text-emerald-700 dark:text-emerald-400"
            onClick={() => {
              setDraft(tradeDraftFromTrade(t));
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="text-sm text-red-600 hover:underline dark:text-red-400"
            onClick={onDelete}
          >
            Delete
          </button>
        </td>
      </tr>
      {worthlessOpen ? (
        <tr className="border-b border-zinc-100 bg-sky-50 dark:border-zinc-800 dark:bg-sky-950/30">
          <td colSpan={COLS} className="px-3 py-3">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Mark expired worthless
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {t.underlying ?? "—"}{" "}
              {t.strike != null ? `${t.strike} ` : ""}
              {formatOptionType(t.optionType)} · {t.side ?? "—"}
            </p>
            <p className="mt-2 text-sm">
              Realized P&amp;L:{" "}
              <span
                className={`font-semibold ${pnlClass(worthlessPreview ?? 0)}`}
              >
                {worthlessPreview != null
                  ? formatMoney(worthlessPreview, t.currency)
                  : "—"}
              </span>
            </p>
            {!t.expiration ? (
              <label className="mt-3 block text-xs font-medium text-zinc-500">
                Expiration (required for monthly P&amp;L)
                <input
                  type="date"
                  className="mt-0.5 block rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                  value={worthlessExpiration}
                  onChange={(e) => setWorthlessExpiration(e.target.value)}
                />
              </label>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">
                P&amp;L will count in{" "}
                {formatMonthKey(t.expiration.slice(0, 7))} (expiration{" "}
                {t.expiration}).
              </p>
            )}
            {worthlessWarning ? (
              <p className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {worthlessWarning}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={worthlessSaving}
                className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm text-white disabled:opacity-60 dark:bg-sky-600"
                onClick={() => void confirmMarkWorthless()}
              >
                {worthlessSaving ? "Saving…" : "Confirm"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600"
                onClick={() => setWorthlessOpen(false)}
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      ) : null}
      {t.ingestError ? (
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <td
            colSpan={COLS}
            className="px-3 py-1 text-xs text-red-600 dark:text-red-400"
          >
            {t.ingestError}
          </td>
        </tr>
      ) : null}
    </>
  );
}
