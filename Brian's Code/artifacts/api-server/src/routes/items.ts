import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  historyTable,
  itemsTable,
  locationsTable,
  scanLogTable,
  warehouseItemsTable,
  type ItemRow,
  type LocationRow,
  type PermissionKey,
  type WarehouseItemRow,
} from "@workspace/db";
import {
  CreateItemBody,
  UpdateItemBody,
  GetItemParams,
  UpdateItemParams,
  DeleteItemParams,
} from "@workspace/api-zod";
import { canAccessLocation, canViewAllLocations, requireAccount, requireActiveMembership, requirePermission } from "../middleware/auth";

const router: IRouter = Router();

function serializeItem(row: ItemRow) {
  const minQuantity = row.minQuantity ?? row.parLevel;
  const maxQuantity = row.maxQuantity ?? Math.max(row.parLevel, row.quantity, minQuantity);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    parLevel: row.parLevel,
    minQuantity,
    maxQuantity,
    location: row.location,
    barcode: row.barcode ?? null,
    lastUpdated: row.lastUpdated.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeStockRange(input: {
  quantity?: number;
  parLevel?: number;
  minQuantity?: number;
  maxQuantity?: number;
}): { parLevel: number; minQuantity: number; maxQuantity: number } {
  const minQuantity = Math.max(0, Math.floor(input.minQuantity ?? input.parLevel ?? 0));
  const maxSeed = input.maxQuantity ?? input.parLevel ?? input.quantity ?? minQuantity;
  const maxQuantity = Math.max(minQuantity, Math.floor(maxSeed));
  return {
    parLevel: minQuantity,
    minQuantity,
    maxQuantity,
  };
}

function nextStockRange(
  before: ItemRow,
  input: { quantity?: number; parLevel?: number; minQuantity?: number; maxQuantity?: number },
): Partial<Pick<ItemRow, "parLevel" | "minQuantity" | "maxQuantity">> {
  const nextMin = input.minQuantity ?? input.parLevel ?? before.minQuantity ?? before.parLevel;
  const nextMax = input.maxQuantity ?? before.maxQuantity ?? Math.max(before.parLevel, before.quantity, nextMin);
  const normalized = normalizeStockRange({
    quantity: input.quantity ?? before.quantity,
    minQuantity: nextMin,
    maxQuantity: nextMax,
  });
  return normalized;
}

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
  return Array.from(merged.values()).sort((a, b) => {
    const aItem = a as { name?: unknown };
    const bItem = b as { name?: unknown };
    return String(aItem.name ?? "").localeCompare(String(bItem.name ?? ""));
  });
}

function canAccessLocationId(req: Request, locationId: number | null): boolean {
  if (locationId === null) return false;
  return allowedLocationIds(req).includes(locationId);
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

  if (!canAccessLocationId(req, row.id) && !canAccessLocation(req, row.name)) {
    res.status(403).json({ error: "Permission denied for this location" });
    return null;
  }

  return row;
}

function assertItemLocationAccess(req: Request, res: Response, item: ItemRow): boolean {
  if (canViewAllLocations(req)) return true;
  if (canAccessLocationId(req, item.locationId)) return true;
  if (canAccessLocation(req, item.location)) return true;
  res.status(403).json({ error: "Permission denied for this location" });
  return false;
}

async function findAccountItem(req: Request, id: number): Promise<ItemRow | null> {
  const [row] = await db
    .select()
    .from(itemsTable)
    .where(and(eq(itemsTable.id, id), eq(itemsTable.accountId, req.account!.id)))
    .limit(1);
  return row ?? null;
}

const ADJUSTMENT_REASONS = [
  "spoilage",
  "theft",
  "comp",
  "damage",
  "return_to_warehouse",
  "adjustment",
] as const;

type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
type InventoryType = "store" | "warehouse";

function normalizeBarcode(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function hasPermission(req: Request, key: PermissionKey): boolean {
  const permissions = req.permissions ?? req.authUser?.permissions;
  return Boolean(permissions?.has(key));
}

function normalizeReason(reason: string): AdjustmentReason | null {
  const normalized = reason.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "general_adjustment") return "adjustment";
  if (normalized === "damaged") return "damage";
  return (ADJUSTMENT_REASONS as readonly string[]).includes(normalized) ? normalized as AdjustmentReason : null;
}

function reasonLabel(reason: AdjustmentReason): string {
  switch (reason) {
    case "spoilage": return "Spoilage";
    case "theft": return "Theft";
    case "comp": return "Comp";
    case "damage": return "Damage";
    case "return_to_warehouse": return "Return to warehouse";
    case "adjustment": return "General adjustment";
  }
}

