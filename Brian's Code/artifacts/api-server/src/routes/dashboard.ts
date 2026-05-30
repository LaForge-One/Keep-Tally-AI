import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  itemsTable,
  historyTable,
  warehouseItemsTable,
  locationsTable,
  type HistoryRow,
  type ItemRow,
  type LocationRow,
} from "@workspace/db";
import { serializeItem } from "./items.js";
import { canViewAllLocations, requireAccount, requireActiveMembership } from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

function allowedLocationIds(req: Request): number[] {
  return req.allowedLocationIds ?? [];
}

function assignedLocations(req: Request): string[] {
  return req.authUser?.assignedLocations ?? [];
}

function mergeById<T extends { id: number }>(rows: T[][]): T[] {
  const merged = new Map<number, T>();
  for (const group of rows) {
    for (const row of group) merged.set(row.id, row);
  }
  return Array.from(merged.values());
}

async function resolveLocationByName(
  req: Request,
  res: Response,
  location: string,
): Promise<LocationRow | null> {
  const [row] = await db
    .select()
    .from(locationsTable)
    .where(and(eq(locationsTable.accountId, req.account!.id), eq(locationsTable.name, location)))
    .limit(1);

  if (!row || row.status !== "active") {
    res.status(400).json({ error: "Invalid location" });
    return null;
  }

  if (!canViewAllLocations(req) && !allowedLocationIds(req).includes(row.id) && !assignedLocations(req).includes(row.name)) {
    res.status(403).json({ error: "Permission denied for this location" });
    return null;
  }

  return row;
}

async function getDashboardItems(req: Request, res: Response, requestedLocation?: string): Promise<ItemRow[] | null> {
  if (requestedLocation) {
    const location = await resolveLocationByName(req, res, requestedLocation);
    if (!location) return null;

    const byLocationId = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.accountId, req.account!.id), eq(itemsTable.locationId, location.id)))
      .orderBy(asc(itemsTable.name));
    const byLegacyLocation = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.accountId, req.account!.id), eq(itemsTable.location, location.name)))
      .orderBy(asc(itemsTable.name));
    return mergeById([byLocationId, byLegacyLocation]).sort((a, b) => a.name.localeCompare(b.name));
  }

  if (canViewAllLocations(req)) {
    return db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.accountId, req.account!.id))
      .orderBy(asc(itemsTable.name));
  }

  const locationIds = allowedLocationIds(req);
  const legacyLocations = assignedLocations(req);
  if (locationIds.length === 0 && legacyLocations.length === 0) return [];

  const byLocationId = locationIds.length > 0
    ? await db
        .select()
        .from(itemsTable)
        .where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.locationId, locationIds)))
        .orderBy(asc(itemsTable.name))
    : [];
  const byLegacyLocation = legacyLocations.length > 0
    ? await db
        .select()
        .from(itemsTable)
        .where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.location, legacyLocations)))
        .orderBy(asc(itemsTable.name))
    : [];

  return mergeById([byLocationId, byLegacyLocation]).sort((a, b) => a.name.localeCompare(b.name));
}

async function getDashboardHistory(
  req: Request,
  res: Response,
  source: "voice" | "command" | undefined,
  limit: number,
  requestedLocation?: string,
): Promise<HistoryRow[] | null> {
  const accountFilter = eq(historyTable.accountId, req.account!.id);
  const baseFilter = source ? and(accountFilter, eq(historyTable.source, source)) : accountFilter;

  if (requestedLocation) {
    const location = await resolveLocationByName(req, res, requestedLocation);
    if (!location) return null;

    const byLocationId = await db
      .select()
      .from(historyTable)
      .where(and(baseFilter, eq(historyTable.locationId, location.id)))
      .orderBy(desc(historyTable.createdAt))
      .limit(limit);
    const byLegacyLocation = await db
      .select()
      .from(historyTable)
      .where(and(baseFilter, eq(historyTable.location, location.name)))
      .orderBy(desc(historyTable.createdAt))
      .limit(limit);
    return mergeById([byLocationId, byLegacyLocation])
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  if (canViewAllLocations(req)) {
    return db
      .select()
      .from(historyTable)
      .where(baseFilter)
      .orderBy(desc(historyTable.createdAt))
      .limit(limit);
  }

  const locationIds = allowedLocationIds(req);
  const legacyLocations = assignedLocations(req);
  if (locationIds.length === 0 && legacyLocations.length === 0) return [];

  const byLocationId = locationIds.length > 0
    ? await db
        .select()
        .from(historyTable)
        .where(and(baseFilter, inArray(historyTable.locationId, locationIds)))
        .orderBy(desc(historyTable.createdAt))
        .limit(limit)
    : [];
  const byLegacyLocation = legacyLocations.length > 0
    ? await db
        .select()
        .from(historyTable)
        .where(and(baseFilter, inArray(historyTable.location, legacyLocations)))
        .orderBy(desc(historyTable.createdAt))
        .limit(limit)
    : [];

  return mergeById([byLocationId, byLegacyLocation])
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

router.get("/dashboard/summary", async (req, res) => {
  const location = req.query.location as string | undefined;
  const items = await getDashboardItems(req, res, location);
  if (!items) return;

  const recent = await getDashboardHistory(req, res, undefined, 15, location);
  if (!recent) return;

  const belowParRows = items.filter((i) => i.quantity < i.parLevel);

  const totalItems = items.length;
  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
  const belowParCount = belowParRows.length;
  const outOfStockCount = items.filter((i) => i.quantity === 0).length;
  const locations = new Set(items.map((i) => i.location));
  const categories = new Set(items.map((i) => i.category));

  const byCategoryMap = new Map<string, { itemCount: number; totalUnits: number }>();
  for (const item of items) {
    const cur = byCategoryMap.get(item.category) ?? { itemCount: 0, totalUnits: 0 };
    cur.itemCount += 1;
    cur.totalUnits += item.quantity;
    byCategoryMap.set(item.category, cur);
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.totalUnits - a.totalUnits);

  const byLocationMap = new Map<string, { itemCount: number; totalUnits: number }>();
  for (const item of items) {
    const cur = byLocationMap.get(item.location) ?? { itemCount: 0, totalUnits: 0 };
    cur.itemCount += 1;
    cur.totalUnits += item.quantity;
    byLocationMap.set(item.location, cur);
  }
  const byLocation = Array.from(byLocationMap.entries())
    .map(([location, v]) => ({ location, ...v }))
    .sort((a, b) => b.totalUnits - a.totalUnits);

  res.json({
    totalItems,
    totalUnits,
    belowParCount,
    outOfStockCount,
    locationsCount: locations.size,
    categoriesCount: categories.size,
    belowPar: belowParRows
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 10)
      .map(serializeItem),
    recentChanges: recent.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      action: row.action,
      field: row.field,
      previousValue: row.previousValue,
      newValue: row.newValue,
      note: row.note,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    })),
    byCategory,
    byLocation,
  });
});

