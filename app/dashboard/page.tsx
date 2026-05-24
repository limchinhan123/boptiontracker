import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClientLoader from "./dashboard-client-loader";
import type { LatestSnapshots } from "./dashboard-client";
import { api, getConvexClient, requireDashboardSecret } from "@/lib/convex-server";
import { cookieName, verifySessionCookie } from "@/lib/session";

export default async function DashboardPage() {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    redirect("/login");
  }

  let initialSnapshots: LatestSnapshots | null = null;
  try {
    const client = getConvexClient();
    initialSnapshots = await client.query(api.snapshots.latestByKind, {
      dashboardSecret: requireDashboardSecret(),
    });
  } catch {
    initialSnapshots = null;
  }

  return <DashboardClientLoader initialSnapshots={initialSnapshots} />;
}
