import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { dashboardJsonError } from "@/lib/dashboard-api-error";
import { cookieName, verifySessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getConvexClient();
    const profile = await client.query(api.coachSettings.getProfile, {
      dashboardSecret: requireDashboardSecret(),
    });
    return NextResponse.json(profile);
  } catch (e) {
    return dashboardJsonError(
      "dashboard/coach/profile",
      e,
      "Profile load failed",
      502,
    );
  }
}

export async function PATCH(request: Request) {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { profileNotes?: string };
  try {
    body = (await request.json()) as { profileNotes?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.profileNotes !== "string") {
    return NextResponse.json({ error: "profileNotes required" }, { status: 400 });
  }

  try {
    const client = getConvexClient();
    await client.mutation(api.coachSettings.updateProfile, {
      dashboardSecret: requireDashboardSecret(),
      profileNotes: body.profileNotes,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return dashboardJsonError(
      "dashboard/coach/profile",
      e,
      "Profile save failed",
      502,
    );
  }
}