function serializeBarcodeLookupItem(row: ItemRow) {
  return {
    ...serializeItem(row),
    inventoryType: "store" as const,
    locationId: row.locationId,
    image: null,
  };
}

function serializeWarehouseLookupItem(row: WarehouseItemRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    parLevel: row.minPar,
    minQuantity: row.minPar,
    maxQuantity: row.maxPar,
    minPar: row.minPar,
    maxPar: row.maxPar,
    reorderPoint: row.reorderPoint,
    location: "Warehouse",
    locationId: null,
    barcode: row.barcode ?? null,
    inventoryType: "warehouse" as const,
    image: null,
    lastUpdated: row.lastUpdated.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function assertInventoryPermission(req: Request, res: Response, inventoryType: InventoryType): boolean {
  if (inventoryType === "store") {
    if (hasPermission(req, "mark_adjustments")) return true;
    res.status(403).json({ error: "Permission denied: mark_adjustments" });
    return false;
  }

  if (hasPermission(req, "edit_warehouse") && canViewAllLocations(req)) return true;
  res.status(403).json({ error: "Permission denied for warehouse inventory" });
  return false;
}

function nextQuantity(current: number, mode: "set" | "add" | "subtract", value: number): number {
  if (mode === "set") return value;
  if (mode === "add") return current + value;
  return current - value;
}

const inventoryAdjustmentSchema = z.object({
  inventoryType: z.enum(["store", "warehouse"]).default("store"),
  itemId: z.number().int().positive(),
  mode: z.enum(["set", "add", "subtract"]).default("set"),
  quantity: z.number().int().min(0).optional(),
  newQuantity: z.number().int().min(0).optional(),
  quantityDelta: z.number().int().positive().optional(),
  reason: z.string().min(1),
  notes: z.string().optional(),
  barcode: z.string().optional(),
});
router.use(requireAccount, requireActiveMembership);

router.get("/items/barcode/:barcode", async (req, res) => {
  const barcode = normalizeBarcode(req.params.barcode);
  const requestedLocation = String(req.query.location ?? "").trim();
  const inventoryType = String(req.query.inventoryType ?? "store").trim().toLowerCase();

  if (!barcode) {
    res.status(400).json({ error: "barcode is required" });
    return;
  }

  const wantsStore = inventoryType === "store" || inventoryType === "all";
  const wantsWarehouse = inventoryType === "warehouse" || inventoryType === "all";

  if (!wantsStore && !wantsWarehouse) {
    res.status(400).json({ error: "Invalid inventoryType" });
    return;
  }

  if (wantsStore) {
    let resolvedLocation: LocationRow | null = null;
    if (requestedLocation) {
      resolvedLocation = await resolveLocationByName(req, res, requestedLocation);
      if (!resolvedLocation) return;
    }

    const rows = await db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.accountId, req.account!.id))
      .orderBy(itemsTable.name);

    const matchedStoreItem = rows.find((item) => {
      if (normalizeBarcode(item.barcode) !== barcode) return false;
      if (resolvedLocation) {
        return item.locationId === resolvedLocation.id || item.location === resolvedLocation.name;
      }
      if (canViewAllLocations(req)) return true;
      if (item.locationId !== null && allowedLocationIds(req).includes(item.locationId)) return true;
      return canAccessLocation(req, item.location);
    });

    if (matchedStoreItem) {
      res.json({ found: true, inventoryType: "store", item: serializeBarcodeLookupItem(matchedStoreItem) });
      return;
    }
  }

  if (wantsWarehouse) {
    if (!hasPermission(req, "view_warehouse") || !canViewAllLocations(req)) {
      res.status(wantsStore ? 404 : 403).json(
        wantsStore ? { found: false, item: null } : { error: "Permission denied for warehouse inventory" },
      );
      return;
    }

    const rows = await db
      .select()
      .from(warehouseItemsTable)
      .where(eq(warehouseItemsTable.accountId, req.account!.id))
      .orderBy(warehouseItemsTable.name);
    const matchedWarehouseItem = rows.find((item) => normalizeBarcode(item.barcode) === barcode);
    if (matchedWarehouseItem) {
      res.json({ found: true, inventoryType: "warehouse", item: serializeWarehouseLookupItem(matchedWarehouseItem) });
      return;
    }
  }

  res.status(404).json({ found: false, item: null });
});

