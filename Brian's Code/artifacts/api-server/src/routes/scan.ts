import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  itemsTable,
  historyTable,
  productIdentifiersTable,
  productsTable,
  scanLogTable,
  warehouseItemsTable,
  locationsTable,
  type ItemRow,
  type LocationRow,
  type PermissionKey,
} from "@workspace/db";
import {
  canViewAllLocations,
  canAccessLocation,
  requireAccount,
  requireActiveMembership,
} from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

function assertPermission(req: Request, res: Response, key: PermissionKey): boolean {
  const permissions = req.permissions ?? req.authUser?.permissions;
  if (permissions?.has(key)) return true;
  res.status(403).json({ error: `Permission denied: ${key}` });
  return false;
}

function canAccessItem(req: Request, item: ItemRow): boolean {
  if (canViewAllLocations(req)) return true;
  if (item.locationId !== null && (req.allowedLocationIds ?? []).includes(item.locationId)) return true;
  return canAccessLocation(req, item.location);
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

  if (!canViewAllLocations(req) && !(req.allowedLocationIds ?? []).includes(row.id) && !canAccessLocation(req, row.name)) {
    res.status(403).json({ error: "Permission denied for this location" });
    return null;
  }

  return row;
}

async function findAccountItem(req: Request, id: number): Promise<ItemRow | null> {
  const [item] = await db
    .select()
    .from(itemsTable)
    .where(and(eq(itemsTable.id, id), eq(itemsTable.accountId, req.account!.id)))
    .limit(1);
  return item ?? null;
}

function mergeById<T extends { id: number }>(rows: T[][]): T[] {
  const merged = new Map<number, T>();
  for (const group of rows) {
    for (const row of group) merged.set(row.id, row);
  }
  return Array.from(merged.values());
}

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^0-9a-z]/g, "");
}

function productIdSetFromIdentifiers(rows: { productId: number }[]): number[] {
  return [...new Set(rows.map((row) => row.productId).filter((id) => Number.isInteger(id)))];
}

async function getOrCreateProduct(accountId: number, name: string, category: string): Promise<number> {
  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.accountId, accountId), eq(productsTable.name, name), eq(productsTable.category, category)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(productsTable)
    .values({ accountId, name, category, status: "active" })
    .returning({ id: productsTable.id });
  return created!.id;
}

async function ensureProductIdentifier(accountId: number, productId: number | null, barcode: string, source: string) {
  const normalizedCode = normalizeIdentifier(barcode);
  if (!productId || !normalizedCode) return;

  const [existing] = await db
    .select({ id: productIdentifiersTable.id })
    .from(productIdentifiersTable)
    .where(
      and(
        eq(productIdentifiersTable.accountId, accountId),
        eq(productIdentifiersTable.productId, productId),
        eq(productIdentifiersTable.normalizedCode, normalizedCode),
        eq(productIdentifiersTable.type, "upc"),
      ),
    )
    .limit(1);
  if (existing) return;

  await db.insert(productIdentifiersTable).values({
    accountId,
    productId,
    code: barcode,
    normalizedCode,
    type: "upc",
    unitMultiplier: 1,
    status: "active",
    primaryForType: true,
    source,
  });
}

function locationScopedItemsQuery(req: Request, barcode: string, productIds: number[], resolvedLocation: LocationRow | null) {
  const normalized = normalizeIdentifier(barcode);
  const productFilter = productIds.length > 0 ? inArray(itemsTable.productId, productIds) : undefined;
  const barcodeFilter = eq(itemsTable.barcode, barcode);
  const baseMatch = productFilter ? or(productFilter, barcodeFilter) : barcodeFilter;

  if (resolvedLocation) {
    return and(
      eq(itemsTable.accountId, req.account!.id),
      baseMatch,
      or(eq(itemsTable.locationId, resolvedLocation.id), eq(itemsTable.location, resolvedLocation.name)),
    );
  }

  if (canViewAllLocations(req)) {
    return and(eq(itemsTable.accountId, req.account!.id), baseMatch);
  }

  const allowedLocationIds = req.allowedLocationIds ?? [];
  const legacyLocations = req.authUser?.assignedLocations ?? [];
  if (allowedLocationIds.length > 0 && legacyLocations.length > 0) {
    return and(
      eq(itemsTable.accountId, req.account!.id),
      baseMatch,
      or(inArray(itemsTable.locationId, allowedLocationIds), inArray(itemsTable.location, legacyLocations)),
    );
  }
  if (allowedLocationIds.length > 0) {
    return and(eq(itemsTable.accountId, req.account!.id), baseMatch, inArray(itemsTable.locationId, allowedLocationIds));
  }
  if (legacyLocations.length > 0) {
    return and(eq(itemsTable.accountId, req.account!.id), baseMatch, inArray(itemsTable.location, legacyLocations));
  }

  return and(eq(itemsTable.accountId, req.account!.id), eq(itemsTable.barcode, `__no_access_${normalized}`));
}

