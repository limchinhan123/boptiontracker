import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  cookieName,
  createSessionCookieValue,
  verifySessionCookie,
} from "@/lib/session";

export async function POST(request: Request) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password = body.password ?? "";
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || password !== expected) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
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