router.post("/inventory/adjustments", async (req, res) => {
  const parsed = inventoryAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const reason = normalizeReason(data.reason);
  if (!reason) {
    res.status(400).json({ error: "reason must be one of spoilage, theft, comp, damage, return_to_warehouse, adjustment" });
    return;
  }

  if (!assertInventoryPermission(req, res, data.inventoryType)) return;

  const changeValue = data.mode === "set" ? data.newQuantity ?? data.quantity : data.quantityDelta ?? data.quantity;
  if (changeValue === undefined) {
    res.status(400).json({ error: data.mode === "set" ? "newQuantity is required" : "quantityDelta is required" });
    return;
  }

  if (data.inventoryType === "store") {
    const before = await findAccountItem(req, data.itemId);
    if (!before) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    if (!assertItemLocationAccess(req, res, before)) return;

    const newQty = nextQuantity(before.quantity, data.mode, changeValue);
    if (newQty < 0) {
      res.status(400).json({ error: "Quantity cannot go below 0" });
      return;
    }

    const [updated] = await db
      .update(itemsTable)
      .set({ quantity: newQty, lastUpdated: new Date() })
      .where(and(eq(itemsTable.id, before.id), eq(itemsTable.accountId, req.account!.id)))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Failed to update item" });
      return;
    }

    const delta = newQty - before.quantity;
    const noteParts = [`Reason: ${reasonLabel(reason)}`, `Delta: ${delta}`];
    if (data.barcode ?? updated.barcode) noteParts.push(`Barcode: ${data.barcode ?? updated.barcode}`);
    if (data.notes) noteParts.push(`Notes: ${data.notes}`);

    await db.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: updated.locationId,
      itemId: updated.id,
      itemName: updated.name,
      action: "inventory_adjustment",
      field: "quantity",
      previousValue: String(before.quantity),
      newValue: String(newQty),
      note: noteParts.join("; "),
      source: "scan",
      performedBy: req.authUser?.displayName ?? req.authUser?.username ?? null,
      performedByRole: req.authUser?.role ?? null,
      location: updated.location,
    });

    await db.insert(scanLogTable).values({
      accountId: req.account!.id,
      locationId: updated.locationId,
      barcode: data.barcode ?? updated.barcode ?? "",
      itemId: updated.id,
      itemName: updated.name,
      location: updated.location,
      action: "inventory_adjustment",
      qtyChange: delta,
      reason,
      notes: data.notes,
      operator: req.authUser?.displayName ?? req.authUser?.username,
    });

    res.json({ item: serializeItem(updated), previousQty: before.quantity, newQty, quantityDelta: delta, reason });
    return;
  }

  const [before] = await db
    .select()
    .from(warehouseItemsTable)
    .where(and(eq(warehouseItemsTable.id, data.itemId), eq(warehouseItemsTable.accountId, req.account!.id)))
    .limit(1);

  if (!before) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const newQty = nextQuantity(before.quantity, data.mode, changeValue);
  if (newQty < 0) {
    res.status(400).json({ error: "Quantity cannot go below 0" });
    return;
  }

  const [updated] = await db
    .update(warehouseItemsTable)
    .set({ quantity: newQty, lastUpdated: new Date() })
    .where(and(eq(warehouseItemsTable.id, before.id), eq(warehouseItemsTable.accountId, req.account!.id)))
    .returning();

  if (!updated) {
    res.status(500).json({ error: "Failed to update warehouse item" });
    return;
  }

  const delta = newQty - before.quantity;
  const noteParts = ["Warehouse adjustment", `Reason: ${reasonLabel(reason)}`, `Delta: ${delta}`];
  if (data.barcode ?? updated.barcode) noteParts.push(`Barcode: ${data.barcode ?? updated.barcode}`);
  if (data.notes) noteParts.push(`Notes: ${data.notes}`);

  await db.insert(historyTable).values({
    accountId: req.account!.id,
    locationId: null,
    itemId: updated.id,
    itemName: updated.name,
    action: "inventory_adjustment",
    field: "quantity",
    previousValue: String(before.quantity),
    newValue: String(newQty),
    note: noteParts.join("; "),
    source: "warehouse",
    performedBy: req.authUser?.displayName ?? req.authUser?.username ?? null,
    performedByRole: req.authUser?.role ?? null,
    location: "Warehouse",
  });

  await db.insert(scanLogTable).values({
    accountId: req.account!.id,
    locationId: null,
    barcode: data.barcode ?? updated.barcode ?? "",
    itemId: updated.id,
    itemName: updated.name,
    location: "Warehouse",
    action: "inventory_adjustment",
    qtyChange: delta,
    reason,
    notes: data.notes,
    operator: req.authUser?.displayName ?? req.authUser?.username,
  });

  res.json({ item: serializeWarehouseLookupItem(updated), previousQty: before.quantity, newQty, quantityDelta: delta, reason });
});
router.get("/items", async (req, res) => {
  const location = req.query.location as string | undefined;

  if (location) {
    const resolvedLocation = await resolveLocationByName(req, res, location);
    if (!resolvedLocation) return;

    const rows = await db
      .select()
      .from(itemsTable)
      .where(
        and(
          eq(itemsTable.accountId, req.account!.id),
          or(
            eq(itemsTable.locationId, resolvedLocation.id),
            eq(itemsTable.location, resolvedLocation.name),
          ),
        ),
      )
      .orderBy(itemsTable.name);
    res.json(rows.map(serializeItem));
    return;
  }

  const permittedLocationIds = allowedLocationIds(req);
  const legacyLocations = assignedLocations(req);
  if (!canViewAllLocations(req) && permittedLocationIds.length === 0 && legacyLocations.length === 0) {
    res.json([]);
    return;
  }

  const rows = canViewAllLocations(req)
    ? await db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.accountId, req.account!.id))
        .orderBy(itemsTable.name)
    : mergeById([
        permittedLocationIds.length > 0
          ? await db
              .select()
              .from(itemsTable)
              .where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.locationId, permittedLocationIds)))
              .orderBy(itemsTable.name)
          : [],
        legacyLocations.length > 0
          ? await db
              .select()
              .from(itemsTable)
              .where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.location, legacyLocations)))
              .orderBy(itemsTable.name)
          : [],
      ]);

  res.json(rows.map(serializeItem));
});