function warehouseItemsQuery(req: Request, barcode: string, productIds: number[]) {
  const productFilter = productIds.length > 0 ? inArray(warehouseItemsTable.productId, productIds) : undefined;
  const barcodeFilter = eq(warehouseItemsTable.barcode, barcode);
  const baseMatch = productFilter ? or(productFilter, barcodeFilter) : barcodeFilter;
  return and(eq(warehouseItemsTable.accountId, req.account!.id), baseMatch);
}

/* ── GET /scan/lookup?barcode=X&location=Y ── */
router.get("/scan/lookup", async (req, res) => {
  const barcode = String(req.query.barcode ?? "").trim();
  const location = String(req.query.location ?? "").trim();
  const normalizedBarcode = normalizeIdentifier(barcode);

  if (!barcode || !normalizedBarcode) {
    res.status(400).json({ error: "barcode is required" });
    return;
  }
  const resolvedLocation = location ? await resolveLocationByName(req, res, location) : null;
  if (location && !resolvedLocation) return;

  const identifierRows = await db
    .select({ productId: productIdentifiersTable.productId })
    .from(productIdentifiersTable)
    .where(
      and(
        eq(productIdentifiersTable.accountId, req.account!.id),
        eq(productIdentifiersTable.normalizedCode, normalizedBarcode),
        eq(productIdentifiersTable.status, "active"),
      ),
    );
  const productIds = productIdSetFromIdentifiers(identifierRows);

  const barcodeItems = await db
    .select()
    .from(itemsTable)
    .where(locationScopedItemsQuery(req, barcode, productIds, resolvedLocation));

  const storeItems = location
    ? barcodeItems.filter((item) => item.locationId === resolvedLocation!.id || item.location === resolvedLocation!.name)
    : barcodeItems;
  const otherItems = location && canViewAllLocations(req)
    ? barcodeItems.filter((item) => item.locationId !== resolvedLocation!.id && item.location !== resolvedLocation!.name)
    : [];

  if (storeItems.length === 0 && otherItems.length === 0) {
    // Last resort: check the warehouse catalog by barcode
    const warehouseItems = canViewAllLocations(req)
      ? await db
        .select()
        .from(warehouseItemsTable)
        .where(warehouseItemsQuery(req, barcode, productIds))
        .limit(1)
      : [];

    res.json({
      found: false,
      storeItem: null,
      otherItems: [],
      warehouseItem: warehouseItems[0] ?? null,
      identifierMatched: productIds.length > 0,
    });
    return;
  }

  res.json({
    found: true,
    storeItem: storeItems[0] ?? null,
    otherItems,
    warehouseItem: null,
    identifierMatched: productIds.length > 0,
  });
});

