import {
  canMarkWorthlessExpiration,
  hasCloseMatchForHide,
  isOpenSide,
  type WorthlessGuardTrade,
} from "./worthless-pnl";

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
  _id?: string;
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
  openQuestion?: string;
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
    /** IBKR portfolio MTM — stocks + options + all holdings, not options-only. */
    portfolioUnrealizedPnl: number | null;
    portfolioRealizedPnl: number | null;
    initMarginPctOfNetLiq: number | null;
    maintMarginPctOfNetLiq: number | null;
    excessLiqPctOfNetLiq: number | null;
    theta: number | null;
    spxDelta: number | null;
    vega: number | null;
    balanceSnapshotAgeDays: number | null;
    positionSnapshotAgeDays: number | null;
    portfolioPositionCount: number | null;
  };
  context: {
    unrealizedPnlScope: string;
    tradeLogScope: string;
  };
  trades: {
    totalTrades: number;
    totalRealizedPnl: number;
    needsReviewCount: number;
    /** Open option legs (future expiry, no close row in log). */
    activeOptionLegsInLog: number;
    /** Expired opens still without close/worthless in log. */
    expiredOpenLegsAwaitingClose: number;
    /** Rows in log missing a detected close (data quality — not live exposure). */
    historicalOpensMissingCloseRow: number;
    topUnderlyingsByCount: { underlying: string; count: number }[];
    topUnderlyingsByPnl: { underlying: string; pnl: number }[];
    lastThreeMonths: { month: string; count: number; pnl: number }[];
    optionRealizedPnl: number;
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
  weekOverWeek: {
    priorWeekEnding: string | null;
    netLiquidationDelta: number | null;
    excessLiqPctDelta: number | null;
    initMarginPctDelta: number | null;
    topSymbol: string | null;
    topSymbolPctDelta: number | null;
  } | null;
};

function sumOptionRealizedPnl(trades: TradeSlice[]): number {
  return trades
    .filter((t) => t.optionType === "call" || t.optionType === "put")
    .reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
}

function computeWeekOverWeek(
  current: Pick<WeeklyFactSheet, "account" | "concentration" | "weekEnding">,
  prior: WeeklyFactSheet | null,
): WeeklyFactSheet["weekOverWeek"] {
  if (!prior) return null;
  const top = current.concentration.topPositionSymbols[0];
  const priorTop = prior.concentration.topPositionSymbols[0];
  return {
    priorWeekEnding: prior.weekEnding,
    netLiquidationDelta:
      current.account.netLiquidation != null &&
      prior.account.netLiquidation != null
        ? current.account.netLiquidation - prior.account.netLiquidation
        : null,
    excessLiqPctDelta:
      current.account.excessLiqPctOfNetLiq != null &&
      prior.account.excessLiqPctOfNetLiq != null
        ? current.account.excessLiqPctOfNetLiq -
          prior.account.excessLiqPctOfNetLiq
        : null,
    initMarginPctDelta:
      current.account.initMarginPctOfNetLiq != null &&
      prior.account.initMarginPctOfNetLiq != null
        ? current.account.initMarginPctOfNetLiq -
          prior.account.initMarginPctOfNetLiq
        : null,
    topSymbol: top?.symbol ?? null,
    topSymbolPctDelta:
      top?.pctNetLiq != null && priorTop?.pctNetLiq != null
        ? top.pctNetLiq - priorTop.pctNetLiq
        : null,
  };
}

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

function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function asGuardTrades(trades: TradeSlice[]): WorthlessGuardTrade[] {
  return trades.map((t) => ({ ...t }));
}

/** Active option opens: future expiration, no close match in trade log. */
function countActiveOptionLegsInLog(
  trades: TradeSlice[],
  now = Date.now(),
): number {
  const all = asGuardTrades(trades);
  const today = todayUtc(now);
  return trades.filter((t) => {
    if (!isOpenSide(t.side)) return false;
    if (!t.expiration || t.expiration < today) return false;
    if (hasCloseMatchForHide(t, all)) return false;
    return true;
  }).length;
}

function countExpiredOpenLegsAwaitingClose(
  trades: TradeSlice[],
  now = Date.now(),
): number {
  const all = asGuardTrades(trades);
  return trades.filter((t) => canMarkWorthlessExpiration(t, all, now)).length;
}

/** Log hygiene: any open row without close match (includes closed history with missing rows). */
function countHistoricalOpensMissingCloseRow(trades: TradeSlice[]): number {
  const all = asGuardTrades(trades);
  return trades.filter(
    (t) => isOpenSide(t.side) && !hasCloseMatchForHide(t, all),
  ).length;
}

