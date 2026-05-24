/** Inputs needed to compute premium / worthless-expiration P&L. */
export type TradePremiumInput = {
  side?: string;
  quantity?: number;
  price?: number;
  total?: number;
  fees?: number;
  multiplier?: number;
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

export function hasUnsetRealizedPnl(realizedPnl?: number | null): boolean {
  return realizedPnl == null || realizedPnl === 0;
}

export function canMarkWorthlessExpiration(
  t: TradePremiumInput & { realizedPnl?: number | null; side?: string },
): boolean {
  if (!isOpenSide(t.side)) return false;
  if (!hasUnsetRealizedPnl(t.realizedPnl)) return false;
  return computeWorthlessExpirationPnl(t) != null;
}

const WORTHLESS_NOTE = "Expired worthless — no IBKR fill";

export function appendWorthlessNote(existing?: string): string {
  if (!existing?.trim()) return WORTHLESS_NOTE;
  if (existing.includes(WORTHLESS_NOTE)) return existing;
  return `${existing.trim()} · ${WORTHLESS_NOTE}`;
}
