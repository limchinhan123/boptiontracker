"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type TradeId = Id<"trades">;
import { action } from "./_generated/server";

const EXTRACT_SCHEMA = {
  name: "ibkr_option_trades",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      trades: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            underlying: { type: "string" },
            optionType: {
              type: "string",
              enum: ["call", "put", "unknown"],
            },
            strike: { type: "number" },
            expiration: { type: "string" },
            multiplier: { type: "number" },
            side: { type: "string" },
            quantity: { type: "number" },
            price: { type: "number" },
            total: { type: "number" },
            fees: { type: "number" },
            currency: { type: "string" },
            strategyTag: { type: "string" },
            notes: { type: "string" },
            confidence: { type: "number" },
            needsReview: { type: "boolean" },
          },
          required: [
            "underlying",
            "optionType",
            "strike",
            "expiration",
            "multiplier",
            "side",
            "quantity",
            "price",
            "total",
            "fees",
            "currency",
            "strategyTag",
            "notes",
            "confidence",
            "needsReview",
          ],
        },
      },
    },
    required: ["trades"],
  },
} as const;

const SYSTEM_PROMPT = `You extract structured option trade data from Interactive Brokers (IBKR) mobile or desktop screenshots.
Use null or empty string only where the schema requires a value — prefer numbers for numeric fields; use 0 if unknown for numbers and "USD" as default currency if unclear.
Set needsReview true if any critical field is missing or ambiguous. expiration should be YYYY-MM-DD when possible.
side should describe buy/sell and open/close if visible (e.g. "SELL TO OPEN").`;

function assertIngestSecret(secret: string) {
  const expected = process.env.INGEST_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized ingest");
  }
}

export const processTelegramScreenshot = action({
  args: {
    ingestSecret: v.string(),
    messageId: v.string(),
    imageBase64: v.string(),
    mimeType: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("skipped"),
      v.literal("ok"),
      v.literal("error"),
    ),
    tradeIds: v.optional(v.array(v.id("trades"))),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    status: "skipped" | "ok" | "error";
    tradeIds?: TradeId[];
    message?: string;
  }> => {
    assertIngestSecret(args.ingestSecret);

    const exists = await ctx.runQuery(internal.trades.anyTradeForMessage, {
      source: "telegram",
      messageId: args.messageId,
    });
    if (exists) {
      return { status: "skipped" as const };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    let storageId: Id<"_storage"> | undefined;
    try {
      const buffer = Buffer.from(args.imageBase64, "base64");
      const blob = new Blob([new Uint8Array(buffer)], { type: args.mimeType });
      storageId = await ctx.storage.store(blob);
    } catch {
      storageId = undefined;
    }

    const openai = new OpenAI({ apiKey });
    const createdAt = Date.now();

    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all distinct option orders/trades visible in this screenshot.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${args.mimeType};base64,${args.imageBase64}`,
                },
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: EXTRACT_SCHEMA.name,
            strict: EXTRACT_SCHEMA.strict,
            schema: EXTRACT_SCHEMA.schema,
          },
        },
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error("Empty model response");
      }

      const parsed = JSON.parse(raw) as {
        trades: Array<Record<string, unknown>>;
      };

      if (!parsed.trades?.length) {
        const id: TradeId = await ctx.runMutation(
          internal.trades.insertTradeLeg,
          {
            createdAt,
            source: "telegram",
            messageId: args.messageId,
            legIndex: 0,
            imageStorageId: storageId,
            needsReview: true,
            ingestError: "Model returned no trades",
            modelOutput: raw,
          },
        );
        await ctx.scheduler.runAfter(0, internal.sheets.syncTradeToSheets, {
          tradeId: id,
        });
        return { status: "ok" as const, tradeIds: [id] };
      }

      const tradeIds: TradeId[] = [];
      for (let i = 0; i < parsed.trades.length; i++) {
        const t = parsed.trades[i];
        const optionType =
          t.optionType === "call" || t.optionType === "put"
            ? t.optionType
            : "unknown";
        const id: TradeId = await ctx.runMutation(internal.trades.insertTradeLeg, {
          createdAt,
          source: "telegram",
          messageId: args.messageId,
          legIndex: i,
          imageStorageId: storageId,
          underlying: String(t.underlying ?? ""),
          optionType,
          strike: typeof t.strike === "number" ? t.strike : undefined,
          expiration:
            typeof t.expiration === "string" ? t.expiration : undefined,
          multiplier: typeof t.multiplier === "number" ? t.multiplier : 100,
          side: typeof t.side === "string" ? t.side : undefined,
          quantity: typeof t.quantity === "number" ? t.quantity : undefined,
          price: typeof t.price === "number" ? t.price : undefined,
          total: typeof t.total === "number" ? t.total : undefined,
          fees: typeof t.fees === "number" ? t.fees : undefined,
          currency: typeof t.currency === "string" ? t.currency : "USD",
          strategyTag:
            typeof t.strategyTag === "string" ? t.strategyTag : undefined,
          notes: typeof t.notes === "string" ? t.notes : undefined,
          confidence:
            typeof t.confidence === "number" ? t.confidence : undefined,
          needsReview: Boolean(t.needsReview),
          modelOutput: raw,
        });
        tradeIds.push(id);
        await ctx.scheduler.runAfter(0, internal.sheets.syncTradeToSheets, {
          tradeId: id,
        });
      }

      return { status: "ok" as const, tradeIds };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const id: TradeId = await ctx.runMutation(internal.trades.insertTradeLeg, {
        createdAt,
        source: "telegram",
        messageId: args.messageId,
        legIndex: 0,
        imageStorageId: storageId,
        needsReview: true,
        ingestError: msg,
      });
      await ctx.scheduler.runAfter(0, internal.sheets.syncTradeToSheets, {
        tradeId: id,
      });
      return { status: "error" as const, tradeIds: [id], message: msg };
    }
  },
});
