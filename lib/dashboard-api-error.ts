import { NextResponse } from "next/server";

export function logDashboardRouteError(route: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${route}]`, message, error);
}

export function dashboardJsonError(
  route: string,
  error: unknown,
  clientMessage: string,
  status = 502,
): NextResponse<{ error: string }> {
  logDashboardRouteError(route, error);
  return NextResponse.json({ error: clientMessage }, { status });
}

export function dashboardTextError(
  route: string,
  error: unknown,
  clientMessage: string,
  status = 502,
): Response {
  logDashboardRouteError(route, error);
  return new Response(clientMessage, { status });
}
