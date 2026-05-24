/** Inputs needed to compute premium / worthless-expiration P&L. */
export type TradePremiumInput = {
  side?: string;
  quantity?: number;
  price?: number;
  total?: number;
  fees?: number;
  multiplier?: number;
};

export type WorthlessGuardTrade = TradePremiumInput & {
  _id?: string;
  underlying?: string;
  strike?: number;
  expiration?: string;
  optionType?: "call" | "put" | "unknown";
  realizedPnl?: number | null;
  side?: string;
};

export function isOpenSide(side?: string): boolean {
  return (side ?? "").toUpperCase().includes("OPEN");
}

export function isShortOpen(side?: string): boolean {
  const s = (side ?? "").toUpperCase();
  return s.includes("SELL") && s.includes("OPEN");
}

export function isLongOpen(side?: string): boolean {
  const s = (side ?? "").toUpperCase();
  return s.includes("BUY") && s.includes("OPEN");
}

/** Close leg for an open short: BUY / BUY TO CLOSE. For open long: SELL / SELL TO CLOSE. */
export function isCloseSideForOpen(
  openSide?: string,
  closeSide?: string,
): boolean {
  const open = (openSide ?? "").toUpperCase();
  const close = (closeSide ?? "").toUpperCase();
  if (close.includes("OPEN")) return false;

  if (open.includes("SELL")) {
    if (close.includes("BUY")) return true;
    return false;
  }
  if (open.includes("BUY")) {
    if (close.includes("SELL")) return true;
    return false;
  }
  return false;
}

function normalizeUnderlying(u?: string): string {
  return (u ?? "").trim().toUpperCase();
}

/** Strict contract identity for open/close pairing. */
export function strictContractKey(
  t: Pick<WorthlessGuardTrade, "underlying" | "strike" | "expiration" | "optionType">,
): string | null {
  if (!t.underlying || t.strike == null || !t.expiration) return null;
  const ot =
    t.optionType && t.optionType !== "unknown" ? t.optionType : "";
  return `${normalizeUnderlying(t.underlying)}|${t.strike}|${t.expiration}|${ot}`;
}

/** Premium before fees: IBKR total if present, else qty × price × multiplier. */
export function computePremiumBase(t: TradePremiumInput): number | null {
  const q = t.quantity ?? 0;
  const p = t.price ?? 0;
  const mult = t.multiplier ?? 100;
  const premium = t.total != null ? t.total : q * p * mult;
  if (t.total == null && q === 0 && p === 0) return null;
  return premium;
}

/** Net cash from the open leg (premium minus fees). */
export function computeNetAmount(t: TradePremiumInput): number | null {
  const premium = computePremiumBase(t);
  if (premium == null) return null;
  return premium - (t.fees ?? 0);
}

/**
 * Realized P&L when an open leg expires worthless.
 * Short: keep net credit. Long: lose net debit.
 */
export function computeWorthlessExpirationPnl(
  t: TradePremiumInput,
): number | null {
  const net = computeNetAmount(t);
  if (net == null) return null;
  if (isShortOpen(t.side)) return Math.abs(net);
  if (isLongOpen(t.side)) return -Math.abs(net);
  const s = (t.side ?? "").toUpperCase();
  if (s.includes("SELL")) return Math.abs(net);
  if (s.includes("BUY")) return -Math.abs(net);
  return null;
}

/** Parse YYYY-MM-DD to noon UTC for stable month bucketing. */
export function expirationToPnlDate(expiration: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiration.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const ts = Date.UTC(y, mo, d, 12, 0, 0);
  if (Number.isNaN(ts)) return null;
  return ts;
}

/** True when the calendar date is strictly after expiration (UTC). */
export function isExpirationPast(
  expiration: string,
  nowMs: number = Date.now(),
): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiration.trim());
  if (!m) return false;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return today > expiration.trim();
}

export function hasUnsetRealizedPnl(realizedPnl?: number | null): boolean {
  return realizedPnl == null || realizedPnl === 0;
}

export function hasStrictCloseMatch(
  open: WorthlessGuardTrade,
  allTrades: WorthlessGuardTrade[],
): boolean {
  const openKey = strictContractKey(open);
  if (!openKey) return false;
  return allTrades.some((row) => {
    if (row._id && open._id && row._id === open._id) return false;
    if (!isCloseSideForOpen(open.side, row.side)) return false;
    return strictContractKey(row) === openKey;
  });
}

/** Partial contract overlap — close row may be missing strike or expiration from OCR. */
export function findFuzzyCloseMatches(
  open: WorthlessGuardTrade,
  allTrades: WorthlessGuardTrade[],
): WorthlessGuardTrade[] {
  if (hasStrictCloseMatch(open, allTrades)) return [];
  const openU = normalizeUnderlying(open.underlying);
  if (!openU) return [];

  return allTrades.filter((row) => {
    if (row._id && open._id && row._id === open._id) return false;
    if (!isCloseSideForOpen(open.side, row.side)) return false;
    if (normalizeUnderlying(row.underlying) !== openU) return false;

    const strikeMatch =
      open.strike != null &&
      row.strike != null &&
      open.strike === row.strike;
    const expMatch =
      !!open.expiration &&
      !!row.expiration &&
      open.expiration === row.expiration;

    if (strictContractKey(open) && strictContractKey(row)) {
      if (strictContractKey(open) === strictContractKey(row)) return false;
    }

    return strikeMatch || expMatch;
  });
}

function formatCloseLabel(t: WorthlessGuardTrade): string {
  const parts = [
    t.underlying?.toUpperCase(),
    t.strike != null ? String(t.strike) : null,
    t.expiration,
    t.side,
  ].filter(Boolean);
  return parts.join(" ");
}

export function getWorthlessCloseWarning(
  open: WorthlessGuardTrade,
  allTrades: WorthlessGuardTrade[],
): string | null {
  if (hasStrictCloseMatch(open, allTrades)) return null;
  const fuzzy = findFuzzyCloseMatches(open, allTrades);
  if (fuzzy.length === 0) return null;
  const labels = fuzzy.slice(0, 3).map(formatCloseLabel).join("; ");
  return `A possible close trade exists (${labels}). If you already closed this position, cancel — marking worthless will double-count P&L.`;
}

export function canMarkWorthlessExpiration(
  t: WorthlessGuardTrade,
  allTrades: WorthlessGuardTrade[] = [],
  nowMs: number = Date.now(),
): boolean {
  if (!isOpenSide(t.side)) return false;
  if (!hasUnsetRealizedPnl(t.realizedPnl)) return false;
  if (computeWorthlessExpirationPnl(t) == null) return false;
  if (!t.expiration || !isExpirationPast(t.expiration, nowMs)) return false;
  if (hasStrictCloseMatch(t, allTrades)) return false;
  return true;
}

const WORTHLESS_NOTE = "Expired worthless — no IBKR fill";

export function appendWorthlessNote(existing?: string): string {
  if (!existing?.trim()) return WORTHLESS_NOTE;
  if (existing.includes(WORTHLESS_NOTE)) return existing;
  return `${existing.trim()} · ${WORTHLESS_NOTE}`;
}
