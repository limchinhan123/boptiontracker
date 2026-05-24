import type { PriorReviewSlice, WeeklyFactSheet } from "./weekly-fact-sheet";

/** Slim, coach-safe payload — omits metrics that mislead the LLM. */
export type CoachPayload = {
  weekEnding: string;
  generatedAt: number;
  constraints: string[];
  account: WeeklyFactSheet["account"];
  context: WeeklyFactSheet["context"];
  trades: Omit<WeeklyFactSheet["trades"], "historicalOpensMissingCloseRow">;
  concentration: WeeklyFactSheet["concentration"];
  flags: WeeklyFactSheet["flags"];
  priorContext: {
    lastOpenQuestion: string | null;
    memoryBullets: string[];
  };
};

export const STALE_COACH_PATTERNS = [
  /open trade legs without/i,
  /open legs without/i,
  /\b56\b.*open/i,
  /unrealized p&l risk/i,
  /vastly overshadow/i,
  /high exposure to market shifts/i,
  /trade closure risk/i,
];

export function isStaleCoachText(text: string): boolean {
  return STALE_COACH_PATTERNS.some((re) => re.test(text));
}

function filterMemoryBullets(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !STALE_COACH_PATTERNS.some((re) => re.test(line)))
    .slice(0, 8);
}

export function buildCoachPayload(
  factSheet: WeeklyFactSheet,
  priorReviews: PriorReviewSlice[] = [],
): CoachPayload {
  const last = priorReviews[0];
  const memoryBullets = priorReviews
    .flatMap((r) => filterMemoryBullets(r.memoryMarkdown))
    .slice(0, 8);

  const { historicalOpensMissingCloseRow: _hist, ...tradesSafe } =
    factSheet.trades;

  const flags = factSheet.flags.filter(
    (f) => f.id !== "trade_log_gaps" && f.id !== "active_option_legs",
  );

  return {
    weekEnding: factSheet.weekEnding,
    generatedAt: factSheet.generatedAt,
    constraints: [
      "portfolioUnrealizedPnl is FULL portfolio MTM (long-term stocks included). Do NOT list it as a Top risk or compare to trades.totalRealizedPnl.",
      "Use activeOptionLegsInLog for option exposure in the trade log; portfolioPositionCount is IBKR position lines (stocks + options).",
      "Never mention historicalOpensMissingCloseRow or invent open-leg counts from log gaps.",
      "Top risks should focus on: margin % (init/maint vs net liq), excess liq buffer, greek exposure (theta/delta/vega), name concentration from concentration.topPositionSymbols.",
      "trade log realized P&L is mostly closed legs from screenshots — not a measure of portfolio MTM.",
    ],
    account: factSheet.account,
    context: factSheet.context,
    trades: tradesSafe,
    concentration: factSheet.concentration,
    flags,
    priorContext: {
      lastOpenQuestion: last?.openQuestion ?? null,
      memoryBullets,
    },
  };
}

export function coachPayloadForPrompt(
  factSheet: WeeklyFactSheet,
  priorReviews: PriorReviewSlice[] = [],
): string {
  return JSON.stringify(buildCoachPayload(factSheet, priorReviews), null, 2);
}
