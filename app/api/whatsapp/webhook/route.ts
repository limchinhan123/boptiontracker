import { NextResponse } from "next/server";

/**
 * Extension point for WhatsApp Cloud API (Meta) webhooks.
 * Mirror the flow in `app/api/telegram/webhook/route.ts`: verify signature,
 * download media, then call `api.ingest.processTelegramScreenshot` or a
 * dedicated ingest action with source `whatsapp`.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "WhatsApp ingest is not implemented yet.",
      hint: "Use the Telegram webhook for now; see Meta WhatsApp Cloud API docs for parity.",
    },
    { status: 501 },
  );
}
