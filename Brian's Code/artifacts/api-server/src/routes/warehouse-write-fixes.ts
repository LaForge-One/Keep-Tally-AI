import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  historyTable,
  itemsTable,
  locationsTable,
  warehouseItemsTable,
  warehousePurchasesTable,
  warehouseTransfersTable,
  warehousesTable,
  type LocationRow,
} from "@workspace/db";
import {
  assertLocationAccess,
  canViewAllLocations,
  requireAccount,
  requireActiveMembership,
  requirePermission,
} from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

function parseParamId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string") return null;
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

function itemStatus(qty: number, minPar: number, maxPar: number, reorderPoint: number) {
  if (qty <= 0) return "out";
  if (qty < minPar) return "low";
  if (reorderPoint > 0 && qty <= reorderPoint && qty >= minPar) return "reorder";
  if (maxPar > 0 && qty > maxPar) return "overstock";
  return "ok";
}

function serializeItem(row: typeof warehouseItemsTable.$inferSelect) {
  return {
    ...row,
    status: itemStatus(row.quantity, row.minPar, row.maxPar, row.reorderPoint),
  };
}

function assertGlobalWarehouseAccess(req: Request, res: Response): boolean {
  if (canViewAllLocations(req)) return true;
  res.status(403).json({ error: "Permission denied for warehouse inventory" });
  return false;
}

function warehouseSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "warehouse";
}

async function ensureWarehouseLocation(accountId: number): Promise<LocationRow> {
  const name = "Main Warehouse";
  const slug = warehouseSlug(name);

  const [existingBySlug] = await db
    .select()
    .from(locationsTable)
    .where(and(eq(locationsTable.accountId, accountId), eq(locationsTable.slug, slug)))
    .limit(1);
  if (existingBySlug) return existingBySlug;

  const [existingByName] = await db
    .select()
    .from(locationsTable)
    .where(and(eq(locationsTable.accountId, accountId), eq(locationsTable.name, name)))
    .limit(1);
  if (existingByName) return existingByName;

  const [created] = await db
    .insert(locationsTable)
    .values({ accountId, name, slug, status: "active" })
    .returning();
  if (!created) throw new Error("Failed to create default warehouse location");
  return created;
}

async function ensureDefaultWarehouse(accountId: number) {
  const [activeWarehouse] = await db
    .select()
    .from(warehousesTable)
    .where(and(eq(warehousesTable.accountId, accountId), eq(warehousesTable.status, "active")))
    .orderBy(asc(warehousesTable.id))
    .limit(1);
  if (activeWarehouse) return activeWarehouse;

  const name = "Main Warehouse";
  const slug = warehouseSlug(name);
  const location = await ensureWarehouseLocation(accountId);

  const [existingBySlug] = await db
    .select()
    .from(warehousesTable)
    .where(and(eq(warehousesTable.accountId, accountId), eq(warehousesTable.slug, slug)))
    .limit(1);
  if (existingBySlug) {
    const [updated] = await db
      .update(warehousesTable)
      .set({
        locationId: existingBySlug.locationId ?? location.id,
        status: "active",
        updatedAt: new Date(),
      })
      .where(and(eq(warehousesTable.accountId, accountId), eq(warehousesTable.id, existingBySlug.id)))
      .returning();
    return updated ?? existingBySlug;
  }

  const [created] = await db
    .insert(warehousesTable)
    .values({ accountId, locationId: location.id, name, slug, status: "active" })
    .returning();
  if (!created) throw new Error("Failed to create default warehouse");
  return created;
}

async function resolveStoreLocation(
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

  if (!assertLocationAccess(req, res, row.name)) return null;
  return row;
}

