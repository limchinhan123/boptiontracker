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
  const s = (side ?? "").toUpperCase();
  if (s.includes("CLOSE")) return false;
  return s.includes("TO OPEN") || s.includes("BOUGHT TO OPEN");
}

export function isShortOpen(side?: string): boolean {
  const s = (side ?? "").toUpperCase();
  return s.includes("SELL") && s.includes("OPEN");
}

export function isLongOpen(side?: string): boolean {
  const s = (side ?? "").toUpperCase();
  return (s.includes("BUY") || s.includes("BOUGHT")) && s.includes("OPEN");
}

/** Close leg for an open short: BUY / BUY TO CLOSE. For open long: SELL / SELL TO CLOSE. */
export function isCloseSideForOpen(
  openSide?: string,
  closeSide?: string,
): boolean {
  const open = (openSide ?? "").toUpperCase();
  const close = (closeSide ?? "").toUpperCase();
  if (close.includes("OPEN") && !close.includes("CLOSE")) return false;

  if (open.includes("SELL")) {
    return close.includes("BUY") || close.includes("BOUGHT");
  }
  if (open.includes("BUY") || open.includes("BOUGHT")) {
    return close.includes("SELL");
  }
  return false;
}

function normalizeUnderlying(u?: string): string {
  return (u ?? "").trim().toUpperCase();
}

function optionTypeKey(t?: WorthlessGuardTrade["optionType"]): string {
  return t && t !== "unknown" ? t : "";
}

function typesCompatible(
  a?: WorthlessGuardTrade["optionType"],
  b?: WorthlessGuardTrade["optionType"],
): boolean {
  const ka = optionTypeKey(a);
  const kb = optionTypeKey(b);
  if (!ka || !kb) return true;
  return ka === kb;
}

/** Strict contract identity for open/close pairing. */
export function strictContractKey(
  t: Pick<WorthlessGuardTrade, "underlying" | "strike" | "expiration" | "optionType">,
): string | null {
  if (!t.underlying || t.strike == null || !t.expiration) return null;
  return `${normalizeUnderlying(t.underlying)}|${t.strike}|${t.expiration}|${optionTypeKey(t.optionType)}`;
}

function contractsMatchStrict(
  open: WorthlessGuardTrade,
  close: WorthlessGuardTrade,
): boolean {
  const openKey = strictContractKey(open);
  const closeKey = strictContractKey(close);
  if (!openKey || !closeKey) return false;
  if (!typesCompatible(open.optionType, close.optionType)) return false;

  const openParts = openKey.split("|");
  const closeParts = closeKey.split("|");
  // Ignore option-type segment when either side lacks a concrete type.
  if (optionTypeKey(open.optionType) && optionTypeKey(close.optionType)) {
    return openKey === closeKey;
  }
  return (
    openParts[0] === closeParts[0] &&
    openParts[1] === closeParts[1] &&
    openParts[2] === closeParts[2]
  );
}

/** Same contract, strike match; expiration may differ (OCR mismatch). */
function contractsMatchByStrike(
  open: WorthlessGuardTrade,
  close: WorthlessGuardTrade,
): boolean {
  if (!open.underlying || !close.underlying) return false;
  if (normalizeUnderlying(open.underlying) !== normalizeUnderlying(close.underlying)) {
    return false;
  }
  if (open.strike == null || close.strike == null) return false;
  if (open.strike !== close.strike) return false;
  if (!typesCompatible(open.optionType, close.optionType)) return false;
  return true;
}

/**
 * Same underlying + expiration: any close for this expiry (e.g. closed one leg,
 * other strikes may still be open — warn-only, not hide).
 */
function contractsMatchByExpirationCohort(
  open: WorthlessGuardTrade,
  close: WorthlessGuardTrade,
): boolean {
  if (!open.underlying || !close.underlying || !open.expiration || !close.expiration) {
    return false;
  }
  if (normalizeUnderlying(open.underlying) !== normalizeUnderlying(close.underlying)) {
    return false;
  }
  if (open.expiration !== close.expiration) return false;
  if (open.strike != null && close.strike != null && open.strike === close.strike) {
    return false;
  }
  if (!typesCompatible(open.optionType, close.optionType)) return false;
  return true;
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
  if (s.includes("BUY") || s.includes("BOUGHT")) return -Math.abs(net);
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
  return allTrades.some((row) => {
    if (row._id && open._id && row._id === open._id) return false;
    if (!isCloseSideForOpen(open.side, row.side)) return false;
    return contractsMatchStrict(open, row);
  });
}

/** Hide one-click when a close leg clearly matches (strict or same strike). */
export function hasCloseMatchForHide(
  open: WorthlessGuardTrade,
  allTrades: WorthlessGuardTrade[],
): boolean {
  return allTrades.some((row) => {
    if (row._id && open._id && row._id === open._id) return false;
    if (!isCloseSideForOpen(open.side, row.side)) return false;
    return (
      contractsMatchStrict(open, row) || contractsMatchByStrike(open, row)
    );
  });
}

/** Same expiry, different strike — warn only (e.g. closed 640 put, 620 still open). */
export function findFuzzyCloseMatches(
  open: WorthlessGuardTrade,
  allTrades: WorthlessGuardTrade[],
): WorthlessGuardTrade[] {
  if (hasCloseMatchForHide(open, allTrades)) return [];
  return allTrades.filter((row) => {
    if (row._id && open._id && row._id === open._id) return false;
    if (!isCloseSideForOpen(open.side, row.side)) return false;
    return contractsMatchByExpirationCohort(open, row);
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
  if (hasCloseMatchForHide(open, allTrades)) return null;
  const fuzzy = findFuzzyCloseMatches(open, allTrades);
  if (fuzzy.length === 0) return null;
  const labels = fuzzy.slice(0, 3).map(formatCloseLabel).join("; ");
  return `A close trade exists for the same underlying and expiration (${labels}). If you already closed this strike, cancel — marking worthless will double-count P&L.`;
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
  if (hasCloseMatchForHide(t, allTrades)) return false;
  return true;
}

const WORTHLESS_NOTE = "Expired worthless — no IBKR fill";

export function appendWorthlessNote(existing?: string): string {
  if (!existing?.trim()) return WORTHLESS_NOTE;
  if (existing.includes(WORTHLESS_NOTE)) return existing;
  return `${existing.trim()} · ${WORTHLESS_NOTE}`;
}