router.post("/items", requirePermission("edit_store_inventory"), async (req, res) => {
  const parsed = CreateItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const resolvedLocation = await resolveLocationByName(req, res, parsed.data.location);
  if (!resolvedLocation) return;

  const stockRange = normalizeStockRange(parsed.data);
  const [created] = await db
    .insert(itemsTable)
    .values({
      accountId: req.account!.id,
      locationId: resolvedLocation.id,
      name: parsed.data.name,
      category: parsed.data.category,
      quantity: parsed.data.quantity,
      ...stockRange,
      location: resolvedLocation.name,
      barcode: parsed.data.barcode ?? null,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Failed to create item" });
    return;
  }
  await db.insert(historyTable).values({
    accountId: req.account!.id,
    locationId: resolvedLocation.id,
    itemId: created.id,
    itemName: created.name,
    action: "create",
    field: null,
    previousValue: null,
    newValue: `${created.quantity} @ ${created.location}`,
    note: null,
    source: "ui",
  });
  res.status(201).json(serializeItem(created));
});

router.get("/items/:id", async (req, res) => {
  const params = GetItemParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const row = await findAccountItem(req, params.data.id);
  if (!row) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!assertItemLocationAccess(req, res, row)) return;
  res.json(serializeItem(row));
});

router.patch("/items/:id", requirePermission("edit_store_inventory"), async (req, res) => {
  const params = UpdateItemParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const before = await findAccountItem(req, params.data.id);
  if (!before) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!assertItemLocationAccess(req, res, before)) return;

  let newLocation: LocationRow | null = null;
  if (body.data.location !== undefined && body.data.location !== before.location) {
    newLocation = await resolveLocationByName(req, res, body.data.location);
    if (!newLocation) return;
  }

  const updates: Partial<typeof itemsTable.$inferInsert> = {
    lastUpdated: new Date(),
  };
  const changes: Array<{ field: string; from: string; to: string }> = [];
  if (body.data.name !== undefined && body.data.name !== before.name) {
    updates.name = body.data.name;
    changes.push({ field: "name", from: before.name, to: body.data.name });
  }
  if (
    body.data.category !== undefined &&
    body.data.category !== before.category
  ) {
    updates.category = body.data.category;
    changes.push({
      field: "category",
      from: before.category,
      to: body.data.category,
    });
  }
  if (
    body.data.quantity !== undefined &&
    body.data.quantity !== before.quantity
  ) {
    updates.quantity = body.data.quantity;
    changes.push({
      field: "quantity",
      from: String(before.quantity),
      to: String(body.data.quantity),
    });
  }
  if (
    body.data.parLevel !== undefined ||
    body.data.minQuantity !== undefined ||
    body.data.maxQuantity !== undefined
  ) {
    const stockRange = nextStockRange(before, body.data);
    if (stockRange.minQuantity !== before.minQuantity) {
      updates.minQuantity = stockRange.minQuantity;
      changes.push({
        field: "minQuantity",
        from: String(before.minQuantity),
        to: String(stockRange.minQuantity),
      });
    }
    if (stockRange.maxQuantity !== before.maxQuantity) {
      updates.maxQuantity = stockRange.maxQuantity;
      changes.push({
        field: "maxQuantity",
        from: String(before.maxQuantity),
        to: String(stockRange.maxQuantity),
      });
    }
    if (stockRange.parLevel !== before.parLevel) {
      updates.parLevel = stockRange.parLevel;
      changes.push({
        field: "parLevel",
        from: String(before.parLevel),
        to: String(stockRange.parLevel),
      });
    }
  }
  if (newLocation) {
    updates.location = newLocation.name;
    updates.locationId = newLocation.id;
    changes.push({
      field: "location",
      from: before.location,
      to: newLocation.name,
    });
  }
  if (body.data.barcode !== undefined && body.data.barcode !== before.barcode) {
    updates.barcode = body.data.barcode ?? null;
    changes.push({
      field: "barcode",
      from: before.barcode ?? "(none)",
      to: body.data.barcode ?? "(none)",
    });
  }

  const [updated] = await db
    .update(itemsTable)
    .set(updates)
    .where(and(eq(itemsTable.id, before.id), eq(itemsTable.accountId, req.account!.id)))
    .returning();
  if (!updated) {
    res.status(500).json({ error: "Failed to update item" });
    return;
  }

  if (changes.length > 0) {
    await db.insert(historyTable).values(
      changes.map((c) => ({
        accountId: req.account!.id,
        locationId: updated.locationId,
        itemId: updated.id,
        itemName: updated.name,
        action: "update",
        field: c.field,
        previousValue: c.from,
        newValue: c.to,
        note: null,
        source: "ui",
      })),
    );
  }
  res.json(serializeItem(updated));
});