/* ── GET /dashboard/voice — voice-first dashboard data ── */
router.get("/dashboard/voice", async (req, res) => {
  const location = req.query.location as string | undefined;
  const items = await getDashboardItems(req, res, location);
  if (!items) return;

  // Fetch warehouse items for cost data
  const warehouseItems = await db
    .select()
    .from(warehouseItemsTable)
    .where(eq(warehouseItemsTable.accountId, req.account!.id));

  // Build lookup maps for cost: by barcode, then by name (lowercase)
  const whByBarcode = new Map<string, number>();
  const whByName    = new Map<string, number>();
  for (const w of warehouseItems) {
    if (w.barcode) whByBarcode.set(w.barcode, w.costPerUnit ?? 0);
    whByName.set(w.name.toLowerCase(), w.costPerUnit ?? 0);
  }

  function getCost(item: ItemRow): number {
    if (item.barcode && whByBarcode.has(item.barcode)) return whByBarcode.get(item.barcode)!;
    return whByName.get(item.name.toLowerCase()) ?? 0;
  }

  // Below par items
  const belowParItems = items
    .filter((i) => i.quantity < i.parLevel)
    .sort((a, b) => {
      // out of stock first, then by missing qty descending
      const aMissing = a.parLevel - a.quantity;
      const bMissing = b.parLevel - b.quantity;
      if (a.quantity === 0 && b.quantity !== 0) return -1;
      if (b.quantity === 0 && a.quantity !== 0) return 1;
      return bMissing - aMissing;
    })
    .slice(0, 8)
    .map((i) => {
      const missing = i.parLevel - i.quantity;
      const cost = getCost(i);
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        location: i.location,
        quantity: i.quantity,
        parLevel: i.parLevel,
        missing,
        missingValue: missing * cost,
        status: i.quantity === 0 ? "out" : missing >= i.parLevel * 0.7 ? "critical" : "low",
      };
    });

  // Total missing value across ALL below-par items
  const allBelowPar = items.filter((i) => i.quantity < i.parLevel);
  const missingValue = allBelowPar.reduce((sum, i) => {
    return sum + (i.parLevel - i.quantity) * getCost(i);
  }, 0);

  const belowParCount  = allBelowPar.length;
  const outOfStockCount = items.filter((i) => i.quantity === 0).length;

  // Recent "sessions" from history — group voice/command activity by date + performer
  const voiceHistory = await getDashboardHistory(req, res, "voice", 100, location);
  if (!voiceHistory) return;

  // Also fetch command history to supplement
  const commandHistory = await getDashboardHistory(req, res, "command", 100, location);
  if (!commandHistory) return;

  // Group into sessions by date + performer
  const allVoice = [...voiceHistory, ...commandHistory].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  const sessionMap = new Map<string, {
    date: string;
    performedBy: string;
    location: string;
    itemCount: number;
    missingValue: number;
  }>();

  for (const entry of allVoice) {
    const dateKey = entry.createdAt.toISOString().slice(0, 10);
    const performer = entry.performedBy ?? "Unknown";
    const loc = entry.location ?? "Unknown";
    const key = `${dateKey}__${performer}__${loc}`;
    const cur = sessionMap.get(key) ?? { date: entry.createdAt.toISOString(), performedBy: performer, location: loc, itemCount: 0, missingValue: 0 };
    cur.itemCount += 1;
    sessionMap.set(key, cur);
  }

  const recentSessions = Array.from(sessionMap.values())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Last voice activity date (for "last count X days ago")
  const lastCountAt = voiceHistory.length > 0 ? voiceHistory[0]!.createdAt.toISOString() : null;

  res.json({
    missingValue,
    belowParCount,
    outOfStockCount,
    belowParItems,
    recentSessions,
    lastCountAt,
  });
});

export default router;
