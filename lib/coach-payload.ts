import type { PriorReviewSlice, WeeklyFactSheet } from "./weekly-fact-sheet";
import { memoryBullets } from "./coach-health";

/** Slim, coach-safe payload — omits metrics that mislead the LLM. */
export type CoachPayload = {
  weekEnding: string;
  generatedAt: number;
  coachProfile: string;
  constraints: string[];
  account: WeeklyFactSheet["account"];
  context: WeeklyFactSheet["context"];
  trades: Omit<WeeklyFactSheet["trades"], "historicalOpensMissingCloseRow">;
  concentration: WeeklyFactSheet["concentration"];
  weekOverWeek: WeeklyFactSheet["weekOverWeek"];
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

const BANNED_MEMORY_PATTERNS = [
  ...STALE_COACH_PATTERNS,
  /macro/i,
  /defensive strateg/i,
  /market assumptions/i,
];

export function sanitizeMemoryMarkdown(markdown: string, maxBullets = 6): string {
  const lines = memoryBullets(markdown)
    .filter((line) => !BANNED_MEMORY_PATTERNS.some((re) => re.test(line)))
    .filter((line) => /\d/.test(line))
    .slice(0, maxBullets);
  return lines.map((l) => `- ${l}`).join("\n");
}

function filterMemoryBullets(markdown: string): string[] {
  return sanitizeMemoryMarkdown(markdown, 8)
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function buildCoachPayload(
  factSheet: WeeklyFactSheet,
  priorReviews: PriorReviewSlice[] = [],
  coachProfile = "",
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
    coachProfile,
    constraints: [
      "portfolioUnrealizedPnl is FULL portfolio MTM (long-term stocks included). Do NOT mention it in What changed or Top risks unless coachProfile says otherwise.",
      "Use activeOptionLegsInLog for option exposure; portfolioPositionCount is IBKR lines (stocks + options).",
      "Never cite historicalOpensMissingCloseRow as live risk.",
      "Top risks: if excessLiqPctOfNetLiq > 50%, use ONE short 'buffer OK' line max; remaining slots MUST cite greeks (theta/spxDelta/vega) and/or concentration tickers with pctNetLiq.",
      "What changed: use weekOverWeek deltas and trades.lastThreeMonths only when prior week exists; otherwise May/month P&L and snapshot ages — not portfolio MTM.",
      "memoryMarkdown: max 6 bullets; EACH bullet MUST contain a number; no generic macro/defensive advice.",
      "trades.optionRealizedPnl is options-only realized from the trade log; do not compare to portfolioUnrealizedPnl.",
    ],
    account: factSheet.account,
    context: factSheet.context,
    trades: tradesSafe,
    concentration: factSheet.concentration,
    weekOverWeek: factSheet.weekOverWeek,
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
  coachProfile = "",
): string {
  return JSON.stringify(
    buildCoachPayload(factSheet, priorReviews, coachProfile),
    null,
    2,
  );
}
