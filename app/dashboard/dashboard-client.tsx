"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const DashboardCharts = dynamic(() => import("./dashboard-charts"), {
  ssr: false,
  loading: () => (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
    </section>
  ),
});

export type TradeRow = {
  _id: string;
  _creationTime: number;
  createdAt: number;
  source: "telegram" | "whatsapp";
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

/** Premium/cash proxy: contract total if present, else qty × price × multiplier, minus fees. */
function computeNetAmount(t: TradeRow): number | null {
  const q = t.quantity ?? 0;
  const p = t.price ?? 0;
  const mult = t.multiplier ?? 100;
  const premium = t.total != null ? t.total : q * p * mult;
  const fees = t.fees ?? 0;
  if (t.total == null && q === 0 && p === 0) return null;
  return premium - fees;
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
  byMonth: { month: string; count: number; pnl: number }[];
};

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

export default function DashboardClient() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
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
      const [tRes, sRes] = await Promise.all([
        fetch(`/api/dashboard/trades?${params}`, { credentials: "include" }),
        fetch("/api/dashboard/stats", { credentials: "include" }),
      ]);
      if (tRes.status === 401 || sRes.status === 401) {
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
        byMonth: Array.isArray(so.byMonth) ? so.byMonth : [],
      };
      return { ok: true as const, trades, stats };
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
            per row in Edit. Sort columns to reorder; cumulative P&amp;L updates in
            that order. Use{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              Download Excel
            </span>{" "}
            to export (respects filters; up to 500 rows).
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

      {monthPnlRows.length > 0 ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Profit &amp; loss by month
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Realized P&amp;L grouped by calendar month (same data as the chart below).
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
                cumulativePnl={cumulativePnl}
                onDelete={() => void deleteOneTrade(t._id)}
                onUpdated={() => void load()}
              />
            ))}
          </tbody>
        </table>
        {trades.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            No trades yet. Send a screenshot to your Telegram bot.
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

function tradeDraftFromTrade(t: TradeRow) {
  return {
    underlying: t.underlying ?? "",
    side: t.side ?? "",
    price:
      t.price === undefined || t.price === null ? "" : String(t.price),
    realizedPnl:
      t.realizedPnl === undefined || t.realizedPnl === null
        ? ""
        : String(t.realizedPnl),
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
  cumulativePnl: number;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const { trade: t, cumulativePnl, onDelete, onUpdated } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => tradeDraftFromTrade(t));

  async function save() {
    await fetch("/api/dashboard/update-trade", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        tradeId: t._id,
        patch: {
          underlying: draft.underlying || undefined,
          side: draft.side || undefined,
          price: draft.price === "" ? undefined : Number(draft.price),
          realizedPnl:
            draft.realizedPnl === "" ? undefined : Number(draft.realizedPnl),
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
