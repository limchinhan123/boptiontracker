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
};

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
      return { ok: false as const, error: "Failed to load data" as const };
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

  async function retrySheets(tradeId: string) {
    await fetch("/api/dashboard/retry-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tradeId }),
    });
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
            Live view (refreshes every 5s). Data from Convex; rows sync to
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
      </section>

      {err ? (
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Underlying</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Strike</th>
              <th className="px-3 py-2">Exp</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Fees</th>
              <th className="px-3 py-2">Review</th>
              <th className="px-3 py-2">Sheets</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <TradeTableRow
                key={t._id}
                trade={t}
                onRetrySheets={() => void retrySheets(t._id)}
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

function TradeTableRow(props: {
  trade: TradeRow;
  onRetrySheets: () => void;
  onUpdated: () => void;
}) {
  const { trade: t, onRetrySheets, onUpdated } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    underlying: t.underlying ?? "",
    strike: t.strike === undefined || t.strike === null ? "" : String(t.strike),
    quantity:
      t.quantity === undefined || t.quantity === null ? "" : String(t.quantity),
    fees: t.fees === undefined || t.fees === null ? "" : String(t.fees),
    notes: t.notes ?? "",
    needsReview: t.needsReview,
  });

  async function save() {
    await fetch("/api/dashboard/update-trade", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        tradeId: t._id,
        patch: {
          underlying: draft.underlying || undefined,
          strike:
            draft.strike === "" ? undefined : Number(draft.strike),
          quantity:
            draft.quantity === "" ? undefined : Number(draft.quantity),
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

  const row = (
    <tr className="border-b border-zinc-100 dark:border-zinc-800">
      <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
        {new Date(t.createdAt).toLocaleString()}
      </td>
      {editing ? (
        <>
          <td className="px-3 py-2">
            <input
              className="w-20 rounded border border-zinc-300 px-1 dark:border-zinc-600"
              value={draft.underlying}
              onChange={(e) =>
                setDraft((d) => ({ ...d, underlying: e.target.value }))
              }
            />
          </td>
          <td className="px-3 py-2 text-zinc-500">{t.optionType}</td>
          <td className="px-3 py-2">
            <input
              className="w-16 rounded border border-zinc-300 px-1 dark:border-zinc-600"
              value={draft.strike}
              onChange={(e) =>
                setDraft((d) => ({ ...d, strike: e.target.value }))
              }
            />
          </td>
          <td className="px-3 py-2 text-zinc-500">{t.expiration}</td>
          <td className="px-3 py-2 text-zinc-500">{t.side}</td>
          <td className="px-3 py-2">
            <input
              className="w-12 rounded border border-zinc-300 px-1 dark:border-zinc-600"
              value={draft.quantity}
              onChange={(e) =>
                setDraft((d) => ({ ...d, quantity: e.target.value }))
              }
            />
          </td>
          <td className="px-3 py-2 text-zinc-500">{t.price}</td>
          <td className="px-3 py-2">
            <input
              className="w-14 rounded border border-zinc-300 px-1 dark:border-zinc-600"
              value={draft.fees}
              onChange={(e) =>
                setDraft((d) => ({ ...d, fees: e.target.value }))
              }
            />
          </td>
          <td className="px-3 py-2">
            <input
              type="checkbox"
              checked={draft.needsReview}
              onChange={(e) =>
                setDraft((d) => ({ ...d, needsReview: e.target.checked }))
              }
            />
          </td>
          <td className="px-3 py-2 text-xs text-zinc-500">{sheetsLabel}</td>
          <td className="space-x-2 px-3 py-2">
            <button
              type="button"
              className="text-emerald-700 dark:text-emerald-400"
              onClick={() => void save()}
            >
              Save
            </button>
            <button
              type="button"
              className="text-zinc-500"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </td>
        </>
      ) : (
        <>
          <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
            {t.underlying ?? "—"}
          </td>
          <td className="px-3 py-2">{t.optionType ?? "—"}</td>
          <td className="px-3 py-2">{t.strike ?? "—"}</td>
          <td className="px-3 py-2 whitespace-nowrap">{t.expiration ?? "—"}</td>
          <td className="px-3 py-2 text-xs">{t.side ?? "—"}</td>
          <td className="px-3 py-2">{t.quantity ?? "—"}</td>
          <td className="px-3 py-2">{t.price ?? "—"}</td>
          <td className="px-3 py-2">{t.fees ?? "—"}</td>
          <td className="px-3 py-2">
            {t.needsReview ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Yes
              </span>
            ) : (
              <span className="text-zinc-400">No</span>
            )}
          </td>
          <td className="px-3 py-2 text-xs">
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
                className="mt-0.5 block max-w-[140px] truncate text-[10px] text-red-500"
                title={t.sheetsSyncError}
              >
                {t.sheetsSyncError}
              </span>
            ) : null}
          </td>
          <td className="space-x-2 px-3 py-2 whitespace-nowrap">
            <button
              type="button"
              className="text-sm text-emerald-700 dark:text-emerald-400"
              onClick={() => {
                setDraft({
                  underlying: t.underlying ?? "",
                  strike:
                    t.strike === undefined || t.strike === null
                      ? ""
                      : String(t.strike),
                  quantity:
                    t.quantity === undefined || t.quantity === null
                      ? ""
                      : String(t.quantity),
                  fees:
                    t.fees === undefined || t.fees === null
                      ? ""
                      : String(t.fees),
                  notes: t.notes ?? "",
                  needsReview: t.needsReview,
                });
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
          </td>
        </>
      )}
    </tr>
  );

  if (editing) {
    return (
      <>
        {row}
        <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
          <td colSpan={12} className="px-3 py-2">
            <label className="block text-xs font-medium text-zinc-500">
              Notes
              <input
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600"
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
              />
            </label>
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
      {row}
      {t.ingestError && !editing ? (
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <td
            colSpan={12}
            className="px-3 py-1 text-xs text-red-600 dark:text-red-400"
          >
            {t.ingestError}
          </td>
        </tr>
      ) : null}
    </>
  );
}
