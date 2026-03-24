import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "options_dashboard_sid";

export function cookieName() {
  return COOKIE_NAME;
}

function deriveSessionToken(): string {
  const s = process.env.DASHBOARD_SECRET;
  if (!s) {
    throw new Error("DASHBOARD_SECRET is not set");
  }
  return createHmac("sha256", s)
    .update("options-trade-dashboard-cookie-v1")
    .digest("base64url");
}

export function verifySessionCookie(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  if (!process.env.DASHBOARD_SECRET) {
    return false;
  }
  const expected = deriveSessionToken();
  try {
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function createSessionCookieValue(): string {
  return deriveSessionToken();
}
