"use client";

import { Component, type ReactNode, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function formatMoney(n: number | null | undefined, currency = "USD"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatCompactAxisTick(v: number | string | undefined): string {
  if (v == null || (typeof v === "number" && Number.isNaN(v))) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export type DashboardChartsProps = {
  byUnderlying: { underlying: string; count: number }[];
  monthChartData: {
    month: string;
    count: number;
    pnl: number;
    monthLabel: string;
  }[];
};

class ChartsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Charts could not be loaded. The trade table and filters below still
          work; try a hard refresh (Cmd+Shift+R) or another browser.
        </div>
      );
    }
    return this.props.children;
  }
}

function ChartsInner({ byUnderlying, monthChartData }: DashboardChartsProps) {
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="h-64 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Trades by underlying
        </h2>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byUnderlying}>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-zinc-200 dark:stroke-zinc-700"
            />
            <XAxis dataKey="underlying" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#059669" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex h-64 flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="shrink-0 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Trades by month
          </h2>
          <p className="mb-1 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
            Number of trades in each month
          </p>
          <div className="min-h-0 min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthChartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-zinc-200 dark:stroke-zinc-700"
                />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  width={32}
                />
                <Tooltip
                  formatter={(value) => {
                    if (value == null) return ["—", "Trades"];
                    const n =
                      typeof value === "number" ? value : Number(value);
                    if (Number.isNaN(n)) return [String(value), "Trades"];
                    return [String(n), "Trades"];
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#059669"
                  name="Trades"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="flex h-64 flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="shrink-0 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Realized P&amp;L by month
          </h2>
          <p className="mb-1 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
            Sum of realized P&amp;L booked in each month
          </p>
          <div className="min-h-0 min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthChartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-zinc-200 dark:stroke-zinc-700"
                />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={44}
                  tickFormatter={formatCompactAxisTick}
                />
                <Tooltip
                  formatter={(value) => {
                    if (value == null) return ["—", "P&L"];
                    const num =
                      typeof value === "number" ? value : Number(value);
                    if (Number.isNaN(num))
                      return [String(value ?? "—"), "P&L"];
                    const money = formatMoney(num);
                    const colorClass =
                      num < 0
                        ? "text-red-600 dark:text-red-400"
                        : num > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-700 dark:text-zinc-300";
                    return [
                      <span key="pnl" className={colorClass}>
                        {money}
                      </span>,
                      "P&L",
                    ];
                  }}
                />
                <ReferenceLine
                  y={0}
                  stroke="#a1a1aa"
                  strokeDasharray="4 4"
                />
                <Bar dataKey="pnl" name="P&L" radius={[4, 4, 0, 0]}>
                  {monthChartData.map((row) => (
                    <Cell
                      key={row.month}
                      fill={
                        row.pnl < 0
                          ? "#dc2626"
                          : row.pnl > 0
                            ? "#059669"
                            : "#71717a"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DashboardCharts(props: DashboardChartsProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!mounted) {
    return (
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="flex flex-col gap-4">
          <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
          <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
      </section>
    );
  }

  return (
    <ChartsErrorBoundary>
      <ChartsInner {...props} />
    </ChartsErrorBoundary>
  );
}