router.post("/items/:id/adjust", requirePermission("mark_adjustments"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { quantity, adjustmentType, verified } = req.body as {
    quantity: number;
    adjustmentType: string;
    verified: boolean;
  };

  if (typeof quantity !== "number" || !adjustmentType) {
    res.status(400).json({ error: "quantity and adjustmentType are required" });
    return;
  }

  const before = await findAccountItem(req, id);
  if (!before) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!assertItemLocationAccess(req, res, before)) return;

  const [updated] = await db
    .update(itemsTable)
    .set({ quantity, lastUpdated: new Date() })
    .where(and(eq(itemsTable.id, id), eq(itemsTable.accountId, req.account!.id)))
    .returning();
  if (!updated) {
    res.status(500).json({ error: "Failed to update item" });
    return;
  }

  await db.insert(historyTable).values({
    accountId: req.account!.id,
    locationId: updated.locationId,
    itemId: updated.id,
    itemName: updated.name,
    action: "adjust",
    field: "quantity",
    previousValue: String(before.quantity),
    newValue: String(quantity),
    note: `${adjustmentType}${verified ? " (verified)" : ""}`,
    source: "api",
    performedBy: req.authUser?.displayName ?? null,
    performedByRole: req.authUser?.role ?? null,
  });

  res.json(serializeItem(updated));
});

router.post("/items/:id/verify", requirePermission("use_voice_mode"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const item = await findAccountItem(req, id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!assertItemLocationAccess(req, res, item)) return;

  await db.insert(historyTable).values({
    accountId: req.account!.id,
    locationId: item.locationId,
    itemId: item.id,
    itemName: item.name,
    action: "voice-verify",
    field: "quantity",
    previousValue: String(item.quantity),
    newValue: String(item.quantity),
    note: `Voice Count - verified ${item.quantity} at ${item.location}; range ${item.minQuantity}-${item.maxQuantity}`,
    source: "voice",
    performedBy: req.authUser?.displayName ?? null,
    performedByRole: req.authUser?.role ?? null,
  });

  res.status(204).end();
});

router.delete("/items/:id", requirePermission("delete_items"), async (req, res) => {
  const params = DeleteItemParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const before = await findAccountItem(req, params.data.id);
  if (!before) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!assertItemLocationAccess(req, res, before)) return;
  await db.delete(itemsTable).where(and(eq(itemsTable.id, before.id), eq(itemsTable.accountId, req.account!.id)));
  await db.insert(historyTable).values({
    accountId: req.account!.id,
    locationId: before.locationId,
    itemId: null,
    itemName: before.name,
    action: "delete",
    field: null,
    previousValue: `${before.quantity} @ ${before.location}`,
    newValue: null,
    note: null,
    source: "ui",
  });
  res.status(204).end();
});

export default router;
export { serializeItem };
