import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  cookieName,
  createSessionCookieValue,
  verifySessionCookie,
} from "@/lib/session";

const failedLogins = new Map<string, { count: number; nextAllowedAt: number }>();
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

function loginKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "local";
}

export async function POST(request: Request) {
  const key = loginKey(request);
  const now = Date.now();
  const existing = failedLogins.get(key);
  if (existing && existing.nextAllowedAt > now) {
    const waitSeconds = Math.ceil((existing.nextAllowedAt - now) / 1000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${waitSeconds}s.` },
      { status: 429 },
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password = body.password ?? "";
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || password !== expected) {
    const count = (existing?.count ?? 0) + 1;
    const backoff =
      count <= 3
        ? 0
        : Math.min(MAX_BACKOFF_MS, 2 ** (count - 4) * BASE_BACKOFF_MS);
    failedLogins.set(key, { count, nextAllowedAt: now + backoff });
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  failedLogins.delete(key);
  const store = await cookies();
  store.set(cookieName(), createSessionCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const store = await cookies();
  const ok = verifySessionCookie(store.get(cookieName())?.value);
  return NextResponse.json({ ok });
}
