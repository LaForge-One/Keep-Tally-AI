import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
type LocationInsight = {
  location: string;
  itemCount: number;
  totalQuantity: number;
  belowMinimumCount: number;
  outOfStockCount: number;
  overstockCount: number;
  deficitUnits: number;
  recommendedTransferUnits: number;
};
type ItemInsight = {
  itemId: number;
  itemName: string;
  location: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  category: string;
  status: ReturnType<typeof storeStatus>;
};
type StockoutSeverity = "warning" | "high" | "critical";
type StockoutInsight = {
  itemId: number;
  itemName: string;
  location: string;
  category: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  outOfStockSince: string;
  outOfStockHours: number;
  outOfStockDays: number;
  ageLabel: string;
  severity: StockoutSeverity;
  evidence: "history_transition" | "last_updated_fallback";
};
type LocationStockoutSummary = {
  location: string;
  outOfStockCount: number;
  longestOutOfStockHours: number;
  longestOutOfStockLabel: string;
  criticalStockoutCount: number;
};
type ShrinkageInsight = {
  totalRecentEvents: number;
  byReason: Array<{ reason: string; count: number }>;
  byLocation: Array<{ location: string; count: number }>;
  recentExamples: Array<{ itemName: string; location: string | null; reason: string; note: string | null }>;
};
type HousekeepingSummary = {
  belowMinimumCount: number;
  overstockCount: number;
  warehouseReorderCount: number;
  recentChangeCount: number;
  outOfStockCount: number;
  locationCount: number;
  shrinkageEventCount: number;
  longStockoutCount: number;
};
type HousekeepingContext = {
  generatedAt: string;
  mode: "read_only";
  summary: HousekeepingSummary;
  recommendations: AgentRecommendation[];
  locationInsights: LocationInsight[];
  lowestStockItems: ItemInsight[];
  longestStockouts: StockoutInsight[];
  locationStockouts: LocationStockoutSummary[];
  shrinkage: ShrinkageInsight;
};

const ConversationSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(2000),
  })).max(12).optional(),
});

function hasUsableAiCredentials() {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  return Boolean(baseUrl && apiKey && apiKey !== "dev-placeholder");
}

