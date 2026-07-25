import { Router, type IRouter, type Request } from "express";
import { asc, eq } from "drizzle-orm";
import OpenAI from "openai";
import { z } from "zod";
import {
  db,
  historyTable,
  itemsTable,
  warehouseItemsTable,
} from "@workspace/db";
import {
  canViewAllLocations,
  requireAccount,
  requireActiveMembership,
} from "../middleware/auth";
import { AI_MODELS } from "../lib/ai-config";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

type RecommendationSeverity = "critical" | "warning" | "info";
type RecommendationType = "store_restock" | "store_overstock" | "warehouse_reorder";
type AgentRecommendation = {
  type: RecommendationType;
  severity: RecommendationSeverity;
  itemId: number;
  itemName: string;
  location?: string;
  quantity: number;
  minQuantity?: number;
  maxQuantity?: number;
  minPar?: number;
  maxPar?: number;
  recommendedTransferQty?: number;
  recommendedPurchaseQty?: number;
  message: string;
};
type HousekeepingSummary = {
  belowMinimumCount: number;
  overstockCount: number;
  warehouseReorderCount: number;
  recentChangeCount: number;
};
type HousekeepingContext = {
  generatedAt: string;
  mode: "read_only";
  summary: HousekeepingSummary;
  recommendations: AgentRecommendation[];
};

const ConversationSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(2000),
  })).max(12).optional(),
});

// AI_AGENT_OPENAI_* lets the planning agent point at a different backend
// (e.g. a self-hosted RunPod endpoint) than voice transcribe/TTS, which still
// use AI_INTEGRATIONS_OPENAI_*. Falls back to AI_INTEGRATIONS_OPENAI_* when unset,
// so environments that haven't configured it behave exactly as before.
function hasUsableAiCredentials() {
  const baseUrl = process.env.AI_AGENT_OPENAI_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_AGENT_OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  return Boolean(baseUrl && apiKey && apiKey !== "dev-placeholder");
}