/* ── POST /scan/action ── */
router.post("/scan/action", async (req, res) => {
  const schema = z.discriminatedUnion("action", [
    // Verify count — record discrepancy, optionally update qty
    z.object({
      action: z.literal("verify"),
      barcode: z.string(),
      itemId: z.number().int(),
      countedQty: z.number().int().min(0),
      reason: z.string().optional(),
      operator: z.string().optional(),
      applyCount: z.boolean().default(false),
    }),
    // Add item from another location to this store
    z.object({
      action: z.literal("add-to-store"),
      barcode: z.string(),
      sourceItemId: z.number().int(),
      location: z.string(),
      quantity: z.number().int().min(0),
      parLevel: z.number().int().min(0),
      category: z.string().optional(),
      operator: z.string().optional(),
    }),
    // Create brand new item (unknown barcode)
    z.object({
      action: z.literal("create"),
      barcode: z.string(),
      name: z.string().min(1),
      category: z.string(),
      location: z.string(),
      quantity: z.number().int().min(0),
      parLevel: z.number().int().min(0),
      operator: z.string().optional(),
    }),
    // Adjust quantity (generic adjustment)
    z.object({
      action: z.literal("adjust"),
      barcode: z.string(),
      itemId: z.number().int(),
      newQty: z.number().int().min(0),
      reason: z.string(),
      operator: z.string().optional(),
      notes: z.string().optional(),
    }),
  ]);

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;

  if (data.action === "verify") {
    if (data.applyCount && !assertPermission(req, res, "mark_adjustments")) return;

    const item = await findAccountItem(req, data.itemId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    if (!canAccessItem(req, item)) { res.status(403).json({ error: "Permission denied for this location" }); return; }

    const diff = data.countedQty - item.quantity;
    if (data.applyCount && diff !== 0) {
      await db.update(itemsTable)
        .set({ quantity: data.countedQty, lastUpdated: new Date() })
        .where(and(eq(itemsTable.id, data.itemId), eq(itemsTable.accountId, req.account!.id)));
      await db.insert(historyTable).values({
        accountId: req.account!.id,
        locationId: item.locationId,
        itemId: item.id,
        itemName: item.name,
        action: "quantity_updated",
        field: "quantity",
        previousValue: String(item.quantity),
        newValue: String(data.countedQty),
        note: data.reason ? `Scan verify — ${data.reason}` : "Scan verify",
        source: "scan",
        performedBy: req.authUser?.displayName ?? req.authUser?.username,
        performedByRole: req.authUser?.role,
        location: item.location,
      });
    }

    await db.insert(scanLogTable).values({
      accountId: req.account!.id,
      locationId: item.locationId,
      barcode: data.barcode,
      itemId: item.id,
      itemName: item.name,
      location: item.location,
      action: "verify",
      qtyChange: diff !== 0 && data.applyCount ? diff : 0,
      reason: data.reason,
      operator: data.operator,
    });

    res.json({
      itemName: item.name,
      previousQty: item.quantity,
      countedQty: data.countedQty,
      diff,
      applied: data.applyCount,
    });
    return;
  }

  if (data.action === "add-to-store") {
    if (!assertPermission(req, res, "edit_store_inventory")) return;

    const source = await findAccountItem(req, data.sourceItemId);
    if (!source) { res.status(404).json({ error: "Source item not found" }); return; }
    const resolvedLocation = await resolveLocationByName(req, res, data.location);
    if (!resolvedLocation) return;
    if (!canViewAllLocations(req) && !canAccessItem(req, source)) {
      res.status(403).json({ error: "Permission denied for source item location" });
      return;
    }

    const productId = source.productId ?? await getOrCreateProduct(req.account!.id, source.name, data.category ?? source.category);
    const [inserted] = await db.insert(itemsTable).values({
      accountId: req.account!.id,
      productId,
      locationId: resolvedLocation.id,
      name: source.name,
      category: data.category ?? source.category,
      quantity: data.quantity,
      parLevel: data.parLevel,
      minQuantity: data.parLevel,
      maxQuantity: Math.max(data.parLevel, data.quantity, data.parLevel * 2),
      location: resolvedLocation.name,
      barcode: data.barcode,
    }).returning();
    if (!inserted) {
      res.status(500).json({ error: "Failed to create item" });
      return;
    }
    await ensureProductIdentifier(req.account!.id, productId, data.barcode, "scan_add_to_store");

    await db.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: resolvedLocation.id,
      itemId: inserted.id,
      itemName: source.name,
      action: "created",
      note: `Added to store via barcode scan from ${source.location}`,
      source: "scan",
      performedBy: req.authUser?.displayName ?? req.authUser?.username,
      performedByRole: req.authUser?.role,
      location: resolvedLocation.name,
    });

    await db.insert(scanLogTable).values({
      accountId: req.account!.id,
      locationId: resolvedLocation.id,
      barcode: data.barcode,
      itemId: inserted.id,
      itemName: source.name,
      location: resolvedLocation.name,
      action: "add-to-store",
      qtyChange: data.quantity,
      operator: data.operator,
    });

    res.json({ item: inserted });
    return;
  }

  if (data.action === "create") {
    if (!assertPermission(req, res, "edit_store_inventory")) return;
    const resolvedLocation = await resolveLocationByName(req, res, data.location);
    if (!resolvedLocation) return;

    const productId = await getOrCreateProduct(req.account!.id, data.name, data.category);
    const [inserted] = await db.insert(itemsTable).values({
      accountId: req.account!.id,
      productId,
      locationId: resolvedLocation.id,
      name: data.name,
      category: data.category,
      quantity: data.quantity,
      parLevel: data.parLevel,
      minQuantity: data.parLevel,
      maxQuantity: Math.max(data.parLevel, data.quantity, data.parLevel * 2),
      location: resolvedLocation.name,
      barcode: data.barcode,
    }).returning();
    if (!inserted) {
      res.status(500).json({ error: "Failed to create item" });
      return;
    }
    await ensureProductIdentifier(req.account!.id, productId, data.barcode, "scan_create");

    await db.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: resolvedLocation.id,
      itemId: inserted.id,
      itemName: data.name,
      action: "created",
      note: `Created via barcode scan`,
      source: "scan",
      performedBy: req.authUser?.displayName ?? req.authUser?.username,
      performedByRole: req.authUser?.role,
      location: resolvedLocation.name,
    });

    await db.insert(scanLogTable).values({
      accountId: req.account!.id,
      locationId: resolvedLocation.id,
      barcode: data.barcode,
      itemId: inserted.id,
      itemName: data.name,
      location: resolvedLocation.name,
      action: "create",
      qtyChange: data.quantity,
      operator: data.operator,
    });

    res.json({ item: inserted });
    return;
  }

  if (data.action === "adjust") {
    if (!assertPermission(req, res, "mark_adjustments")) return;

    const item = await findAccountItem(req, data.itemId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    if (!canAccessItem(req, item)) { res.status(403).json({ error: "Permission denied for this location" }); return; }

    const diff = data.newQty - item.quantity;
    await db.update(itemsTable)
      .set({ quantity: data.newQty, lastUpdated: new Date() })
      .where(and(eq(itemsTable.id, data.itemId), eq(itemsTable.accountId, req.account!.id)));

    await db.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: item.locationId,
      itemId: item.id,
      itemName: item.name,
      action: "quantity_updated",
      field: "quantity",
      previousValue: String(item.quantity),
      newValue: String(data.newQty),
      note: `Scan: ${data.reason}${data.notes ? ` — ${data.notes}` : ""}`,
      source: "scan",
      performedBy: req.authUser?.displayName ?? req.authUser?.username,
      performedByRole: req.authUser?.role,
      location: item.location,
    });

    await db.insert(scanLogTable).values({
      accountId: req.account!.id,
      locationId: item.locationId,
      barcode: data.barcode,
      itemId: item.id,
      itemName: item.name,
      location: item.location,
      action: data.reason,
      qtyChange: diff,
      reason: data.reason,
      notes: data.notes,
      operator: data.operator,
    });

    res.json({ itemName: item.name, previousQty: item.quantity, newQty: data.newQty, diff });
    return;
  }

  res.status(400).json({ error: "Unknown action" });
});

