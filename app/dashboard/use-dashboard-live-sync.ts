"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";

/** Live-sync: refresh dashboard when Convex feed version bumps (e.g. Telegram ingest). */
export function useDashboardLiveSync(onRefresh: () => void) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const seenVersion = useRef<number | null>(null);
  const pendingRefresh = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dashboard/convex-session", {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { sessionToken?: string };
        if (data.sessionToken) {
          setSessionToken(data.sessionToken);
        }
      } catch {
        /* live sync optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const feed = useQuery(
    api.dashboardFeed.getVersion,
    sessionToken ? { sessionToken } : "skip",
  );

  useEffect(() => {
    if (!feed) return;
    if (seenVersion.current === null) {
      seenVersion.current = feed.version;
      return;
    }
    if (feed.version === seenVersion.current) return;
    seenVersion.current = feed.version;

    if (document.visibilityState === "visible") {
      onRefresh();
    } else {
      pendingRefresh.current = true;
    }
  }, [feed?.version, onRefresh]);

  useEffect(() => {
    function onVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        pendingRefresh.current
      ) {
        pendingRefresh.current = false;
        onRefresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [onRefresh]);
}