async function recordWarehouseQuantityHistory({
  req,
  item,
  previousQuantity,
  newQuantity,
  reason,
}: {
  req: Request;
  item: typeof warehouseItemsTable.$inferSelect;
  previousQuantity: number;
  newQuantity: number;
  reason: string;
}) {
  if (previousQuantity === newQuantity) return;

  await db.insert(historyTable).values({
    accountId: req.account!.id,
    locationId: null,
    itemId: item.id,
    itemName: item.name,
    action: "warehouse_quantity_adjusted",
    field: "quantity",
    previousValue: String(previousQuantity),
    newValue: String(newQuantity),
    note: reason,
    source: "warehouse",
    performedBy: req.authUser?.username,
    performedByRole: req.membership?.role ?? req.authUser?.role,
    location: "Warehouse",
  });
}

function nonNegativeIntegerSchema(defaultValue: number) {
  return z.preprocess((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    return Math.max(0, Math.trunc(value));
  }, z.number().int().min(0).default(defaultValue));
}

function optionalNonNegativeNumberSchema() {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    return Math.max(0, value);
  }, z.number().min(0).optional().nullable());
}

const createSchema = z.object({
  name: z.string().min(1),
  barcode: z.string().optional(),
  category: z.string().default("Uncategorized"),
  quantity: z.number().int().min(0).default(0),
  minPar: z.number().int().min(0).default(0),
  maxPar: z.number().int().min(0).default(0),
  reorderPoint: z.number().int().min(0).default(0),
  caseCost: z.number().min(0).optional(),
  unitsPerCase: z.number().int().min(1).default(1),
  costPerUnit: z.number().min(0).optional(),
  lastPurchaseDate: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  barcode: z.string().optional().nullable(),
  category: z.string().optional(),
  quantity: z.number().int().min(0).optional(),
  minPar: z.number().int().min(0).optional(),
  maxPar: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  caseCost: z.number().min(0).optional().nullable(),
  unitsPerCase: z.number().int().min(1).optional(),
  costPerUnit: z.number().min(0).optional().nullable(),
});

const importApplySchema = z.object({
  items: z.array(z.object({
    name: z.string().min(1),
    barcode: z.string().optional().nullable(),
    category: z.string().default("Uncategorized"),
    quantity: nonNegativeIntegerSchema(0),
    minPar: nonNegativeIntegerSchema(0),
    maxPar: nonNegativeIntegerSchema(0),
    reorderPoint: nonNegativeIntegerSchema(0),
    caseCost: optionalNonNegativeNumberSchema(),
    unitsPerCase: nonNegativeIntegerSchema(1).transform((value) => Math.max(1, value)),
    costPerUnit: optionalNonNegativeNumberSchema(),
  })),
  mode: z.enum(["insert", "upsert"]).default("upsert"),
});

router.post("/warehouse/import/apply", requirePermission("edit_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const parsed = importApplySchema.safeParse(req.body);
  if (!parsed.success) {
    const validation = parsed.error.flatten();
    req.log.warn(
      {
        validation: {
          formErrors: validation.formErrors,
          fieldErrors: validation.fieldErrors,
        },
        bodyKeys: typeof req.body === "object" && req.body !== null ? Object.keys(req.body) : [],
        itemCount: Array.isArray(req.body?.items) ? req.body.items.length : null,
        firstItem: Array.isArray(req.body?.items) ? req.body.items[0] : null,
      },
      "Warehouse import apply validation failed",
    );
    res.status(400).json({
      error: validation,
      ...(process.env.NODE_ENV !== "production" ? { validation } : {}),
    });
    return;
  }

  const { items, mode } = parsed.data;
  try {
    const warehouse = await ensureDefaultWarehouse(req.account!.id);
    let inserted = 0;
    let updated = 0;

    for (const item of items) {
      const costPerUnit = item.costPerUnit ?? (item.caseCost && item.unitsPerCase ? item.caseCost / item.unitsPerCase : undefined) ?? undefined;

      if (mode === "upsert" && item.barcode) {
        const existing = await db
          .select()
          .from(warehouseItemsTable)
          .where(and(eq(warehouseItemsTable.accountId, req.account!.id), eq(warehouseItemsTable.barcode, item.barcode)))
          .limit(1);

        if (existing.length > 0) {
          const existingItem = existing[0]!;
          await db.update(warehouseItemsTable)
            .set({
              ...item,
              warehouseId: existingItem.warehouseId ?? warehouse.id,
              costPerUnit,
              barcode: item.barcode ?? undefined,
              lastUpdated: new Date(),
            })
            .where(and(eq(warehouseItemsTable.id, existingItem.id), eq(warehouseItemsTable.accountId, req.account!.id)));
          await recordWarehouseQuantityHistory({
            req,
            item: existingItem,
            previousQuantity: existingItem.quantity,
            newQuantity: item.quantity,
            reason: "Warehouse CSV import",
          });
          updated++;
          continue;
        }
      }

      await db.insert(warehouseItemsTable).values({
        ...item,
        accountId: req.account!.id,
        warehouseId: warehouse.id,
        costPerUnit,
        barcode: item.barcode ?? undefined,
      });
      inserted++;
    }

    res.json({ inserted, updated, total: items.length });
  } catch (err) {
    req.log.error(
      { err, accountId: req.account!.id, mode, itemCount: items.length },
      "Warehouse import apply failed",
    );
    res.status(500).json({
      error: "Import failed",
      ...(process.env.NODE_ENV !== "production" && err instanceof Error ? { message: err.message } : {}),
    });
  }
});

