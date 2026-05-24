"use client";

import dynamic from "next/dynamic";
import type { LatestSnapshots, WeeklyReviewRow } from "./dashboard-client";

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
  initialReview = null,
}: {
  initialSnapshots?: LatestSnapshots | null;
  initialReview?: WeeklyReviewRow | null;
}) {
  return (
    <DashboardClient
      initialSnapshots={initialSnapshots}
      initialReview={initialReview}
    />
  );
}
