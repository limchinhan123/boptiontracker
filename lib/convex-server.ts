import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

let client: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  if (!client) {
    client = new ConvexHttpClient(url);
  }
  return client;
}

export function requireDashboardSecret(): string {
  const s = process.env.DASHBOARD_SECRET;
  if (!s) {
    throw new Error("DASHBOARD_SECRET is not set");
  }
  return s;
}

export { api };
