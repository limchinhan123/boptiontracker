import {
  createDashboardSessionToken,
  verifyDashboardSessionToken,
} from "./dashboard-session";

const COOKIE_NAME = "options_dashboard_sid";

export function cookieName() {
  return COOKIE_NAME;
}

export function verifySessionCookie(value: string | undefined): boolean {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    return false;
  }
  return verifyDashboardSessionToken(secret, value);
}

export function createSessionCookieValue(): string {
  return createDashboardSessionToken();
}
