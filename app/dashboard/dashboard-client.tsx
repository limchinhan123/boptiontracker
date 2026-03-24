"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  sheetsSyncedAt?: number;
  sheetsSyncError?: string;
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
  needsReview: number;
  sheetsErrors: number;
  totalFees: number;
  byUnderlying: { underlying: string; count: number }[];
};

export default function DashboardClient() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [underlying, setUnderlying] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
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
    const tJson = (await tRes.json()) as { trades: TradeRow[] };
    const sJson = (await sRes.json()) as Stats;
    return { ok: true as const, trades: tJson.trades, stats: sJson };
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
        const result = await load();
        if (!result.ok || !("trades" in result)) return;
        setTrades(result.trades);
        setStats(result.stats);
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades) {
      const d = new Date(t.createdAt).toISOString().slice(0, 10);
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [trades]);

  /** Oldest first so cumulative P&L reads naturally down the page. */
  const tableRows = useMemo(() => {
    const sorted = [...trades].sort((a, b) => a.createdAt - b.createdAt);
    return sorted.reduce<{ trade: TradeRow; cumulativePnl: number }[]>(
      (acc, trade) => {
        const prev = acc.at(-1)?.cumulativePnl ?? 0;
        return [...acc, { trade, cumulativePnl: prev + (trade.realizedPnl ?? 0) }];
      },
      [],
    );
  }, [trades]);

  async function retrySheets(tradeId: string) {
    await fetch("/api/dashboard/retry-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tradeId }),
    });
    void load();
  }

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
            per row in Edit for a running cumulative total. Data from Convex;
            Google Sheets when configured.
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
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total trades" value={String(stats.totalTrades)} />
          <StatCard label="Needs review" value={String(stats.needsReview)} />
          <StatCard label="Sheets errors" value={String(stats.sheetsErrors)} />
          <StatCard
            label="Fees (sum)"
            value={stats.totalFees.toFixed(2)}
          />
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Trades by underlying
          </h2>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats?.byUnderlying ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
              <XAxis dataKey="underlying" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="h-64 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Trades per day (current filter)
          </h2>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={byDay}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#059669" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

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
              <th className="px-3 py-2.5">Underlying</th>
              <th className="px-3 py-2.5">Action</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5 text-right">Price</th>
              <th className="px-3 py-2.5">Date entered</th>
              <th className="px-3 py-2.5 text-right">Net amount</th>
              <th className="px-3 py-2.5 text-right">P&amp;L</th>
              <th className="px-3 py-2.5 text-right">Cumulative P&amp;L</th>
              <th className="px-3 py-2.5">Sheets</th>
              <th className="px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ trade: t, cumulativePnl }) => (
              <TradeTableRow
                key={t._id}
                trade={t}
                cumulativePnl={cumulativePnl}
                onRetrySheets={() => void retrySheets(t._id)}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
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
  onRetrySheets: () => void;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const { trade: t, cumulativePnl, onRetrySheets, onDelete, onUpdated } = props;
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

  const sheetsOk = Boolean(t.sheetsSyncedAt);
  const sheetsLabel = sheetsOk
    ? "Synced"
    : t.sheetsSyncError
      ? "Error"
      : "Pending";

  const net = computeNetAmount(t);
  const pnl = t.realizedPnl;
  const dateEntered = new Date(t.createdAt);

  const COLS = 10;

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
        <td className="px-3 py-2.5 text-xs">
          <span
            className={
              sheetsOk
                ? "text-emerald-700 dark:text-emerald-400"
                : t.sheetsSyncError
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-500"
            }
          >
            {sheetsLabel}
          </span>
          {t.sheetsSyncError ? (
            <span
              className="mt-0.5 block max-w-[120px] truncate text-[10px] text-red-500"
              title={t.sheetsSyncError}
            >
              {t.sheetsSyncError}
            </span>
          ) : null}
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
          {!sheetsOk ? (
            <button
              type="button"
              className="text-sm text-zinc-600 underline dark:text-zinc-400"
              onClick={onRetrySheets}
            >
              Retry Sheets
            </button>
          ) : null}
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
