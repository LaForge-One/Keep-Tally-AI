import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
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

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

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

router.get("/agents/housekeeping", async (req, res) => {
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

  const belowMinimum = storeItems
    .filter((item) => storeStatus(item) === "below_minimum" || storeStatus(item) === "out")
    .map((item) => ({
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

  const overstock = storeItems
    .filter((item) => storeStatus(item) === "overstock")
    .map((item) => ({
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

  const warehouseReorder = warehouseItems
    .filter((item) => item.quantity < item.minPar || (item.reorderPoint > 0 && item.quantity <= item.reorderPoint))
    .map((item) => ({
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

  res.json({
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    summary: {
      belowMinimumCount: belowMinimum.length,
      overstockCount: overstock.length,
      warehouseReorderCount: warehouseReorder.length,
      recentChangeCount: recentHistory.length,
    },
    recommendations: [...belowMinimum, ...overstock, ...warehouseReorder].slice(0, 100),
  });
});

export default router;
