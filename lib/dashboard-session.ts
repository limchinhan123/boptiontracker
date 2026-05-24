import { createHmac, timingSafeEqual } from "crypto";

export const DASHBOARD_SESSION_MESSAGE = "options-trade-dashboard-cookie-v1";

export function deriveDashboardSessionToken(secret: string): string {
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
  const expected = deriveDashboardSessionToken(secret);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
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
