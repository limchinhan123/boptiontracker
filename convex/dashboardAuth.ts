const SESSION_MESSAGE = "options-trade-dashboard-cookie-v1";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deriveDashboardSessionToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(SESSION_MESSAGE));
  return base64UrlEncode(new Uint8Array(sig));
}

export async function assertDashboardSession(sessionToken: string): Promise<void> {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    throw new Error("Unauthorized");
  }
  const expected = await deriveDashboardSessionToken(secret);
  if (sessionToken.length !== expected.length) {
    throw new Error("Unauthorized");
  }
  let mismatch = 0;
  for (let i = 0; i < sessionToken.length; i++) {
    mismatch |= sessionToken.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw new Error("Unauthorized");
  }
}