/* ── GET /scan/log?location=X&limit=N ── */
router.get("/scan/log", async (req, res) => {
  const location = String(req.query.location ?? "").trim();
  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);

  const resolvedLocation = location ? await resolveLocationByName(req, res, location) : null;
  if (location && !resolvedLocation) return;

  const rows = location
    ? mergeById([
        await db.select().from(scanLogTable).where(and(eq(scanLogTable.accountId, req.account!.id), eq(scanLogTable.locationId, resolvedLocation!.id))).orderBy(scanLogTable.createdAt).limit(limit),
        await db.select().from(scanLogTable).where(and(eq(scanLogTable.accountId, req.account!.id), eq(scanLogTable.location, resolvedLocation!.name))).orderBy(scanLogTable.createdAt).limit(limit),
      ])
    : canViewAllLocations(req)
      ? await db.select().from(scanLogTable).where(eq(scanLogTable.accountId, req.account!.id)).orderBy(scanLogTable.createdAt).limit(limit)
      : (req.allowedLocationIds ?? []).length > 0 || (req.authUser?.assignedLocations ?? []).length > 0
        ? mergeById([
            (req.allowedLocationIds ?? []).length > 0
              ? await db.select().from(scanLogTable).where(and(eq(scanLogTable.accountId, req.account!.id), inArray(scanLogTable.locationId, req.allowedLocationIds ?? []))).orderBy(scanLogTable.createdAt).limit(limit)
              : [],
            (req.authUser?.assignedLocations ?? []).length > 0
              ? await db.select().from(scanLogTable).where(and(eq(scanLogTable.accountId, req.account!.id), inArray(scanLogTable.location, req.authUser?.assignedLocations ?? []))).orderBy(scanLogTable.createdAt).limit(limit)
              : [],
          ])
        : [];
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  res.json({ entries: rows.reverse() });
});

export default router;
