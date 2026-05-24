import { isCloseSideForOpen, isOpenSide } from "./worthless-pnl";

export type FactSheetFlag = {
  id: string;
  severity: "info" | "warn" | "critical";
  message: string;
};

export type SnapshotSlice = {
  createdAt?: number;
  netLiquidation?: number;
  excessLiquidity?: number;
  initialMargin?: number;
  maintenanceMargin?: number;
  buyingPower?: number;
  cash?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  theta?: number;
  spxDelta?: number;
  vega?: number;
  positions?: Array<{
    symbol: string;
    pctNetLiq?: number;
    unrealizedPnl?: number;
  }>;
};

export type TradeSlice = {
  underlying?: string;
  side?: string;
  strike?: number;
  expiration?: string;
  optionType?: "call" | "put" | "unknown";
  realizedPnl?: number;
  needsReview?: boolean;
  createdAt: number;
};

export type StatsSlice = {
  totalTrades: number;
  totalRealizedPnl: number;
  byUnderlying: { underlying: string; count: number }[];
  byUnderlyingPnl: { underlying: string; pnl: number }[];
  byMonth: { month: string; count: number; pnl: number }[];
};

export type PriorReviewSlice = {
  weekEnding: string;
  generatedAt: number;
  memoryMarkdown: string;
  narrativeMarkdown: string;
};

export type WeeklyFactSheet = {
  generatedAt: number;
  weekEnding: string;
  account: {
    netLiquidation: number | null;
    excessLiquidity: number | null;
    initialMargin: number | null;
    maintenanceMargin: number | null;
    buyingPower: number | null;
    cash: number | null;
    unrealizedPnl: number | null;
    initMarginPctOfNetLiq: number | null;
    maintMarginPctOfNetLiq: number | null;
    excessLiqPctOfNetLiq: number | null;
    theta: number | null;
    spxDelta: number | null;
    vega: number | null;
    balanceSnapshotAgeDays: number | null;
    positionSnapshotAgeDays: number | null;
  };
  trades: {
    totalTrades: number;
    totalRealizedPnl: number;
    needsReviewCount: number;
    openLegsWithoutClose: number;
    topUnderlyingsByCount: { underlying: string; count: number }[];
    topUnderlyingsByPnl: { underlying: string; pnl: number }[];
    lastThreeMonths: { month: string; count: number; pnl: number }[];
  };
  concentration: {
    topPositionSymbols: Array<{
      symbol: string;
      pctNetLiq: number | null;
      unrealizedPnl: number | null;
    }>;
  };
  flags: FactSheetFlag[];
  priorMemory: PriorReviewSlice[];
};

function pct(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || d === 0) return null;
  return (n / d) * 100;
}

function ageDays(ts?: number, now = Date.now()): number | null {
  if (!ts) return null;
  return Math.round((now - ts) / (24 * 60 * 60 * 1000));
}