function buildFlags(input: {
  balance?: SnapshotSlice | null;
  position?: SnapshotSlice | null;
  activeOptionLegsInLog: number;
  expiredOpenLegsAwaitingClose: number;
  historicalOpensMissingCloseRow: number;
  needsReviewCount: number;
  initMarginPct: number | null;
  excessLiqPct: number | null;
  portfolioPositionCount: number | null;
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

  if (input.expiredOpenLegsAwaitingClose > 0) {
    flags.push({
      id: "expired_opens_awaiting_close",
      severity: "info",
      message: `${input.expiredOpenLegsAwaitingClose} expired open leg(s) in the trade log still lack a close or worthless mark.`,
    });
  }

  const logGap =
    input.historicalOpensMissingCloseRow - input.activeOptionLegsInLog;
  if (logGap > 5) {
    flags.push({
      id: "trade_log_gaps",
      severity: "info",
      message: `${logGap} historical open row(s) lack a close in the log (data quality — not the same as live open exposure). Live snapshot shows ${input.portfolioPositionCount ?? "?"} positions.`,
    });
  }

  if (input.activeOptionLegsInLog > 0 && input.portfolioPositionCount != null) {
    flags.push({
      id: "active_option_legs",
      severity: "info",
      message: `${input.activeOptionLegsInLog} active option open leg(s) in trade log (future expiry, no close row). IBKR snapshot: ${input.portfolioPositionCount} position line(s) total (stocks + options).`,
    });
  }

  if (input.needsReviewCount > 0) {
    flags.push({
      id: "trades_need_review",
      severity: "warn",
      message: `${input.needsReviewCount} trade row(s) flagged needs review.`,
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
  priorFactSheet?: WeeklyFactSheet | null;
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
  const activeOptionLegsInLog = countActiveOptionLegsInLog(args.trades, now);
  const expiredOpenLegsAwaitingClose = countExpiredOpenLegsAwaitingClose(
    args.trades,
    now,
  );
  const historicalOpensMissingCloseRow =
    countHistoricalOpensMissingCloseRow(args.trades);
  const portfolioPositionCount = args.position?.positions?.length ?? null;

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
    activeOptionLegsInLog,
    expiredOpenLegsAwaitingClose,
    historicalOpensMissingCloseRow,
    needsReviewCount,
    initMarginPct,
    excessLiqPct,
    portfolioPositionCount,
  });

  const lastThreeMonths = args.stats.byMonth.slice(-3);
  const optionRealizedPnl = sumOptionRealizedPnl(args.trades);

  const sheet: WeeklyFactSheet = {
    generatedAt: now,
    weekEnding,
    context: {
      unrealizedPnlScope:
        "IBKR portfolio unrealized P&L includes long-term stock holdings and all positions — not options-only. Do not compare to option trade-log realized P&L as a risk signal.",
      tradeLogScope:
        "Trade log is screenshot history (mostly options). Missing close rows are log gaps, not proof of live open risk. Use portfolioPositionCount from snapshot for book size.",
    },
    account: {
      netLiquidation: netLiq,
      excessLiquidity: excessLiq,
      initialMargin: initMargin,
      maintenanceMargin: maintMargin,
      buyingPower: args.balance?.buyingPower ?? null,
      cash: args.balance?.cash ?? null,
      portfolioUnrealizedPnl: args.position?.unrealizedPnl ?? null,
      portfolioRealizedPnl: args.position?.realizedPnl ?? null,
      initMarginPctOfNetLiq: initMarginPct,
      maintMarginPctOfNetLiq: maintMarginPct,
      excessLiqPctOfNetLiq: excessLiqPct,
      theta: args.position?.theta ?? null,
      spxDelta: args.position?.spxDelta ?? null,
      vega: args.position?.vega ?? null,
      balanceSnapshotAgeDays: ageDays(args.balance?.createdAt, now),
      positionSnapshotAgeDays: ageDays(args.position?.createdAt, now),
      portfolioPositionCount,
    },
    trades: {
      totalTrades: args.stats.totalTrades,
      totalRealizedPnl: args.stats.totalRealizedPnl,
      needsReviewCount,
      activeOptionLegsInLog,
      expiredOpenLegsAwaitingClose,
      historicalOpensMissingCloseRow,
      topUnderlyingsByCount: args.stats.byUnderlying.slice(0, 6),
      topUnderlyingsByPnl: [...args.stats.byUnderlyingPnl]
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
        .slice(0, 6),
      lastThreeMonths,
      optionRealizedPnl,
    },
    concentration: { topPositionSymbols },
    flags,
    priorMemory: (args.priorReviews ?? []).slice(0, 4),
    weekOverWeek: null,
  };

  sheet.weekOverWeek = computeWeekOverWeek(sheet, args.priorFactSheet ?? null);
  return sheet;
}