router.post("/warehouse", requirePermission("edit_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const data = parsed.data;
  const warehouse = await ensureDefaultWarehouse(req.account!.id);
  const costPerUnit = data.costPerUnit ?? (data.caseCost && data.unitsPerCase ? data.caseCost / data.unitsPerCase : undefined);

  const [inserted] = await db.insert(warehouseItemsTable).values({
    ...data,
    accountId: req.account!.id,
    warehouseId: warehouse.id,
    costPerUnit,
    lastPurchaseDate: data.lastPurchaseDate ?? undefined,
  }).returning();

  res.status(201).json(serializeItem(inserted!));
});

router.put("/warehouse/:id", requirePermission("edit_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const id = parseParamId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [existing] = await db
    .select()
    .from(warehouseItemsTable)
    .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db
    .update(warehouseItemsTable)
    .set({ ...parsed.data, lastUpdated: new Date() })
    .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  if (parsed.data.quantity !== undefined) {
    await recordWarehouseQuantityHistory({
      req,
      item: existing,
      previousQuantity: existing.quantity,
      newQuantity: parsed.data.quantity,
      reason: "Manual warehouse quantity set",
    });
  }

  res.json(serializeItem(updated));
});

router.post("/warehouse/:id/adjust", requirePermission("edit_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const id = parseParamId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const schema = z.object({
    mode: z.enum(["set", "add", "subtract"]),
    quantity: z.number().int().min(0),
    reason: z.string().trim().min(1).default("Manual warehouse quantity adjustment"),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [item] = await db
    .select()
    .from(warehouseItemsTable)
    .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)))
    .limit(1);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const { mode, quantity, reason } = parsed.data;
  if (mode === "subtract" && item.quantity < quantity) {
    res.status(400).json({ error: `Only ${item.quantity} units available in warehouse` });
    return;
  }

  const [updated] = await db
    .update(warehouseItemsTable)
    .set({
      quantity:
        mode === "set"
          ? quantity
          : mode === "add"
            ? sql`${warehouseItemsTable.quantity} + ${quantity}`
            : sql`${warehouseItemsTable.quantity} - ${quantity}`,
      lastUpdated: new Date(),
    })
    .where(
      and(
        eq(warehouseItemsTable.id, id),
        eq(warehouseItemsTable.accountId, req.account!.id),
        mode === "subtract" ? sql`${warehouseItemsTable.quantity} >= ${quantity}` : undefined,
      ),
    )
    .returning();

  if (!updated) {
    res.status(mode === "subtract" ? 409 : 404).json({
      error: mode === "subtract"
        ? "Warehouse quantity changed before this adjustment could be saved. Reload and try again."
        : "Not found",
    });
    return;
  }
  await recordWarehouseQuantityHistory({ req, item, previousQuantity: item.quantity, newQuantity: updated.quantity, reason });

  res.json(serializeItem(updated));
});

