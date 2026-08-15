"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { isStaleCoachText } from "@/lib/coach-payload";
import {
  computeCoachHealth,
  openQuestionInNarrative,
  type CoachHealth,
} from "@/lib/coach-health";
import { COACH_LOGIC_VERSION, DEFAULT_COACH_PROFILE } from "@/lib/coach-version";
import { useDashboardLiveSync } from "./use-dashboard-live-sync";

const DashboardCharts = dynamic(() => import("./dashboard-charts"), {
  ssr: false,
  loading: () => (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="h-64 animate-pulse rounded-xl border border-edge bg-surface-2" />
      <div className="h-64 animate-pulse rounded-xl border border-edge bg-surface-2" />
      <div className="h-64 animate-pulse rounded-xl border border-edge bg-surface-2" />
      <div className="h-64 animate-pulse rounded-xl border border-edge bg-surface-2" />
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
    <section className="rounded-xl border border-edge bg-surface">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 p-4 text-left hover:bg-surface-hover"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            Add expired worthless
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            No-screenshot fallback · click to {open ? "collapse" : "expand"}
          </p>
        </div>
        <span className="mt-0.5 shrink-0 text-xs text-ink-muted" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-edge px-4 py-4">
          <p className="text-xs text-ink-muted">
            Fallback when you never sent the open screenshot. P&amp;L counts in
            the expiration month.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-ink-muted">
              Underlying
              <input
                className="mt-0.5 block w-24 rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                value={form.underlying}
                onChange={(e) =>
                  setForm((f) => ({ ...f, underlying: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Type
              <select
                className="mt-0.5 block w-24 rounded border border-edge-strong bg-field px-2 py-1 text-sm"
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
            <label className="text-xs font-medium text-ink-muted">
              Strike
              <input
                className="mt-0.5 block w-20 rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                value={form.strike}
                onChange={(e) =>
                  setForm((f) => ({ ...f, strike: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Expiration
              <input
                type="date"
                required
                className="mt-0.5 block rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                value={form.expiration}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiration: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Side
              <select
                className="mt-0.5 block w-36 rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                value={form.side}
                onChange={(e) =>
                  setForm((f) => ({ ...f, side: e.target.value }))
                }
              >
                <option value="SELL TO OPEN">SELL TO OPEN</option>
                <option value="BUY TO OPEN">BUY TO OPEN</option>
              </select>
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Qty
              <input
                className="mt-0.5 block w-16 rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                value={form.quantity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, quantity: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Price
              <input
                className="mt-0.5 block w-24 rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                value={form.price}
                onChange={(e) =>
                  setForm((f) => ({ ...f, price: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Fees
              <input
                className="mt-0.5 block w-20 rounded border border-edge-strong bg-field px-2 py-1 text-sm"
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
              className="rounded-lg bg-accent-solid px-3 py-1.5 text-sm text-white disabled:opacity-60"
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
  if (n > 0) return "text-pnl-up tabular-nums";
  if (n < 0) return "text-pnl-down tabular-nums";
  return "tabular-nums text-ink-soft";
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

type WeeklyReviewRow = {
  _id: string;
  weekEnding: string;
  generatedAt: number;
  narrativeMarkdown: string;
  memoryMarkdown: string;
  model: string;
  openQuestion?: string;
  coachLogicVersion?: number;
};

type DashboardLoadFilters = {
  underlying?: string;
  needsReviewOnly?: boolean;
};

type DashboardLoadResult =
  | { ok: false; error?: string }
  | {
      ok: true;
      trades: TradeRow[];
      stats: Stats;
      snapshots: LatestSnapshots;
      review: WeeklyReviewRow | null;
      coachHealth: CoachHealth | null;
      profileNotes: string;
      archivedReviewCount: number;
    };

export type { LatestSnapshots, AccountSnapshotRow, WeeklyReviewRow, CoachHealth };

function formatMonthKey(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatExpiration(iso?: string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type SortKey =
  | "createdAt"
  | "underlying"
  | "expiration"
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
    case "expiration": {
      const ea = a.expiration ?? "";
      const eb = b.expiration ?? "";
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      return ea.localeCompare(eb);
    }
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
        className={`inline-flex w-full items-center gap-1 font-medium uppercase tracking-wide ${btnAlign} text-ink-muted hover:text-ink`}
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
  initialReview = null,
}: {
  initialSnapshots?: LatestSnapshots | null;
  initialReview?: WeeklyReviewRow | null;
}) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [snapshots, setSnapshots] = useState<LatestSnapshots | null>(
    initialSnapshots,
  );
  const [review, setReview] = useState<WeeklyReviewRow | null>(initialReview);
  const [coachHealth, setCoachHealth] = useState<CoachHealth | null>(null);
  const [profileNotes, setProfileNotes] = useState(DEFAULT_COACH_PROFILE);
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [archivedReviewCount, setArchivedReviewCount] = useState(0);
  const [generatingReview, setGeneratingReview] = useState(false);
  const [coachBusy, setCoachBusy] = useState(false);
  const [underlying, setUnderlying] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [journalOpen, setJournalOpen] = useState(false);
  const underlyingRef = useRef(underlying);
  const needsReviewOnlyRef = useRef(needsReviewOnly);
  const profileDirtyRef = useRef(profileDirty);

  useEffect(() => {
    underlyingRef.current = underlying;
  }, [underlying]);

  useEffect(() => {
    needsReviewOnlyRef.current = needsReviewOnly;
  }, [needsReviewOnly]);

  useEffect(() => {
    profileDirtyRef.current = profileDirty;
  }, [profileDirty]);

  const load = useCallback(async (
    filters?: DashboardLoadFilters,
  ): Promise<DashboardLoadResult> => {
    try {
      const selectedUnderlying =
        filters?.underlying ?? underlyingRef.current;
      const selectedNeedsReviewOnly =
        filters?.needsReviewOnly ?? needsReviewOnlyRef.current;
      const params = new URLSearchParams();
      if (selectedUnderlying.trim()) {
        params.set("underlying", selectedUnderlying.trim());
      }
      if (selectedNeedsReviewOnly) params.set("needsReview", "1");
      const [tRes, sRes, snapRes, reviewRes] = await Promise.all([
        fetch(`/api/dashboard/trades?${params}`, { credentials: "include" }),
        fetch("/api/dashboard/stats", { credentials: "include" }),
        fetch("/api/dashboard/snapshots", { credentials: "include" }),
        fetch("/api/dashboard/reviews/latest", { credentials: "include" }),
      ]);
      if (
        tRes.status === 401 ||
        sRes.status === 401 ||
        snapRes.status === 401 ||
        reviewRes.status === 401
      ) {
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
      let latestReview: WeeklyReviewRow | null = null;
      let health: CoachHealth | null = null;
      let latestProfile = DEFAULT_COACH_PROFILE;
      let archivedCount = 0;
      if (reviewRes.ok) {
        const reviewRaw = (await reviewRes.json()) as {
          review?: WeeklyReviewRow | null;
          health?: CoachHealth | null;
          profileNotes?: string;
          archivedReviewCount?: number;
        };
        latestReview = reviewRaw.review ?? null;
        health = reviewRaw.health ?? null;
        if (typeof reviewRaw.profileNotes === "string") {
          latestProfile = reviewRaw.profileNotes;
        }
        archivedCount = Number(reviewRaw.archivedReviewCount) || 0;
      }
      return {
        ok: true as const,
        trades,
        stats,
        snapshots: latestSnapshots,
        review: latestReview,
        coachHealth: health,
        profileNotes: latestProfile,
        archivedReviewCount: archivedCount,
      };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unexpected error loading dashboard";
      return { ok: false as const, error: message };
    }
  }, []);

  const applyDashboardData = useCallback(
    (result: Extract<DashboardLoadResult, { ok: true }>) => {
      setErr(null);
      setTrades(result.trades);
      setStats(result.stats);
      setSnapshots(result.snapshots);
      setReview(result.review);
      setCoachHealth(result.coachHealth);
      setArchivedReviewCount(result.archivedReviewCount);
      if (!profileDirtyRef.current) setProfileNotes(result.profileNotes);
    },
    [],
  );

  const refreshDashboardData = useCallback(
    async (filters?: DashboardLoadFilters) => {
      const result = await load(filters);
      if (result.ok === false) {
        if ("error" in result && result.error) {
          setErr(result.error);
        }
        return;
      }
      applyDashboardData(result);
    },
    [applyDashboardData, load],
  );

  useDashboardLiveSync(() => {
    void refreshDashboardData();
  });

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
      applyDashboardData(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDashboardData, load]);

  async function refreshCoachFromLatest() {
    const res = await fetch("/api/dashboard/reviews/latest", {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      review?: WeeklyReviewRow | null;
      health?: CoachHealth | null;
      profileNotes?: string;
      archivedReviewCount?: number;
    };
    if (data.review !== undefined) setReview(data.review);
    if (data.health !== undefined) setCoachHealth(data.health);
    if (typeof data.archivedReviewCount === "number") {
      setArchivedReviewCount(data.archivedReviewCount);
    }
    if (typeof data.profileNotes === "string" && !profileDirty) {
      setProfileNotes(data.profileNotes);
    }
  }

  async function saveCoachProfile() {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/dashboard/coach/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profileNotes }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setProfileDirty(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingProfile(false);
    }
  }

  async function archiveAndContinue(generateAfter: boolean) {
    const msg = generateAfter
      ? "Archive all current reviews (kept for download, excluded from coach memory) and generate a fresh review?"
      : "Archive all current reviews? They stay downloadable but won't feed the next coach run.";
    if (!window.confirm(msg)) return;
    setCoachBusy(true);
    try {
      const url = generateAfter
        ? "/api/dashboard/reviews/archive?generate=1"
        : "/api/dashboard/reviews/archive";
      const res = await fetch(url, { method: "POST", credentials: "include" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as {
        error?: string;
        review?: WeeklyReviewRow;
      };
      if (!res.ok) throw new Error(data.error ?? "Archive failed");
      if (data.review) setReview(data.review);
      await refreshCoachFromLatest();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setCoachBusy(false);
    }
  }

  async function startFreshCoach() {
    if (
      !window.confirm(
        "Delete ALL coach reviews and memory? This cannot be undone. Use Archive & continue unless you hit a bad bug.",
      )
    ) {
      return;
    }
    setCoachBusy(true);
    try {
      const res = await fetch("/api/dashboard/reviews/reset", {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Reset failed");
      setReview(null);
      setCoachHealth(null);
      await refreshCoachFromLatest();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setCoachBusy(false);
    }
  }

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

  /** Cumulative P&L is chronological so it keeps the same meaning when the table is sorted. */
  const cumulativePnlByTradeId = useMemo(() => {
    const map = new Map<string, number>();
    let runningTotal = 0;
    const chronological = [...(Array.isArray(trades) ? trades : [])].sort(
      (a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id),
    );

    for (const trade of chronological) {
      runningTotal += trade.realizedPnl ?? 0;
      map.set(trade._id, runningTotal);
    }

    return map;
  }, [trades]);

  /** Sorted rows for display. */
  const tableRows = useMemo(() => {
    const list = Array.isArray(trades) ? trades : [];
    const sorted = [...list].sort((a, b) => {
      const c = compareTradesByKey(a, b, sortKey);
      return sortDir === "asc" ? c : -c;
    });
    return sorted.map((trade) => ({
      trade,
      cumulativePnl: cumulativePnlByTradeId.get(trade._id) ?? 0,
    }));
  }, [trades, sortKey, sortDir, cumulativePnlByTradeId]);

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
    void refreshDashboardData();
  }

  async function generateReview() {
    setGeneratingReview(true);
    try {
      const res = await fetch("/api/dashboard/reviews/generate", {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as {
        error?: string;
        review?: WeeklyReviewRow;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Generate failed");
      }
      if (data.review) setReview(data.review);
      await refreshCoachFromLatest();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGeneratingReview(false);
    }
  }

  function downloadReview(kind: "full" | "memory") {
    const url =
      kind === "memory"
        ? "/api/dashboard/reviews/export?kind=memory"
        : "/api/dashboard/reviews/export";
    window.open(url, "_blank", "noopener,noreferrer");
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
    void refreshDashboardData();
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
      <div className="flex flex-1 items-center justify-center text-ink-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Options trades
        </h1>
        <Link
          href="/"
          className="text-sm text-accent hover:underline"
        >
          Home
        </Link>
      </header>

      {stats ? (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
          <StatCard label="Total trades" value={String(stats.totalTrades)} />
          <StatCard
            label="Total profit & loss"
            value={formatMoney(stats.totalRealizedPnl)}
            valueClassName={pnlClass(stats.totalRealizedPnl)}
          />
          <AccountSnapshotsSection snapshots={snapshots} compact />
        </section>
      ) : (
        <AccountSnapshotsSection snapshots={snapshots} />
      )}

      <WeeklyCoachSection
        review={review}
        health={coachHealth}
        profileNotes={profileNotes}
        profileDirty={profileDirty}
        savingProfile={savingProfile}
        archivedReviewCount={archivedReviewCount}
        generating={generatingReview}
        coachBusy={coachBusy}
        onProfileChange={(notes) => {
          setProfileNotes(notes);
          setProfileDirty(true);
        }}
        onSaveProfile={() => void saveCoachProfile()}
        onGenerate={() => void generateReview()}
        onArchiveAndContinue={(gen) => void archiveAndContinue(gen)}
        onStartFresh={() => void startFreshCoach()}
        onDownloadFull={() => downloadReview("full")}
        onDownloadMemory={() => downloadReview("memory")}
      />

      {monthPnlRows.length > 0 ? (
        <section className="rounded-xl border border-edge bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">
            Profit &amp; loss by month
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Realized P&amp;L grouped by calendar month (uses expiration / P&amp;L date when set).
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[18rem] text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="py-2 pr-4 font-medium">Month</th>
                  <th className="py-2 pr-4 text-right font-medium">Trades</th>
                  <th className="py-2 text-right font-medium">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {monthPnlRows.map((row) => (
                  <tr
                    key={row.month}
                    className="border-b border-edge-soft"
                  >
                    <td className="py-2 pr-4 text-ink">
                      {formatMonthKey(row.month)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-ink-soft">
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

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-surface p-4">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Underlying prefix
          <input
            value={underlying}
            onChange={(e) => setUnderlying(e.target.value)}
            placeholder="e.g. SPY"
            className="rounded-lg border border-edge-strong bg-field px-2 py-1.5 text-ink"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={needsReviewOnly}
            onChange={(e) => {
              const checked = e.target.checked;
              setNeedsReviewOnly(checked);
              needsReviewOnlyRef.current = checked;
              void refreshDashboardData({
                underlying,
                needsReviewOnly: checked,
              });
            }}
          />
          Needs review only
        </label>
        <button
          type="button"
          onClick={() =>
            void refreshDashboardData({ underlying, needsReviewOnly })
          }
          className="rounded-lg bg-ink px-3 py-1.5 text-sm text-background"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => downloadExcel()}
          className="rounded-lg border border-edge-strong px-3 py-1.5 text-sm text-ink-soft hover:bg-surface-hover"
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

      <ManualAddWorthlessSection onCreated={() => void refreshDashboardData()} />

      <section className="rounded-xl border border-edge bg-surface">
        <button
          type="button"
          aria-expanded={journalOpen}
          onClick={() => setJournalOpen((v) => !v)}
          className="flex w-full items-start justify-between gap-2 p-4 text-left hover:bg-surface-hover"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">
              Trade journal
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {trades.length} trade{trades.length === 1 ? "" : "s"}
              {needsReviewOnly ? " · needs review only" : ""}
              {underlying.trim() ? ` · ${underlying.trim()}` : ""}
              {` · click to ${journalOpen ? "collapse" : "expand"}`}
            </p>
          </div>
          <span className="mt-0.5 shrink-0 text-xs text-ink-muted" aria-hidden>
            {journalOpen ? "▲" : "▼"}
          </span>
        </button>
        <div
          className={`overflow-x-auto border-t border-edge ${
            journalOpen ? "block" : "hidden"
          }`}
        >
        <table className="w-full min-w-[72rem] text-left text-sm">
          <thead className="border-b border-edge bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <SortTh
                label="Underlying"
                columnKey="underlying"
                currentKey={sortKey}
                dir={sortDir}
                onSort={onSortColumn}
              />
              <SortTh
                label="Expiration"
                columnKey="expiration"
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
                title="Running total of realized P&L in chronological trade-date order"
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
                onUpdated={() => void refreshDashboardData()}
              />
            ))}
          </tbody>
        </table>
        {trades.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-muted">
            No trades yet. Send a SELL TO OPEN screenshot to your Telegram bot, or
            use <span className="font-medium">Add expired worthless</span> below if
            you have no screenshot.
          </p>
        ) : null}
        </div>
      </section>
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
    <div className="flex h-full flex-col rounded-xl border border-edge bg-surface p-4">
      <p className="text-xs font-medium uppercase text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName ?? "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

function AccountSnapshotsSection(props: {
  snapshots: LatestSnapshots | null;
  compact?: boolean;
}) {
  const { snapshots, compact = false } = props;
  const [open, setOpen] = useState(false);
  const hasData = Boolean(snapshots?.balance || snapshots?.position);

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

  const body = !hasData ? (
    <p className="mt-2 text-xs text-ink-muted">
      Send IBKR Balances screenshot to Telegram with caption{" "}
      <span className="font-medium">balance</span>, then Portfolio → Positions
      with caption <span className="font-medium">position</span>.
    </p>
  ) : compact ? (
    <div className="mt-2 space-y-1.5 text-sm leading-snug text-ink-soft">
      {snapshots?.balance ? (
        <p>
          <span className="text-xs font-medium uppercase text-ink-muted">Bal</span>{" "}
          {fmtSnap(snapshots.balance.netLiquidation, snapshots.balance.currency)}{" "}
          · excess{" "}
          {fmtSnap(snapshots.balance.excessLiquidity, snapshots.balance.currency)}
        </p>
      ) : null}
      {snapshots?.position ? (
        <p>
          <span className="text-xs font-medium uppercase text-ink-muted">Pos</span>{" "}
          {snapshots.position.positions?.length ?? 0} lines · maint{" "}
          {fmtSnap(
            snapshots.position.maintenanceMargin,
            snapshots.position.currency,
          )}
        </p>
      ) : null}
      <p className="text-xs text-ink-muted">
        {snapshots?.balance ? fmtWhen(snapshots.balance.createdAt) : null}
        {snapshots?.balance && snapshots?.position ? " · " : null}
        {snapshots?.position ? fmtWhen(snapshots.position.createdAt) : null}
      </p>
    </div>
  ) : (
    <div className="mt-2 space-y-2">
      {snapshots?.balance ? (
        <div className="rounded-lg border border-edge p-2.5">
          <p className="text-xs font-medium uppercase text-ink-muted">Balance</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {fmtWhen(snapshots.balance.createdAt)}
            {snapshots.balance.needsReview ? " · needs review" : ""}
          </p>
          <p className="mt-1.5 text-sm leading-snug">
            Net liq{" "}
            {fmtSnap(
              snapshots.balance.netLiquidation,
              snapshots.balance.currency,
            )}
          </p>
          <p className="text-sm leading-snug">
            Excess liq{" "}
            {fmtSnap(
              snapshots.balance.excessLiquidity,
              snapshots.balance.currency,
            )}
          </p>
          <p className="text-sm leading-snug">
            Init margin{" "}
            {fmtSnap(
              snapshots.balance.initialMargin,
              snapshots.balance.currency,
            )}
          </p>
        </div>
      ) : null}
      {snapshots?.position ? (
        <div className="rounded-lg border border-edge p-2.5">
          <p className="text-xs font-medium uppercase text-ink-muted">Position</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {fmtWhen(snapshots.position.createdAt)}
            {snapshots.position.needsReview ? " · needs review" : ""}
          </p>
          <p className="mt-1.5 text-sm leading-snug">
            Unrealized{" "}
            {fmtSnap(
              snapshots.position.unrealizedPnl,
              snapshots.position.currency,
            )}
          </p>
          <p className="text-sm leading-snug">
            Maint margin{" "}
            {fmtSnap(
              snapshots.position.maintenanceMargin,
              snapshots.position.currency,
            )}
          </p>
          <p className="text-sm leading-snug">
            Positions tracked: {snapshots.position.positions?.length ?? 0}
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={`flex h-full flex-col rounded-xl border bg-surface ${
        hasData
          ? "border-edge"
          : "border-dashed border-edge-strong"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-2 p-4 text-left lg:pointer-events-none"
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            Account snapshots
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {hasData
              ? compact
                ? "Latest IBKR uploads via Telegram."
                : "Latest Telegram uploads (caption balance / position)."
              : "Optional — tap to set up."}
          </p>
        </div>
        <span
          className="mt-0.5 shrink-0 text-xs text-ink-muted lg:hidden"
          aria-hidden
        >
          {open ? "▲" : "▼"}
        </span>
      </button>
      <div className={`px-4 pb-4 ${open ? "block" : "hidden"} lg:block`}>
        {body}
      </div>
    </div>
  );
}

function WeeklyCoachSection(props: {
  review: WeeklyReviewRow | null;
  health: CoachHealth | null;
  profileNotes: string;
  profileDirty: boolean;
  savingProfile: boolean;
  archivedReviewCount: number;
  generating: boolean;
  coachBusy: boolean;
  onProfileChange: (notes: string) => void;
  onSaveProfile: () => void;
  onGenerate: () => void;
  onArchiveAndContinue: (generateAfter: boolean) => void;
  onStartFresh: () => void;
  onDownloadFull: () => void;
  onDownloadMemory: () => void;
}) {
  const {
    review,
    health,
    profileNotes,
    profileDirty,
    savingProfile,
    archivedReviewCount,
    generating,
    coachBusy,
    onProfileChange,
    onSaveProfile,
    onGenerate,
    onArchiveAndContinue,
    onStartFresh,
    onDownloadFull,
    onDownloadMemory,
  } = props;
  const [open, setOpen] = useState(false);
  const stale = review
    ? isStaleCoachText(review.narrativeMarkdown + review.memoryMarkdown)
    : false;
  const showOpenQuestionFooter =
    review?.openQuestion &&
    !openQuestionInNarrative(review.narrativeMarkdown, review.openQuestion);

  function fmtWhen(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function healthStyles(status: CoachHealth["status"] | undefined) {
    switch (status) {
      case "ok":
        return "border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200";
      case "regenerate_suggested":
        return "border-sky-300/60 bg-sky-50 text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-200";
      case "stale_pattern":
        return "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200";
      case "generic_memory":
        return "border-orange-300/60 bg-orange-50 text-orange-900 dark:border-orange-800/60 dark:bg-orange-950/30 dark:text-orange-200";
      default:
        return "border-edge bg-surface-2 text-ink-soft";
    }
  }

  const busy = generating || coachBusy;

  return (
    <section className="rounded-xl border border-edge bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-2 p-4 text-left hover:bg-surface-hover"
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            Weekly coach
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {review
              ? `Latest review · week ending ${review.weekEnding} · click to ${open ? "collapse" : "expand"}`
              : `Margin & concentration review · click to ${open ? "collapse" : "expand"}`}
          </p>
        </div>
        <span
          className="mt-0.5 shrink-0 text-xs text-ink-muted"
          aria-hidden
        >
          {open ? "▲" : "▼"}
        </span>
      </button>

      <div className={`px-4 pb-4 ${open ? "block" : "hidden"}`}>
        <p className="text-xs text-ink-muted">
          Risk review from trades + account snapshots. Coach logic v
          {COACH_LOGIC_VERSION}.{" "}
          <span className="font-medium text-ink-soft">
            Full review
          </span>{" "}
          = narrative + fact sheet.{" "}
          <span className="font-medium text-ink-soft">
            Coach memory
          </span>{" "}
          = bullets for the next run.
        </p>

        {health ? (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${healthStyles(health.status)}`}
          >
            <p className="font-medium">{health.label}</p>
            <p className="mt-1 opacity-90">
              Review v{health.reviewLogicVersion ?? "—"} · app v
              {health.coachLogicVersion} · {health.memoryBulletCount} memory
              bullets
              {health.genericBulletCount > 0
                ? ` (${health.genericBulletCount} generic)`
                : ""}
              {archivedReviewCount > 0
                ? ` · ${archivedReviewCount} archived`
                : ""}
            </p>
          </div>
        ) : null}

        <div className="mt-3">
          <label
            htmlFor="coach-profile"
            className="text-xs font-medium text-ink-soft"
          >
            Coach profile
          </label>
          <textarea
            id="coach-profile"
            rows={3}
            value={profileNotes}
            onChange={(e) => onProfileChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-edge-strong bg-field px-3 py-2 text-sm text-ink-soft"
            placeholder="How should the coach interpret your portfolio?"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!profileDirty || savingProfile}
              onClick={onSaveProfile}
              className="rounded-lg border border-edge-strong px-3 py-1.5 text-sm text-ink-soft disabled:opacity-50"
            >
              {savingProfile ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onGenerate}
            className="rounded-lg bg-accent-solid px-3 py-1.5 text-sm text-white disabled:opacity-60"
          >
            {generating
              ? "Generating…"
              : review
                ? "Regenerate review"
                : "Generate review"}
          </button>
          {review ? (
            <>
              <button
                type="button"
                onClick={onDownloadFull}
                title="Full review: narrative, memory, and fact sheet JSON"
                className="rounded-lg border border-edge-strong px-3 py-1.5 text-sm text-ink-soft"
              >
                Full review (.md)
              </button>
              <button
                type="button"
                onClick={onDownloadMemory}
                title="Coach memory only: compact bullets for another LLM"
                className="rounded-lg border border-edge-strong px-3 py-1.5 text-sm text-ink-soft"
              >
                Coach memory (.md)
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onArchiveAndContinue(true)}
            className="rounded-lg border border-edge-strong px-3 py-1.5 text-sm text-ink-soft disabled:opacity-50"
          >
            Archive &amp; continue
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onStartFresh}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-800 disabled:opacity-50 dark:border-red-800 dark:text-red-300"
          >
            Start fresh
          </button>
        </div>

        {stale || health?.status === "stale_pattern" ? (
          <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            This review uses outdated metrics (e.g. open-leg or unrealized
            P&amp;L warnings). Tap{" "}
            <span className="font-medium">Regenerate review</span> — no wipe
            needed unless memory is badly poisoned.
          </p>
        ) : null}

        {review ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-ink-muted">
              Week ending {review.weekEnding} · {fmtWhen(review.generatedAt)} ·{" "}
              {review.model}
              {review.coachLogicVersion != null
                ? ` · coach v${review.coachLogicVersion}`
                : ""}
            </p>
            <div className="rounded-lg border border-edge bg-surface-2 p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
              {review.narrativeMarkdown}
            </div>
            {showOpenQuestionFooter ? (
              <p className="text-sm text-ink-muted">
                <span className="font-medium text-ink">
                  Open question:
                </span>{" "}
                {review.openQuestion}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            No review yet. Upload balance + position snapshots via Telegram,
            then Generate review.
          </p>
        )}
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

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

function parseOptionalDraftNumber(label: string, value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return n;
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
    let price: number | undefined;
    let realizedPnl: number | undefined;
    let strike: number | undefined;
    let quantity: number | undefined;
    let fees: number | undefined;
    try {
      price = parseOptionalDraftNumber("Price", draft.price);
      realizedPnl = parseOptionalDraftNumber("P&L", draft.realizedPnl);
      strike = parseOptionalDraftNumber("Strike", draft.strike);
      quantity = parseOptionalDraftNumber("Quantity", draft.quantity);
      fees = parseOptionalDraftNumber("Fees", draft.fees);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Invalid numeric value.");
      return;
    }

    const pnlDateTs =
      draft.pnlDate === ""
        ? undefined
        : expirationToPnlDate(draft.pnlDate) ?? undefined;
    const clearFields = [
      draft.expiration.trim() === "" && t.expiration != null
        ? "expiration"
        : null,
      draft.price.trim() === "" && t.price != null ? "price" : null,
      draft.realizedPnl.trim() === "" && t.realizedPnl != null
        ? "realizedPnl"
        : null,
      draft.pnlDate.trim() === "" && t.pnlDate != null ? "pnlDate" : null,
      draft.strike.trim() === "" && t.strike != null ? "strike" : null,
      draft.quantity.trim() === "" && t.quantity != null ? "quantity" : null,
      draft.fees.trim() === "" && t.fees != null ? "fees" : null,
      draft.notes.trim() === "" && t.notes != null ? "notes" : null,
    ].filter((field): field is string => field !== null);
    const res = await fetch("/api/dashboard/update-trade", {
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
          price,
          realizedPnl,
          pnlDate: pnlDateTs,
          strike,
          quantity,
          fees,
          notes: draft.notes || undefined,
          needsReview: draft.needsReview,
        },
        clearFields,
      }),
    });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) {
      window.alert(await readJsonError(res, "Save failed"));
      return;
    }
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
      const res = await fetch("/api/dashboard/update-trade", {
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
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        window.alert(await readJsonError(res, "Save failed"));
        return;
      }
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

  const COLS = 10;

  if (editing) {
    return (
      <>
        <tr className="border-b border-edge-soft bg-surface-2">
          <td colSpan={COLS} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-ink-muted">
                Underlying
                <input
                  className="mt-0.5 block w-24 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.underlying}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, underlying: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Action
                <input
                  className="mt-0.5 block w-40 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.side}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, side: e.target.value }))
                  }
                  placeholder="e.g. SELL TO OPEN"
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Type
                <select
                  className="mt-0.5 block w-24 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
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
              <label className="text-xs font-medium text-ink-muted">
                Expiration
                <input
                  type="date"
                  className="mt-0.5 block rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.expiration}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, expiration: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                P&amp;L date
                <input
                  type="date"
                  className="mt-0.5 block rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.pnlDate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, pnlDate: e.target.value }))
                  }
                  title="Month this P&L counts toward (defaults to date entered)"
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Price
                <input
                  className="mt-0.5 block w-24 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.price}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, price: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                P&amp;L
                <input
                  className="mt-0.5 block w-28 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.realizedPnl}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, realizedPnl: e.target.value }))
                  }
                  placeholder="Realized"
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Strike
                <input
                  className="mt-0.5 block w-20 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.strike}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, strike: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Qty
                <input
                  className="mt-0.5 block w-16 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.quantity}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, quantity: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Fees
                <input
                  className="mt-0.5 block w-24 rounded border border-edge-strong bg-field px-2 py-1 text-sm text-ink"
                  value={draft.fees}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, fees: e.target.value }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 pt-4 text-xs text-ink-muted">
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
            <label className="mt-3 block text-xs font-medium text-ink-muted">
              Notes
              <input
                className="mt-1 w-full max-w-2xl rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
              />
            </label>
            <p className="mt-1 text-[11px] text-ink-muted">
              Type: {formatOptionType(t.optionType)} · Exp {t.expiration ?? "—"}{" "}
              · Date entered {dateEntered.toLocaleString()}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-accent-solid px-3 py-1.5 text-sm text-white"
                onClick={() => void save()}
              >
                Save
              </button>
              <button
                type="button"
                className="rounded-lg border border-edge-strong px-3 py-1.5 text-sm"
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
      <tr className="border-b border-edge-soft">
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">
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
          {t.strike != null ? (
            <p className="mt-0.5 text-[11px] text-ink-muted">{t.strike}</p>
          ) : null}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink">
          {formatExpiration(t.expiration)}
        </td>
        <td className="max-w-[10rem] px-3 py-2.5 text-xs leading-snug text-ink-soft">
          {t.side ?? "—"}
        </td>
        <td className="px-3 py-2.5 text-ink">
          {formatOptionType(t.optionType)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink">
          {t.price != null ? formatMoney(t.price) : "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
          <span className="block text-ink">
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
        <td className="px-3 py-2.5 text-right tabular-nums text-ink">
          {formatMoney(net)}
        </td>
        <td
          className={`px-3 py-2.5 text-right font-medium ${pnl !== undefined && pnl !== null ? pnlClass(pnl) : "text-ink-muted"}`}
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
            className="text-sm text-accent"
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
        <tr className="border-b border-edge-soft bg-sky-50 dark:bg-sky-950/30">
          <td colSpan={COLS} className="px-3 py-3">
            <p className="text-sm font-medium text-ink">
              Mark expired worthless
            </p>
            <p className="mt-1 text-xs text-ink-muted">
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
              <label className="mt-3 block text-xs font-medium text-ink-muted">
                Expiration (required for monthly P&amp;L)
                <input
                  type="date"
                  className="mt-0.5 block rounded border border-edge-strong bg-field px-2 py-1 text-sm"
                  value={worthlessExpiration}
                  onChange={(e) => setWorthlessExpiration(e.target.value)}
                />
              </label>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">
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
                className="rounded-lg border border-edge-strong px-3 py-1.5 text-sm"
                onClick={() => setWorthlessOpen(false)}
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      ) : null}
      {t.ingestError ? (
        <tr className="border-b border-edge-soft">
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