function weekEndingSunday(now = Date.now()): string {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function countOpenLegsWithoutClose(trades: TradeSlice[]): number {
  const opens = trades.filter((t) => isOpenSide(t.side));
  let count = 0;
  for (const open of opens) {
    const u = (open.underlying ?? "").toUpperCase();
    const hasClose = trades.some(
      (c) =>
        (c.underlying ?? "").toUpperCase() === u &&
        open.strike != null &&
        c.strike === open.strike &&
        isCloseSideForOpen(open.side, c.side),
    );
    if (!hasClose) count += 1;
  }
  return count;
}

function buildFlags(input: {
  balance?: SnapshotSlice | null;
  position?: SnapshotSlice | null;
  stats: StatsSlice;
  openLegsWithoutClose: number;
  needsReviewCount: number;
  initMarginPct: number | null;
  excessLiqPct: number | null;
}): FactSheetFlag[] {
  const flags: FactSheetFlag[] = [];

  if (!input.balance?.netLiquidation) {
    flags.push({
      id: "missing_balance_snapshot",
      severity: "warn",
      message: "No balance snapshot on file — upload IBKR Balances with caption balance.",
    });
  }
  if (!input.position?.maintenanceMargin && !input.position?.unrealizedPnl) {
    flags.push({
      id: "missing_position_snapshot",
      severity: "warn",
      message: "No position snapshot on file — upload IBKR Positions with caption position.",
    });
  }

  const balAge = ageDays(input.balance?.createdAt);
  if (balAge != null && balAge > 7) {
    flags.push({
      id: "stale_balance",
      severity: "info",
      message: `Balance snapshot is ${balAge} days old.`,
    });
  }
  const posAge = ageDays(input.position?.createdAt);
  if (posAge != null && posAge > 7) {
    flags.push({
      id: "stale_position",
      severity: "info",
      message: `Position snapshot is ${posAge} days old.`,
    });
  }

  if (input.initMarginPct != null && input.initMarginPct > 40) {
    flags.push({
      id: "high_init_margin",
      severity: "warn",
      message: `Initial margin is ${input.initMarginPct.toFixed(1)}% of net liquidation.`,
    });
  }

  if (input.excessLiqPct != null && input.excessLiqPct < 25) {
    flags.push({
      id: "low_excess_liq",
      severity: "critical",
      message: `Excess liquidity is only ${input.excessLiqPct.toFixed(1)}% of net liquidation.`,
    });
  }

  if (input.openLegsWithoutClose > 0) {
    flags.push({
      id: "open_legs_no_close",
      severity: "info",
      message: `${input.openLegsWithoutClose} open leg(s) have no matching close row in the trade log.`,
    });
  }

  if (input.needsReviewCount > 0) {
    flags.push({
      id: "trades_need_review",
      severity: "warn",
      message: `${input.needsReviewCount} trade row(s) flagged needs review.`,
    });
  }

  const unreal = input.position?.unrealizedPnl;
  const realized = input.stats.totalRealizedPnl;
  if (unreal != null && Math.abs(unreal) > Math.abs(realized) * 5 && Math.abs(unreal) > 10000) {
    flags.push({
      id: "unrealized_dominates",
      severity: "info",
      message: `Unrealized P&L ($${unreal.toLocaleString()}) is much larger than cumulative realized ($${realized.toLocaleString()}).`,
    });
  }

  return flags;
}

export function buildWeeklyFactSheet(args: {
  trades: TradeSlice[];
  stats: StatsSlice;
  balance?: SnapshotSlice | null;
  position?: SnapshotSlice | null;
  priorReviews?: PriorReviewSlice[];
  now?: number;
}): WeeklyFactSheet {
  const now = args.now ?? Date.now();
  const weekEnding = weekEndingSunday(now);
  const netLiq = args.balance?.netLiquidation ?? null;
  const initMargin = args.balance?.initialMargin ?? null;
  const maintMargin =
    args.position?.maintenanceMargin ?? args.balance?.maintenanceMargin ?? null;
  const excessLiq = args.balance?.excessLiquidity ?? null;

  const initMarginPct = pct(initMargin, netLiq);
  const maintMarginPct = pct(maintMargin, netLiq);
  const excessLiqPct = pct(excessLiq, netLiq);

  const needsReviewCount = args.trades.filter((t) => t.needsReview).length;
  const openLegsWithoutClose = countOpenLegsWithoutClose(args.trades);

  const topPositionSymbols = (args.position?.positions ?? [])
    .slice()
    .sort((a, b) => (b.pctNetLiq ?? 0) - (a.pctNetLiq ?? 0))
    .slice(0, 8)
    .map((p) => ({
      symbol: p.symbol,
      pctNetLiq: p.pctNetLiq ?? null,
      unrealizedPnl: p.unrealizedPnl ?? null,
    }));

  const flags = buildFlags({
    balance: args.balance,
    position: args.position,
    stats: args.stats,
    openLegsWithoutClose,
    needsReviewCount,
    initMarginPct,
    excessLiqPct,
  });

  const lastThreeMonths = args.stats.byMonth.slice(-3);

  return {
    generatedAt: now,
    weekEnding,
    account: {
      netLiquidation: netLiq,
      excessLiquidity: excessLiq,
      initialMargin: initMargin,
      maintenanceMargin: maintMargin,
      buyingPower: args.balance?.buyingPower ?? null,
      cash: args.balance?.cash ?? null,
      unrealizedPnl: args.position?.unrealizedPnl ?? null,
      initMarginPctOfNetLiq: initMarginPct,
      maintMarginPctOfNetLiq: maintMarginPct,
      excessLiqPctOfNetLiq: excessLiqPct,
      theta: args.position?.theta ?? null,
      spxDelta: args.position?.spxDelta ?? null,
      vega: args.position?.vega ?? null,
      balanceSnapshotAgeDays: ageDays(args.balance?.createdAt, now),
      positionSnapshotAgeDays: ageDays(args.position?.createdAt, now),
    },
    trades: {
      totalTrades: args.stats.totalTrades,
      totalRealizedPnl: args.stats.totalRealizedPnl,
      needsReviewCount,
      openLegsWithoutClose,
      topUnderlyingsByCount: args.stats.byUnderlying.slice(0, 6),
      topUnderlyingsByPnl: [...args.stats.byUnderlyingPnl]
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
        .slice(0, 6),
      lastThreeMonths,
    },
    concentration: { topPositionSymbols },
    flags,
    priorMemory: (args.priorReviews ?? []).slice(0, 4),
  };
}