router.post("/warehouse/:id/receive", requirePermission("receive_purchases"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const id = parseParamId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const schema = z.object({
    vendor: z.string().min(1),
    caseCost: z.number().min(0),
    casesReceived: z.number().int().min(1).default(1),
    unitsPerCase: z.number().int().min(1).default(1),
    purchaseDate: z.string(),
    notes: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { vendor, caseCost, casesReceived, unitsPerCase, purchaseDate, notes } = parsed.data;
  const totalUnits = casesReceived * unitsPerCase;
  const costPerUnit = caseCost / unitsPerCase;

  const result = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(warehouseItemsTable)
      .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)))
      .limit(1);
    if (!item) return null;

    const warehouse = item.warehouseId ? { id: item.warehouseId } : await ensureDefaultWarehouse(req.account!.id);
    const [purchase] = await tx.insert(warehousePurchasesTable).values({
      accountId: req.account!.id,
      warehouseId: warehouse.id,
      warehouseItemId: id,
      vendor,
      caseCost,
      casesReceived,
      unitsPerCase,
      totalUnits,
      costPerUnit,
      purchaseDate,
      notes,
    }).returning();

    const [updated] = await tx
      .update(warehouseItemsTable)
      .set({
        warehouseId: warehouse.id,
        quantity: sql`${warehouseItemsTable.quantity} + ${totalUnits}`,
        caseCost,
        unitsPerCase,
        costPerUnit,
        lastPurchaseDate: purchaseDate,
        lastUpdated: new Date(),
      })
      .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)))
      .returning();
    if (!updated) return null;

    await tx.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: null,
      itemId: item.id,
      itemName: item.name,
      action: "warehouse_quantity_adjusted",
      field: "quantity",
      previousValue: String(item.quantity),
      newValue: String(updated.quantity),
      note: notes ? `Purchase received: ${notes}` : "Purchase received",
      source: "warehouse",
      performedBy: req.authUser?.username,
      performedByRole: req.membership?.role ?? req.authUser?.role,
      location: "Warehouse",
    });

    return { purchase, updated };
  });

  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ purchase: result.purchase, item: serializeItem(result.updated), newQty: result.updated.quantity, unitsAdded: totalUnits });
});