function createOpenAIClient() {
  if (!hasUsableAiCredentials()) return null;
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
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

function buildLocationInsights(storeItems: Array<typeof itemsTable.$inferSelect>): LocationInsight[] {
  const byLocation = new Map<string, LocationInsight>();

  for (const item of storeItems) {
    const current = byLocation.get(item.location) ?? {
      location: item.location,
      itemCount: 0,
      totalQuantity: 0,
      belowMinimumCount: 0,
      outOfStockCount: 0,
      overstockCount: 0,
      deficitUnits: 0,
      recommendedTransferUnits: 0,
    };
    const status = storeStatus(item);
    current.itemCount += 1;
    current.totalQuantity += item.quantity;
    if (status === "out") current.outOfStockCount += 1;
    if (status === "out" || status === "below_minimum") {
      current.belowMinimumCount += 1;
      current.deficitUnits += Math.max(0, item.minQuantity - item.quantity);
      current.recommendedTransferUnits += recommendedTransfer(item);
    }
    if (status === "overstock") current.overstockCount += 1;
    byLocation.set(item.location, current);
  }

  return Array.from(byLocation.values()).sort((a, b) => {
    const riskDelta = b.belowMinimumCount + b.outOfStockCount - (a.belowMinimumCount + a.outOfStockCount);
    if (riskDelta !== 0) return riskDelta;
    const deficitDelta = b.deficitUnits - a.deficitUnits;
    if (deficitDelta !== 0) return deficitDelta;
    return a.totalQuantity - b.totalQuantity;
  });
}

function buildLowestStockItems(storeItems: Array<typeof itemsTable.$inferSelect>): ItemInsight[] {
  return storeItems
    .map((item): ItemInsight => ({
      itemId: item.id,
      itemName: item.name,
      location: item.location,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      category: item.category,
      status: storeStatus(item),
    }))
    .sort((a, b) => {
      const statusRank = (status: ItemInsight["status"]) => status === "out" ? 0 : status === "below_minimum" ? 1 : status === "ok" ? 2 : 3;
      const rankDelta = statusRank(a.status) - statusRank(b.status);
      if (rankDelta !== 0) return rankDelta;
      const quantityDelta = a.quantity - b.quantity;
      if (quantityDelta !== 0) return quantityDelta;
      return a.itemName.localeCompare(b.itemName);
    })
    .slice(0, 20);
}

function parseHistoryQuantity(value: string | null) {
  if (!value) return null;
  const match = value.match(/-?\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function stockoutSeverity(hours: number): StockoutSeverity {
  if (hours >= 72) return "critical";
  if (hours >= 24) return "high";
  return "warning";
}

function stockoutAgeLabel(hours: number) {
  if (hours < 1) return "Out for less than 1 hour";
  if (hours < 24) return `Out for ${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `Out for ${days} day${days === 1 ? "" : "s"}`;
}

function buildStockoutInsights(
  storeItems: Array<typeof itemsTable.$inferSelect>,
  quantityHistory: Array<typeof historyTable.$inferSelect>,
): StockoutInsight[] {
  const historyByItem = new Map<number, Array<typeof historyTable.$inferSelect>>();
  for (const row of quantityHistory) {
    if (row.itemId === null) continue;
    const rows = historyByItem.get(row.itemId) ?? [];
    rows.push(row);
    historyByItem.set(row.itemId, rows);
  }

  const now = Date.now();
  return storeItems
    .filter((item) => item.quantity <= 0)
    .map((item): StockoutInsight => {
      const transition = (historyByItem.get(item.id) ?? []).find((row) => {
        const previous = parseHistoryQuantity(row.previousValue);
        const next = parseHistoryQuantity(row.newValue);
        return previous !== null && next !== null && previous > 0 && next <= 0;
      });
      const since = transition?.createdAt ?? item.lastUpdated;
      const outOfStockHours = Math.max(0, Math.floor((now - since.getTime()) / 3_600_000));
      const outOfStockDays = Math.floor(outOfStockHours / 24);
      return {
        itemId: item.id,
        itemName: item.name,
        location: item.location,
        category: item.category,
        quantity: item.quantity,
        minQuantity: item.minQuantity,
        maxQuantity: item.maxQuantity,
        outOfStockSince: since.toISOString(),
        outOfStockHours,
        outOfStockDays,
        ageLabel: stockoutAgeLabel(outOfStockHours),
        severity: stockoutSeverity(outOfStockHours),
        evidence: transition ? "history_transition" : "last_updated_fallback",
      };
    })
    .sort((a, b) => {
      const hoursDelta = b.outOfStockHours - a.outOfStockHours;
      if (hoursDelta !== 0) return hoursDelta;
      return a.itemName.localeCompare(b.itemName);
    });
}

function buildLocationStockoutSummary(stockouts: StockoutInsight[]): LocationStockoutSummary[] {
  const byLocation = new Map<string, LocationStockoutSummary>();

  for (const stockout of stockouts) {
    const current = byLocation.get(stockout.location) ?? {
      location: stockout.location,
      outOfStockCount: 0,
      longestOutOfStockHours: 0,
      longestOutOfStockLabel: "No current stockouts",
      criticalStockoutCount: 0,
    };
    current.outOfStockCount += 1;
    if (stockout.outOfStockHours > current.longestOutOfStockHours) {
      current.longestOutOfStockHours = stockout.outOfStockHours;
      current.longestOutOfStockLabel = stockout.ageLabel;
    }
    if (stockout.severity === "critical") current.criticalStockoutCount += 1;
    byLocation.set(stockout.location, current);
  }

  return Array.from(byLocation.values()).sort((a, b) => {
    const countDelta = b.outOfStockCount - a.outOfStockCount;
    if (countDelta !== 0) return countDelta;
    return b.longestOutOfStockHours - a.longestOutOfStockHours;
  });
}

function shrinkageReason(row: typeof historyTable.$inferSelect) {
  const text = `${row.action ?? ""} ${row.field ?? ""} ${row.note ?? ""}`.toLowerCase();
  if (/theft|stolen|steal/.test(text)) return "Theft";
  if (/spoil|expired|bad/.test(text)) return "Spoilage";
  if (/\bcomp\b|complimentary|gave/.test(text)) return "Comp";
  if (/return to warehouse|returned to warehouse|send back|sent back/.test(text)) return "Return to Warehouse";
  if (/damage|damaged|broken|crushed/.test(text)) return "Damaged";
  if (/missing from bin|missing|not there|empty bin/.test(text)) return "Missing from Bin";
  if (/shrink|shortage|lower|adjustment/.test(text)) return "Adjustment";
  return null;
}

function buildShrinkageInsight(recentHistory: Array<typeof historyTable.$inferSelect>): ShrinkageInsight {
  const shrinkageRows = recentHistory
    .map((row) => ({ row, reason: shrinkageReason(row) }))
    .filter((entry): entry is { row: typeof historyTable.$inferSelect; reason: string } => Boolean(entry.reason));
  const byReason = new Map<string, number>();
  const byLocation = new Map<string, number>();

  for (const { row, reason } of shrinkageRows) {
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    const location = row.location ?? "Unknown";
    byLocation.set(location, (byLocation.get(location) ?? 0) + 1);
  }

  const sortCount = (a: { count: number }, b: { count: number }) => b.count - a.count;

  return {
    totalRecentEvents: shrinkageRows.length,
    byReason: Array.from(byReason.entries()).map(([reason, count]) => ({ reason, count })).sort(sortCount),
    byLocation: Array.from(byLocation.entries()).map(([location, count]) => ({ location, count })).sort(sortCount),
    recentExamples: shrinkageRows.slice(0, 5).map(({ row, reason }) => ({
      itemName: row.itemName,
      location: row.location,
      reason,
      note: row.note,
    })),
  };
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
    .orderBy(desc(historyTable.createdAt))
    .limit(100);
  const visibleHistory = canViewAllLocations(req)
    ? recentHistory
    : recentHistory.filter((row) => {
        if (row.locationId !== null && row.locationId !== undefined && allowedLocationIds.has(row.locationId)) return true;
        return row.location ? legacyLocations.has(row.location) : false;
      });
  const outOfStockItemIds = storeItems.filter((item) => item.quantity <= 0).map((item) => item.id);
  const quantityHistory = outOfStockItemIds.length > 0
    ? await db
        .select()
        .from(historyTable)
        .where(and(
          eq(historyTable.accountId, req.account!.id),
          eq(historyTable.field, "quantity"),
          inArray(historyTable.itemId, outOfStockItemIds),
        ))
        .orderBy(desc(historyTable.createdAt))
        .limit(5000)
    : [];

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
  const locationInsights = buildLocationInsights(storeItems);
  const lowestStockItems = buildLowestStockItems(storeItems);
  const longestStockouts = buildStockoutInsights(storeItems, quantityHistory);
  const locationStockouts = buildLocationStockoutSummary(longestStockouts);
  const shrinkage = buildShrinkageInsight(visibleHistory);

  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    summary: {
      belowMinimumCount: belowMinimum.length,
      overstockCount: overstock.length,
      warehouseReorderCount: warehouseReorder.length,
      recentChangeCount: visibleHistory.length,
      outOfStockCount: belowMinimum.filter((rec) => rec.quantity <= 0).length,
      locationCount: locationInsights.length,
      shrinkageEventCount: shrinkage.totalRecentEvents,
      longStockoutCount: longestStockouts.filter((stockout) => stockout.outOfStockHours >= 48).length,
    },
    recommendations: [...belowMinimum, ...overstock, ...warehouseReorder].slice(0, 100),
    locationInsights,
    lowestStockItems,
    longestStockouts,
    locationStockouts,
    shrinkage,
  };
}

function normalizeInsightText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlapScore(query: string, candidate: string) {
  const queryTokens = new Set(normalizeInsightText(query).split(" ").filter((token) => token.length > 1));
  const candidateTokens = normalizeInsightText(candidate).split(" ").filter((token) => token.length > 1);
  if (queryTokens.size === 0 || candidateTokens.length === 0) return 0;
  return candidateTokens.reduce((score, token) => score + (queryTokens.has(token) ? 1 : 0), 0);
}

function findMentionedStockout(message: string, stockouts: StockoutInsight[]) {
  const ranked = stockouts
    .map((stockout) => ({
      stockout,
      score: tokenOverlapScore(message, `${stockout.itemName} ${stockout.location} ${stockout.category}`),
    }))
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || b.stockout.outOfStockHours - a.stockout.outOfStockHours);
  return ranked[0]?.stockout ?? null;
}

function deterministicAgentReply(message: string, context: HousekeepingContext) {
  const text = message.toLowerCase();
  const recs = context.recommendations;
  const below = recs.filter((rec) => rec.type === "store_restock");
  const overstock = recs.filter((rec) => rec.type === "store_overstock");
  const warehouse = recs.filter((rec) => rec.type === "warehouse_reorder");
  const top = (items: AgentRecommendation[]) => items.slice(0, 5).map((rec) => `- ${rec.message}`).join("\n");
  const topLocations = context.locationInsights.slice(0, 5).map((location) =>
    `- ${location.location}: ${location.totalQuantity} units on hand, ${location.belowMinimumCount} below minimum, ${location.outOfStockCount} out of stock, ${location.deficitUnits} units below minimum.`,
  ).join("\n");
  const topLowestItems = context.lowestStockItems.slice(0, 5).map((item) =>
    `- ${item.itemName} at ${item.location}: ${item.quantity} on hand, range ${item.minQuantity}-${item.maxQuantity}, status ${item.status.replace("_", " ")}.`,
  ).join("\n");
  const topStockouts = context.longestStockouts.slice(0, 5).map((stockout) =>
    `- ${stockout.itemName} at ${stockout.location}: ${stockout.ageLabel}, out since ${stockout.outOfStockSince.slice(0, 10)}, range ${stockout.minQuantity}-${stockout.maxQuantity}, severity ${stockout.severity}.`,
  ).join("\n");
  const stockoutLocations = context.locationStockouts.slice(0, 5).map((location) =>
    `- ${location.location}: ${location.outOfStockCount} out of stock, ${location.criticalStockoutCount} critical, longest ${location.longestOutOfStockLabel}.`,
  ).join("\n");
  const shrinkageReasons = context.shrinkage.byReason.slice(0, 5).map((entry) => `- ${entry.reason}: ${entry.count}`).join("\n");
  const shrinkageLocations = context.shrinkage.byLocation.slice(0, 5).map((entry) => `- ${entry.location}: ${entry.count}`).join("\n");
  const mentionedStockout = findMentionedStockout(message, context.longestStockouts);

  if (mentionedStockout && /how long|since|duration|out of stock|stockout|stock out|zero/.test(text)) {
    return `${mentionedStockout.itemName} at ${mentionedStockout.location} has been out of stock since ${mentionedStockout.outOfStockSince.slice(0, 10)} (${mentionedStockout.ageLabel}). Severity is ${mentionedStockout.severity}. The min/max range is ${mentionedStockout.minQuantity}-${mentionedStockout.maxQuantity}.`;
  }

  if (/out of stock|stockout|stock out|zero stock/.test(text) && /longest|long|how long|duration|since|oldest|48|72|critical/.test(text)) {
    return context.longestStockouts.length
      ? `Longest current stockouts from the read-only snapshot:\n${topStockouts}`
      : "I do not see current out-of-stock items in the read-only snapshot.";
  }

  if (/store|location/.test(text) && /out of stock|stockout|stock out|zero stock/.test(text)) {
    return context.locationStockouts.length
      ? `Location stockout summary:\n${stockoutLocations}`
      : "I do not see current location stockouts in the read-only snapshot.";
  }

  if (/which|what|where|store|location/.test(text) && /lowest|least|low inventory|lowest inventory|weakest/.test(text)) {
    return context.locationInsights.length
      ? `Lowest inventory and highest restock-risk locations from the current snapshot:\n${topLocations}`
      : "I do not see store location inventory in the current read-only snapshot.";
  }

  if (/risk by store|risk by location|location risk|store risk|summarize.*location/.test(text)) {
    return context.locationInsights.length
      ? `Location risk summary:\n${topLocations}`
      : "I do not see location-level risk in the current read-only snapshot.";
  }

  if (/what|which|item|product/.test(text) && /lowest|least|out of stock|zero|low stock/.test(text)) {
    return context.lowestStockItems.length
      ? `Lowest-stock items from the current snapshot:\n${topLowestItems}`
      : "I do not see store item inventory in the current read-only snapshot.";
  }

  if (/shrink|shrinkage|theft|spoilage|damaged|damage|missing|comp|shortage/.test(text)) {
    if (context.shrinkage.totalRecentEvents === 0) {
      return "I do not see recent shrinkage-coded events in the current read-only history snapshot.";
    }
    return [
      `Recent shrinkage-coded events found: ${context.shrinkage.totalRecentEvents}.`,
      shrinkageReasons ? `By reason:\n${shrinkageReasons}` : "",
      shrinkageLocations ? `By location:\n${shrinkageLocations}` : "",
    ].filter(Boolean).join("\n");
  }

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

Location insights:
${JSON.stringify(context.locationInsights.slice(0, 20))}

Lowest-stock items:
${JSON.stringify(context.lowestStockItems.slice(0, 20))}

Current stockout duration insights:
${JSON.stringify(context.longestStockouts.slice(0, 20))}

Location stockout summary:
${JSON.stringify(context.locationStockouts.slice(0, 20))}

Shrinkage insight:
${JSON.stringify(context.shrinkage)}

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
