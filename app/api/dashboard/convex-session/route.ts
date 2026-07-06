import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  cookieName,
  createConvexSessionToken,
  verifySessionCookie,
} from "@/lib/session";

export const runtime = "nodejs";

/** Issue the dashboard session token for Convex live subscriptions (browser only). */
export async function GET() {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!verifySessionCookie(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ sessionToken: createConvexSessionToken() });
}