router.post("/warehouse/:id/transfer", requirePermission("transfer_inventory"), async (req, res) => {
  const id = parseParamId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const schema = z.object({
    storeLocation: z.string().min(1),
    unitsTransferred: z.number().int().min(1),
    storeItemId: z.number().int().optional(),
    createStoreItem: z.boolean().optional().default(false),
    parLevel: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { storeLocation, unitsTransferred, storeItemId, createStoreItem, parLevel, notes } = parsed.data;
  const resolvedStoreLocation = await resolveStoreLocation(req, res, storeLocation);
  if (!resolvedStoreLocation) return;

  const [whItem] = await db
    .select()
    .from(warehouseItemsTable)
    .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)))
    .limit(1);
  if (!whItem) { res.status(404).json({ error: "Not found" }); return; }
  if (whItem.quantity < unitsTransferred) {
    res.status(400).json({ error: `Only ${whItem.quantity} units available in warehouse` });
    return;
  }

  let storeItem: typeof itemsTable.$inferSelect | null = null;
  if (storeItemId) {
    const [foundStoreItem] = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.id, storeItemId), eq(itemsTable.accountId, req.account!.id)))
      .limit(1);
    storeItem = foundStoreItem ?? null;
    if (!storeItem) { res.status(404).json({ error: "Store item not found" }); return; }

    const storeLocationMatches =
      storeItem.locationId !== null
        ? storeItem.locationId === resolvedStoreLocation.id
        : storeItem.location === resolvedStoreLocation.name;
    if (!storeLocationMatches) {
      res.status(400).json({ error: "Store item does not belong to the transfer location" });
      return;
    }
    if (!assertLocationAccess(req, res, storeItem.location)) return;
  }

  const result = await db.transaction(async (tx) => {
    const warehouse = whItem.warehouseId ? { id: whItem.warehouseId } : await ensureDefaultWarehouse(req.account!.id);
    const [updatedWarehouseItem] = await tx.update(warehouseItemsTable)
      .set({
        warehouseId: warehouse.id,
        quantity: sql`${warehouseItemsTable.quantity} - ${unitsTransferred}`,
        lastUpdated: new Date(),
      })
      .where(
        and(
          eq(warehouseItemsTable.id, id),
          eq(warehouseItemsTable.accountId, req.account!.id),
          sql`${warehouseItemsTable.quantity} >= ${unitsTransferred}`,
        ),
      )
      .returning();

    if (!updatedWarehouseItem) return { type: "insufficient" as const };

    let resolvedStoreItemId = storeItemId;
    if (storeItem) {
      const [updatedStoreItem] = await tx.update(itemsTable)
        .set({ quantity: sql`${itemsTable.quantity} + ${unitsTransferred}`, lastUpdated: new Date() })
        .where(and(eq(itemsTable.id, storeItem.id), eq(itemsTable.accountId, req.account!.id)))
        .returning();
      if (!updatedStoreItem) return { type: "store-missing" as const };

      await tx.insert(historyTable).values({
        accountId: req.account!.id,
        locationId: updatedStoreItem.locationId,
        itemId: updatedStoreItem.id,
        itemName: updatedStoreItem.name,
        action: "quantity_updated",
        field: "quantity",
        previousValue: String(storeItem.quantity),
        newValue: String(updatedStoreItem.quantity),
        note: `Transfer from warehouse: +${unitsTransferred} units`,
        source: "warehouse",
        location: updatedStoreItem.location,
      });
    } else if (createStoreItem) {
      const [newStoreItem] = await tx.insert(itemsTable).values({
        accountId: req.account!.id,
        locationId: resolvedStoreLocation.id,
        name: whItem.name,
        category: whItem.category,
        location: resolvedStoreLocation.name,
        quantity: unitsTransferred,
        parLevel: parLevel ?? 0,
        minQuantity: parLevel ?? 0,
        maxQuantity: Math.max(parLevel ?? 0, unitsTransferred, (parLevel ?? 0) * 2),
        barcode: whItem.barcode ?? undefined,
      }).returning();
      resolvedStoreItemId = newStoreItem!.id;
    }

    const [transfer] = await tx.insert(warehouseTransfersTable).values({
      accountId: req.account!.id,
      warehouseId: warehouse.id,
      storeLocationId: resolvedStoreLocation.id,
      warehouseItemId: id,
      warehouseItemName: whItem.name,
      storeItemId: resolvedStoreItemId,
      storeLocation: resolvedStoreLocation.name,
      unitsTransferred,
      notes,
    }).returning();

    await tx.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: null,
      itemId: whItem.id,
      itemName: whItem.name,
      action: "warehouse_quantity_adjusted",
      field: "quantity",
      previousValue: String(whItem.quantity),
      newValue: String(updatedWarehouseItem.quantity),
      note: notes ? `Transfer to ${resolvedStoreLocation.name}: ${notes}` : `Transfer to ${resolvedStoreLocation.name}`,
      source: "warehouse",
      performedBy: req.authUser?.username,
      performedByRole: req.membership?.role ?? req.authUser?.role,
      location: "Warehouse",
    });

    return { type: "ok" as const, transfer, newWarehouseQty: updatedWarehouseItem.quantity };
  });

  if (result.type === "insufficient") {
    res.status(409).json({ error: "Warehouse quantity changed before this transfer could be saved. Reload and try again." });
    return;
  }
  if (result.type === "store-missing") {
    res.status(404).json({ error: "Store item not found" });
    return;
  }

  res.json({ transfer: result.transfer, newWarehouseQty: result.newWarehouseQty });
});

export default router;
