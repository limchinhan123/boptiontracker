import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClientLoader from "./dashboard-client-loader";
import { cookieName, verifySessionCookie } from "@/lib/session";

export default async function DashboardPage() {
  const store = await cookies();
  if (!verifySessionCookie(store.get(cookieName())?.value)) {
    redirect("/login");
  }
  return <DashboardClientLoader />;
}
