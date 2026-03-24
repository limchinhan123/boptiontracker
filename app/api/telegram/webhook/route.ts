import { NextResponse } from "next/server";
import { api, getConvexClient } from "@/lib/convex-server";

export const runtime = "nodejs";

function extToMime(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  return "image/jpeg";
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const update = body as {
    message?: {
      message_id: number;
      photo?: Array<{ file_id: string; width: number; height: number }>;
    };
  };

  const msg = update.message;
  if (!msg?.photo?.length) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return new NextResponse("TELEGRAM_BOT_TOKEN not configured", { status: 500 });
  }

  const largest = msg.photo.reduce((a, b) =>
    a.height * a.width > b.height * b.width ? a : b,
  );
  const fileId = largest.file_id;
  const messageId = String(msg.message_id);

  const fileMetaRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const fileMeta = (await fileMetaRes.json()) as {
    ok?: boolean;
    result?: { file_path?: string };
  };
  if (!fileMeta.ok || !fileMeta.result?.file_path) {
    return new NextResponse("getFile failed", { status: 502 });
  }

  const filePath = fileMeta.result.file_path;
  const ext = filePath.split(".").pop() ?? "jpg";
  const mimeType = extToMime(ext);

  const imageRes = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
  );
  if (!imageRes.ok) {
    return new NextResponse("download failed", { status: 502 });
  }

  const buf = Buffer.from(await imageRes.arrayBuffer());
  const imageBase64 = buf.toString("base64");

  const ingestSecret = process.env.INGEST_SECRET;
  if (!ingestSecret) {
    return new NextResponse("INGEST_SECRET not configured", { status: 500 });
  }

  const client = getConvexClient();
  try {
    await client.action(api.ingest.processTelegramScreenshot, {
      ingestSecret,
      messageId,
      imageBase64,
      mimeType,
    });
  } catch (e) {
    console.error("Convex ingest failed", e);
    return new NextResponse("Ingest failed", { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
