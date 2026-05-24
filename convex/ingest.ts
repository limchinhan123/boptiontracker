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
            realizedPnl: { type: "number" },
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
            "realizedPnl",
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
side should describe buy/sell and open/close if visible (e.g. "SELL TO OPEN").

Field mapping (do not confuse these):
- total: the execution cash amount labeled **Net Amount** (or similar: net debit/credit for this fill), not market value of the option.
- fees: commission and fees total if shown (else 0).
- realizedPnl: ONLY the value labeled **Realized PNL**, **Realized P&L**, or **R P&L** on the trade/execution details screen. Copy the signed number as shown (e.g. 172.804035). If that label is not visible anywhere on the screenshot, use 0. Never put Net Amount or premium into realizedPnl.`;

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
                text: "Extract all distinct option orders/trades visible in this screenshot. Include Realized PNL when IBKR shows it on this screen.",
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
          realizedPnl:
            typeof t.realizedPnl === "number" &&
            Number.isFinite(t.realizedPnl)
              ? t.realizedPnl
              : undefined,
          modelOutput: raw,
        });
        tradeIds.push(id);
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
      return { status: "error" as const, tradeIds: [id], message: msg };
    }
  },
});

const BALANCE_EXTRACT_SCHEMA = {
  name: "ibkr_balance_snapshot",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      currency: { type: "string" },
      netLiquidation: { type: "number" },
      cash: { type: "number" },
      buyingPower: { type: "number" },
      availableFunds: { type: "number" },
      excessLiquidity: { type: "number" },
      initialMargin: { type: "number" },
      maintenanceMargin: { type: "number" },
      regTMargin: { type: "number" },
      securitiesGrossPositionValue: { type: "number" },
      unrealizedPnl: { type: "number" },
      realizedPnl: { type: "number" },
      sma: { type: "number" },
      confidence: { type: "number" },
      needsReview: { type: "boolean" },
    },
    required: [
      "currency",
      "netLiquidation",
      "cash",
      "buyingPower",
      "availableFunds",
      "excessLiquidity",
      "initialMargin",
      "maintenanceMargin",
      "regTMargin",
      "securitiesGrossPositionValue",
      "unrealizedPnl",
      "realizedPnl",
      "sma",
      "confidence",
      "needsReview",
    ],
  },
} as const;

const POSITION_EXTRACT_SCHEMA = {
  name: "ibkr_position_snapshot",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      currency: { type: "string" },
      netLiquidation: { type: "number" },
      unrealizedPnl: { type: "number" },
      realizedPnl: { type: "number" },
      excessLiquidity: { type: "number" },
      maintenanceMargin: { type: "number" },
      buyingPower: { type: "number" },
      sma: { type: "number" },
      theta: { type: "number" },
      spxDelta: { type: "number" },
      vega: { type: "number" },
      confidence: { type: "number" },
      needsReview: { type: "boolean" },
      positions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            symbol: { type: "string" },
            description: { type: "string" },
            pctNetLiq: { type: "number" },
            unrealizedPnl: { type: "number" },
            unrealizedPnlPct: { type: "number" },
            changePct: { type: "number" },
          },
          required: [
            "symbol",
            "description",
            "pctNetLiq",
            "unrealizedPnl",
            "unrealizedPnlPct",
            "changePct",
          ],
        },
      },
    },
    required: [
      "currency",
      "netLiquidation",
      "unrealizedPnl",
      "realizedPnl",
      "excessLiquidity",
      "maintenanceMargin",
      "buyingPower",
      "sma",
      "theta",
      "spxDelta",
      "vega",
      "confidence",
      "needsReview",
      "positions",
    ],
  },
} as const;

const BALANCE_SYSTEM_PROMPT = `You extract IBKR mobile Portfolio > Balances screenshot data.
Parse numbers as shown (strip K/M suffixes: 1.25M -> 1250000, 906.2K -> 906200). Preserve sign on P&L.
Map labels: Net Liquidation Value -> netLiquidation; Current Available Funds -> availableFunds; Current Excess Liquidity -> excessLiquidity; Current Initial Margin -> initialMargin; RegT Margin -> regTMargin; Securities Gross Position Value -> securitiesGrossPositionValue.
Use account currency from screen (e.g. SGD, USD). Set needsReview true if critical fields missing. Use 0 for unknown numeric fields.`;

const POSITION_SYSTEM_PROMPT = `You extract IBKR mobile Portfolio summary + Positions list screenshot.
Parse header metrics: Net liq -> netLiquidation; Unrealized P&L -> unrealizedPnl; Realized P&L -> realizedPnl; Excess Liq -> excessLiquidity; Maint. Mgn -> maintenanceMargin; Buying Power -> buyingPower; Theta -> theta; SPX Delta -> spxDelta; Vega -> vega; SMA -> sma.
For each position row: symbol (e.g. MU, CBRS, AVGO), description (full option line if shown), pctNetLiq (% Net Liq column), unrealizedPnl, unrealizedPnlPct, changePct (Chg %).
Parse K/M suffixes to full numbers. Set needsReview true if header or most positions unclear.`;

type SnapshotId = Id<"accountSnapshots">;

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export const processTelegramSnapshot = action({
  args: {
    ingestSecret: v.string(),
    messageId: v.string(),
    kind: v.union(v.literal("balance"), v.literal("position")),
    imageBase64: v.string(),
    mimeType: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("skipped"),
      v.literal("ok"),
      v.literal("error"),
    ),
    snapshotId: v.optional(v.id("accountSnapshots")),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    assertIngestSecret(args.ingestSecret);

    const exists = await ctx.runQuery(internal.snapshots.anySnapshotForMessage, {
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
    const isBalance = args.kind === "balance";
    const schema = isBalance ? BALANCE_EXTRACT_SCHEMA : POSITION_EXTRACT_SCHEMA;
    const systemPrompt = isBalance ? BALANCE_SYSTEM_PROMPT : POSITION_SYSTEM_PROMPT;

    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: isBalance
                  ? "Extract the Balances tab account snapshot."
                  : "Extract the Portfolio Positions summary and position rows.",
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
            name: schema.name,
            strict: schema.strict,
            schema: schema.schema,
          },
        },
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error("Empty model response");
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;

      const positions =
        !isBalance && Array.isArray(parsed.positions)
          ? parsed.positions
              .map((row) => {
                const r = row as Record<string, unknown>;
                const symbol = str(r.symbol);
                if (!symbol) return null;
                return {
                  symbol,
                  description: str(r.description),
                  pctNetLiq: num(r.pctNetLiq),
                  unrealizedPnl: num(r.unrealizedPnl),
                  unrealizedPnlPct: num(r.unrealizedPnlPct),
                  changePct: num(r.changePct),
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null)
          : undefined;

      const id: SnapshotId = await ctx.runMutation(
        internal.snapshots.insertSnapshot,
        {
          createdAt,
          source: "telegram",
          messageId: args.messageId,
          kind: args.kind,
          imageStorageId: storageId,
          currency: str(parsed.currency) ?? "USD",
          needsReview: Boolean(parsed.needsReview),
          confidence: num(parsed.confidence),
          modelOutput: raw,
          netLiquidation: num(parsed.netLiquidation),
          cash: num(parsed.cash),
          buyingPower: num(parsed.buyingPower),
          availableFunds: num(parsed.availableFunds),
          excessLiquidity: num(parsed.excessLiquidity),
          initialMargin: num(parsed.initialMargin),
          maintenanceMargin: num(parsed.maintenanceMargin),
          regTMargin: num(parsed.regTMargin),
          securitiesGrossPositionValue: num(parsed.securitiesGrossPositionValue),
          unrealizedPnl: num(parsed.unrealizedPnl),
          realizedPnl: num(parsed.realizedPnl),
          sma: num(parsed.sma),
          theta: num(parsed.theta),
          spxDelta: num(parsed.spxDelta),
          vega: num(parsed.vega),
          positions,
        },
      );

      return { status: "ok" as const, snapshotId: id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const id: SnapshotId = await ctx.runMutation(
        internal.snapshots.insertSnapshot,
        {
          createdAt,
          source: "telegram",
          messageId: args.messageId,
          kind: args.kind,
          imageStorageId: storageId,
          needsReview: true,
          ingestError: msg,
        },
      );
      return { status: "error" as const, snapshotId: id, message: msg };
    }
  },
});
