"use client";

import dynamic from "next/dynamic";
import type { LatestSnapshots } from "./dashboard-client";

const DashboardClient = dynamic(() => import("./dashboard-client"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-zinc-500">
      Loading…
    </div>
  ),
});

export default function DashboardClientLoader({
  initialSnapshots = null,
}: {
  initialSnapshots?: LatestSnapshots | null;
}) {
  return <DashboardClient initialSnapshots={initialSnapshots} />;
}
