export type SnapshotKind = "balance" | "position";

/** Parse Telegram photo caption; case-insensitive. Accepts balance/balances/position/positions. */
export function parseSnapshotCaption(
  caption?: string | null,
): SnapshotKind | null {
  if (!caption?.trim()) return null;
  const normalized = caption
    .trim()
    .toLowerCase()
    .replace(/^\/snapshot\s*/i, "")
    .replace(/^\/\w+\s*/i, "")
    .trim();

  if (/\bpositions?\b/.test(normalized)) return "position";
  if (/\bbalances?\b/.test(normalized)) return "balance";
  return null;
}