function createOpenAIClient() {
  if (!hasUsableAiCredentials()) return null;
  return new OpenAI({
    baseURL: process.env.AI_AGENT_OPENAI_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_AGENT_OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

function storeStatus(item: typeof itemsTable.$inferSelect) {
  if (item.quantity <= 0) return "out";
  if (item.quantity < item.minQuantity) return "below_minimum";
  if (item.maxQuantity > 0 && item.quantity > item.maxQuantity) return "overstock";
  return "ok";
}

function recommendedTransfer(item: typeof itemsTable.$inferSelect) {
  if (item.quantity >= item.minQuantity) return 0;
  return Math.max(0, item.maxQuantity - item.quantity);
}

async function buildHousekeepingContext(req: Request): Promise<HousekeepingContext> {
  const allStoreItems = await db
    .select()
    .from(itemsTable)
    .where(eq(itemsTable.accountId, req.account!.id))
    .orderBy(asc(itemsTable.location), asc(itemsTable.category), asc(itemsTable.name));

  const allowedLocationIds = new Set(req.allowedLocationIds ?? []);
  const legacyLocations = new Set(req.authUser?.assignedLocations ?? []);
  const storeItems = canViewAllLocations(req)
    ? allStoreItems
    : allStoreItems.filter((item) => {
        if (item.locationId !== null && allowedLocationIds.has(item.locationId)) return true;
        return legacyLocations.has(item.location);
      });

  const warehouseItems = canViewAllLocations(req)
    ? await db
        .select()
        .from(warehouseItemsTable)
        .where(eq(warehouseItemsTable.accountId, req.account!.id))
        .orderBy(asc(warehouseItemsTable.category), asc(warehouseItemsTable.name))
    : [];

  const recentHistory = await db
    .select()
    .from(historyTable)
    .where(eq(historyTable.accountId, req.account!.id))
    .orderBy(historyTable.createdAt)
    .limit(100);

  const belowMinimum: AgentRecommendation[] = storeItems
    .filter((item) => storeStatus(item) === "below_minimum" || storeStatus(item) === "out")
    .map((item): AgentRecommendation => ({
      type: "store_restock",
      severity: item.quantity <= 0 ? "critical" : "warning",
      itemId: item.id,
      itemName: item.name,
      location: item.location,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      recommendedTransferQty: recommendedTransfer(item),
      message: `${item.name} at ${item.location} is below minimum. Transfer ${recommendedTransfer(item)} units to refill toward maximum.`,
    }));

  const overstock: AgentRecommendation[] = storeItems
    .filter((item) => storeStatus(item) === "overstock")
    .map((item): AgentRecommendation => ({
      type: "store_overstock",
      severity: "info",
      itemId: item.id,
      itemName: item.name,
      location: item.location,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      message: `${item.name} at ${item.location} is above maximum stock.`,
    }));

  const warehouseReorder: AgentRecommendation[] = warehouseItems
    .filter((item) => item.quantity < item.minPar || (item.reorderPoint > 0 && item.quantity <= item.reorderPoint))
    .map((item): AgentRecommendation => ({
      type: "warehouse_reorder",
      severity: item.quantity <= 0 ? "critical" : "warning",
      itemId: item.id,
      itemName: item.name,
      quantity: item.quantity,
      minPar: item.minPar,
      maxPar: item.maxPar,
      recommendedPurchaseQty: Math.max(0, item.maxPar - item.quantity),
      message: `${item.name} warehouse quantity is below reorder range.`,
    }));

  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    summary: {
      belowMinimumCount: belowMinimum.length,
      overstockCount: overstock.length,
      warehouseReorderCount: warehouseReorder.length,
      recentChangeCount: recentHistory.length,
    },
    recommendations: [...belowMinimum, ...overstock, ...warehouseReorder].slice(0, 100),
  };
}

function deterministicAgentReply(message: string, context: HousekeepingContext) {
  const text = message.toLowerCase();
  const recs = context.recommendations;
  const below = recs.filter((rec) => rec.type === "store_restock");
  const overstock = recs.filter((rec) => rec.type === "store_overstock");
  const warehouse = recs.filter((rec) => rec.type === "warehouse_reorder");
  const top = (items: AgentRecommendation[]) => items.slice(0, 5).map((rec) => `- ${rec.message}`).join("\n");

  if (/warehouse|purchase|buy|reorder/.test(text)) {
    return warehouse.length
      ? `Warehouse reorder needs found: ${warehouse.length}.\n${top(warehouse)}`
      : "I do not see warehouse reorder needs in the current read-only snapshot.";
  }

  if (/overstock|too much|above/.test(text)) {
    return overstock.length
      ? `Overstock items found: ${overstock.length}.\n${top(overstock)}`
      : "I do not see store overstock items in the current read-only snapshot.";
  }

  if (/restock|low|minimum|below|transfer/.test(text)) {
    return below.length
      ? `Store restock needs found: ${below.length}.\n${top(below)}`
      : "I do not see store items below minimum in the current read-only snapshot.";
  }

  return [
    `Current read-only summary: ${context.summary.belowMinimumCount} below minimum, ${context.summary.overstockCount} overstock, ${context.summary.warehouseReorderCount} warehouse reorder items, and ${context.summary.recentChangeCount} recent changes reviewed.`,
    recs.length > 0 ? `Top recommendation: ${recs[0]!.message}` : "No recommendations are open right now.",
    "Ask about restock, overstock, warehouse reorders, or priority items for a narrower answer.",
  ].join("\n");
}

function agentPrompt(context: HousekeepingContext) {
  const compactRecommendations = context.recommendations.slice(0, 40).map((rec) => ({
    type: rec.type,
    severity: rec.severity,
    itemName: rec.itemName,
    location: rec.location,
    quantity: rec.quantity,
    minQuantity: rec.minQuantity,
    maxQuantity: rec.maxQuantity,
    minPar: rec.minPar,
    maxPar: rec.maxPar,
    recommendedTransferQty: rec.recommendedTransferQty,
    recommendedPurchaseQty: rec.recommendedPurchaseQty,
    message: rec.message,
  }));

  return `You are KeepTally's read-only operations insights assistant.
Use only the supplied inventory summary and recommendations.
Do not invent inventory, costs, vendors, users, or actions.
Do not claim that you changed the database.
Give concise, practical answers for an operations manager.

Current summary:
${JSON.stringify(context.summary)}

Current recommendations:
${JSON.stringify(compactRecommendations)}`;
}

router.get("/agents/housekeeping", async (req, res) => {
  res.json(await buildHousekeepingContext(req));
});

router.post("/agents/conversation", async (req, res) => {
  const parsed = ConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const context = await buildHousekeepingContext(req);
  const client = createOpenAIClient();

  if (!client) {
    res.json({
      answer: deterministicAgentReply(parsed.data.message, context),
      source: "deterministic",
      generatedAt: context.generatedAt,
      context: {
        summary: context.summary,
        recommendationCount: context.recommendations.length,
      },
    });
    return;
  }

  try {
    const history = (parsed.data.messages ?? []).slice(-8).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const response = await client.chat.completions.create({
      model: AI_MODELS.planningAgent,
      max_completion_tokens: 600,
      messages: [
        { role: "system", content: agentPrompt(context) },
        ...history,
        { role: "user", content: parsed.data.message },
      ],
    });
    const answer = response.choices[0]?.message?.content?.trim() || deterministicAgentReply(parsed.data.message, context);
    res.json({
      answer,
      source: "ai",
      generatedAt: context.generatedAt,
      context: {
        summary: context.summary,
        recommendationCount: context.recommendations.length,
      },
    });
  } catch (err) {
    logger.error({ err, requestId: req.id }, "Agent conversation failed");
    res.status(502).json({
      error: "Agent conversation failed",
      answer: deterministicAgentReply(parsed.data.message, context),
      source: "deterministic-fallback",
    });
  }
});

export default router;
