import { createHmac, timingSafeEqual } from "crypto";

export const DASHBOARD_SESSION_MESSAGE = "options-trade-dashboard-cookie-v1";

function isoWeekBucket(ms: number): string {
  const date = new Date(ms);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function deriveDashboardSessionToken(
  secret: string,
  bucket = isoWeekBucket(Date.now()),
): string {
  return createHmac("sha256", secret)
    .update(`${DASHBOARD_SESSION_MESSAGE}:${bucket}`)
    .digest("base64url");
}

export function deriveConvexDashboardSessionToken(secret: string): string {
  return createHmac("sha256", secret)
    .update(DASHBOARD_SESSION_MESSAGE)
    .digest("base64url");
}

export function verifyDashboardSessionToken(
  secret: string,
  token: string | undefined,
): boolean {
  if (!token) {
    return false;
  }
  const now = Date.now();
  const expectedTokens = [
    deriveDashboardSessionToken(secret, isoWeekBucket(now)),
    deriveDashboardSessionToken(secret, isoWeekBucket(now - 7 * 86400000)),
  ];
  try {
    const a = Buffer.from(token);
    for (const expected of expectedTokens) {
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function createDashboardSessionToken(): string {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    throw new Error("DASHBOARD_SECRET is not set");
  }
  return deriveDashboardSessionToken(secret);
}
