import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import {
  db,
  warehouseItemsTable,
  warehousePurchasesTable,
  warehouseTransfersTable,
  itemsTable,
  historyTable,
  locationsTable,
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAccount, requireActiveMembership);

/* ── helpers ── */
function sanitizeCsvString(value: string): string {
  return /^[\t\r\n\f\v ]*[=+\-@|%]/.test(value) ? `'${value}` : value;
}

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

function historyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  return String(value);
}

function assertGlobalWarehouseAccess(req: Request, res: Response): boolean {
  if (canViewAllLocations(req)) return true;
  res.status(403).json({ error: "Permission denied for warehouse inventory" });
  return false;
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

/* ── GET /warehouse/dashboard ── */
router.get("/warehouse/dashboard", requirePermission("view_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const items = await db
    .select()
    .from(warehouseItemsTable)
    .where(eq(warehouseItemsTable.accountId, req.account!.id));
  const total = items.length;
  const low = items.filter((i) => i.quantity < i.minPar && i.quantity > 0).length;
  const out = items.filter((i) => i.quantity <= 0).length;
  const overstock = items.filter((i) => i.maxPar > 0 && i.quantity > i.maxPar).length;
  const reorder = items.filter(
    (i) => i.reorderPoint > 0 && i.quantity <= i.reorderPoint && i.quantity >= i.minPar
  ).length;

  // Recent purchases (last 10)
  const recentPurchases = await db
    .select({
      id: warehousePurchasesTable.id,
      warehouseItemId: warehousePurchasesTable.warehouseItemId,
      vendor: warehousePurchasesTable.vendor,
      totalUnits: warehousePurchasesTable.totalUnits,
      costPerUnit: warehousePurchasesTable.costPerUnit,
      purchaseDate: warehousePurchasesTable.purchaseDate,
      createdAt: warehousePurchasesTable.createdAt,
      itemName: warehouseItemsTable.name,
    })
    .from(warehousePurchasesTable)
    .leftJoin(warehouseItemsTable, eq(warehousePurchasesTable.warehouseItemId, warehouseItemsTable.id))
    .where(eq(warehousePurchasesTable.accountId, req.account!.id))
    .orderBy(desc(warehousePurchasesTable.createdAt))
    .limit(10);

  res.json({ total, low, out, overstock, reorder, recentPurchases });
});

/* ── GET /warehouse ── */
router.get("/warehouse", requirePermission("view_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const search = String(req.query.search ?? "").trim();
  const category = String(req.query.category ?? "").trim();
  const vendor = String(req.query.vendor ?? "").trim();
  const statusFilter = String(req.query.status ?? "").trim();
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")) || 1);
  const pageSizeRaw = parseInt(String(req.query.pageSize ?? "100")) || 100;
  const pageSize = pageSizeRaw === 0 ? null : Math.max(1, pageSizeRaw); // 0 = All

  let items = await db
    .select()
    .from(warehouseItemsTable)
    .where(eq(warehouseItemsTable.accountId, req.account!.id))
    .orderBy(asc(warehouseItemsTable.name));

  if (search) {
    const s = search.toLowerCase();
    items = items.filter(
      (i) =>
        i.name.toLowerCase().includes(s) ||
        (i.barcode ?? "").toLowerCase().includes(s) ||
        i.category.toLowerCase().includes(s)
    );
  }
  if (category) items = items.filter((i) => i.category === category);

  const categories = [...new Set(items.map((i) => i.category))].sort();

  let results = items.map(serializeItem);

  // If vendor filter, load purchases to filter by vendor
  if (vendor) {
    const purchases = await db
      .select({ warehouseItemId: warehousePurchasesTable.warehouseItemId })
      .from(warehousePurchasesTable)
      .where(and(eq(warehousePurchasesTable.accountId, req.account!.id), eq(warehousePurchasesTable.vendor, vendor)));
    const vendorItemIds = new Set(purchases.map((p) => p.warehouseItemId));
    results = results.filter((i) => vendorItemIds.has(i.id));
  }

  // Status filter (server-side)
  if (statusFilter) {
    results = results.filter((i) => i.status === statusFilter);
  }

  const total = results.length;

  // Pagination
  const paged = pageSize === null
    ? results
    : results.slice((page - 1) * pageSize, page * pageSize);

  res.json({ items: paged, total, categories });
});

/* ── GET /warehouse/purchases — all purchases across all items ── */
router.get("/warehouse/purchases", requirePermission("view_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const vendor = String(req.query.vendor ?? "").trim();
  const itemId = req.query.itemId ? parseInt(String(req.query.itemId)) : null;
  const from   = String(req.query.from ?? "").trim();
  const to     = String(req.query.to ?? "").trim();

  let rows = await db
    .select({
      id:              warehousePurchasesTable.id,
      warehouseItemId: warehousePurchasesTable.warehouseItemId,
      itemName:        warehouseItemsTable.name,
      category:        warehouseItemsTable.category,
      vendor:          warehousePurchasesTable.vendor,
      caseCost:        warehousePurchasesTable.caseCost,
      casesReceived:   warehousePurchasesTable.casesReceived,
      unitsPerCase:    warehousePurchasesTable.unitsPerCase,
      totalUnits:      warehousePurchasesTable.totalUnits,
      costPerUnit:     warehousePurchasesTable.costPerUnit,
      purchaseDate:    warehousePurchasesTable.purchaseDate,
      notes:           warehousePurchasesTable.notes,
      createdAt:       warehousePurchasesTable.createdAt,
    })
    .from(warehousePurchasesTable)
    .leftJoin(warehouseItemsTable, eq(warehousePurchasesTable.warehouseItemId, warehouseItemsTable.id))
    .where(eq(warehousePurchasesTable.accountId, req.account!.id))
    .orderBy(desc(warehousePurchasesTable.purchaseDate), desc(warehousePurchasesTable.createdAt));

  if (vendor) rows = rows.filter((r) => r.vendor === vendor);
  if (itemId && !isNaN(itemId)) rows = rows.filter((r) => r.warehouseItemId === itemId);
  if (from) rows = rows.filter((r) => r.purchaseDate >= from);
  if (to)   rows = rows.filter((r) => r.purchaseDate <= to);

  // Cost analytics across filtered rows
  const costs = rows.map((r) => r.costPerUnit).filter(Boolean) as number[];
  const latestCost  = costs[0] ?? null;
  const avgCost     = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const lowestCost  = costs.length ? Math.min(...costs) : null;
  const totalSpend  = rows.reduce((sum, r) => sum + r.caseCost * r.casesReceived, 0);
  const totalUnits  = rows.reduce((sum, r) => sum + r.totalUnits, 0);

  // Vendor breakdown
  const vendorMap = new Map<string, { costs: number[]; units: number; spend: number }>();
  for (const r of rows) {
    const entry = vendorMap.get(r.vendor) ?? { costs: [], units: 0, spend: 0 };
    if (r.costPerUnit) entry.costs.push(r.costPerUnit);
    entry.units += r.totalUnits;
    entry.spend += r.caseCost * r.casesReceived;
    vendorMap.set(r.vendor, entry);
  }
  const vendorSummary = Array.from(vendorMap.entries()).map(([v, d]) => ({
    vendor: v,
    totalUnits: d.units,
    totalSpend: d.spend,
    latestCost: d.costs[0] ?? null,
    avgCost: d.costs.length ? d.costs.reduce((a, b) => a + b, 0) / d.costs.length : null,
    lowestCost: d.costs.length ? Math.min(...d.costs) : null,
    orderCount: rows.filter((r) => r.vendor === v).length,
  })).sort((a, b) => b.totalSpend - a.totalSpend);

  // Vendor list for filters
  const vendors = [...new Set(rows.map((r) => r.vendor))].sort();

  res.json({ purchases: rows, analytics: { latestCost, avgCost, lowestCost, totalSpend, totalUnits }, vendorSummary, vendors });
});

/* ── GET /warehouse/purchases/export — CSV export of all purchases ── */
router.get("/warehouse/purchases/export", requirePermission("view_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const rows = await db
    .select({
      id:            warehousePurchasesTable.id,
      itemName:      warehouseItemsTable.name,
      category:      warehouseItemsTable.category,
      vendor:        warehousePurchasesTable.vendor,
      caseCost:      warehousePurchasesTable.caseCost,
      casesReceived: warehousePurchasesTable.casesReceived,
      unitsPerCase:  warehousePurchasesTable.unitsPerCase,
      totalUnits:    warehousePurchasesTable.totalUnits,
      costPerUnit:   warehousePurchasesTable.costPerUnit,
      purchaseDate:  warehousePurchasesTable.purchaseDate,
      notes:         warehousePurchasesTable.notes,
    })
    .from(warehousePurchasesTable)
    .leftJoin(warehouseItemsTable, eq(warehousePurchasesTable.warehouseItemId, warehouseItemsTable.id))
    .where(eq(warehousePurchasesTable.accountId, req.account!.id))
    .orderBy(desc(warehousePurchasesTable.purchaseDate));

  const header = "ID,Item,Category,Vendor,Case Cost,Cases,Units/Case,Total Units,Cost/Unit,Purchase Date,Notes";
  const csvRows = rows.map((r) =>
    [
      r.id,
      `"${sanitizeCsvString(r.itemName ?? "").replace(/"/g, '""')}"`,
      `"${sanitizeCsvString(r.category ?? "").replace(/"/g, '""')}"`,
      `"${sanitizeCsvString(r.vendor).replace(/"/g, '""')}"`,
      r.caseCost.toFixed(2), r.casesReceived, r.unitsPerCase,
      r.totalUnits, r.costPerUnit?.toFixed(4) ?? "",
      r.purchaseDate,
      `"${sanitizeCsvString(r.notes ?? "").replace(/"/g, '""')}"`,
    ].join(",")
  );
  const csv = [header, ...csvRows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="warehouse-purchases-${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(csv);
});

/* ── GET /warehouse/:id ── */
router.get("/warehouse/:id", requirePermission("view_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const id = parseParamId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db
    .select()
    .from(warehouseItemsTable)
    .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const purchases = await db
    .select()
    .from(warehousePurchasesTable)
    .where(and(eq(warehousePurchasesTable.accountId, req.account!.id), eq(warehousePurchasesTable.warehouseItemId, id)))
    .orderBy(desc(warehousePurchasesTable.purchaseDate));

  const transfers = await db
    .select()
    .from(warehouseTransfersTable)
    .where(and(eq(warehouseTransfersTable.accountId, req.account!.id), eq(warehouseTransfersTable.warehouseItemId, id)))
    .orderBy(desc(warehouseTransfersTable.createdAt));

  // Vendor price analysis
  const vendorMap = new Map<string, { costs: number[]; totalUnits: number }>();
  for (const p of purchases) {
    const existing = vendorMap.get(p.vendor);
    if (existing) {
      existing.costs.push(p.costPerUnit);
      existing.totalUnits += p.totalUnits;
    } else {
      vendorMap.set(p.vendor, { costs: [p.costPerUnit], totalUnits: p.totalUnits });
    }
  }

  const vendorPricing = Array.from(vendorMap.entries()).map(([vendor, data]) => ({
    vendor,
    latestCost: data.costs[0]!,
    lowestCost: Math.min(...data.costs),
    avgCost: data.costs.reduce((a, b) => a + b, 0) / data.costs.length,
    totalUnits: data.totalUnits,
  }));

  const allCosts = purchases.map((p) => p.costPerUnit);
  const globalAvgCost = allCosts.length ? allCosts.reduce((a, b) => a + b, 0) / allCosts.length : null;
  const globalLowestCost = allCosts.length ? Math.min(...allCosts) : null;
  const latestCost = allCosts[0] ?? item.costPerUnit ?? null;

  res.json({
    item: serializeItem(item),
    purchases,
    transfers,
    vendorPricing,
    pricing: { latest: latestCost, avg: globalAvgCost, lowest: globalLowestCost },
  });
});

/* ── DELETE /warehouse/:id ── */
router.delete("/warehouse/:id", requirePermission("edit_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const id = parseParamId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db
    .select({ id: warehouseItemsTable.id })
    .from(warehouseItemsTable)
    .where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)))
    .limit(1);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(warehousePurchasesTable).where(and(eq(warehousePurchasesTable.accountId, req.account!.id), eq(warehousePurchasesTable.warehouseItemId, id)));
  await db.delete(warehouseTransfersTable).where(and(eq(warehouseTransfersTable.accountId, req.account!.id), eq(warehouseTransfersTable.warehouseItemId, id)));
  await db.delete(warehouseItemsTable).where(and(eq(warehouseItemsTable.id, id), eq(warehouseItemsTable.accountId, req.account!.id)));

  res.status(204).end();
});

/* ── POST /warehouse/:id/receive ── */
router.get("/warehouse/export/csv", requirePermission("view_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const items = await db
    .select()
    .from(warehouseItemsTable)
    .where(eq(warehouseItemsTable.accountId, req.account!.id))
    .orderBy(asc(warehouseItemsTable.name));

  const headers = ["Name", "Barcode", "Category", "Quantity", "Min Par", "Max Par", "Reorder Point", "Case Cost", "Units Per Case", "Cost Per Unit", "Last Purchase Date"];
  const rows = items.map((i) => [
    sanitizeCsvString(i.name), sanitizeCsvString(i.barcode ?? ""), sanitizeCsvString(i.category),
    i.quantity, i.minPar, i.maxPar, i.reorderPoint,
    i.caseCost ?? "", i.unitsPerCase, i.costPerUnit ?? "", i.lastPurchaseDate ?? "",
  ]);

  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="warehouse-inventory.csv"`);
  res.send(csv);
});

/* ── GET /warehouse/reorder/csv ── */
router.get("/warehouse/reorder/csv", requirePermission("view_warehouse"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  const items = await db
    .select()
    .from(warehouseItemsTable)
    .where(eq(warehouseItemsTable.accountId, req.account!.id))
    .orderBy(asc(warehouseItemsTable.name));
  const reorderItems = items.filter(
    (i) => i.quantity < i.minPar || (i.reorderPoint > 0 && i.quantity <= i.reorderPoint)
  );

  const headers = ["Name", "Barcode", "Category", "Current Qty", "Min Par", "Reorder Point", "Need To Order", "Cost Per Unit", "Estimated Cost"];
  const rows = reorderItems.map((i) => {
    const need = Math.max(0, i.maxPar - i.quantity) || Math.max(0, i.minPar - i.quantity + i.minPar);
    const estCost = i.costPerUnit ? (need * i.costPerUnit).toFixed(2) : "";
    return [sanitizeCsvString(i.name), sanitizeCsvString(i.barcode ?? ""), sanitizeCsvString(i.category), i.quantity, i.minPar, i.reorderPoint, need, i.costPerUnit?.toFixed(2) ?? "", estCost];
  });

  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="warehouse-reorder.csv"`);
  res.send(csv);
});

/* ── CSV helpers ── */
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
      else if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = splitLine(lines[0]!).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = splitLine(line).map((v) => v.replace(/^"|"$/g, "").trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "item name", "product name", "item description", "product description", "description", "sku name", "product", "item"],
  barcode: ["barcode", "upc", "sku", "ean", "gtin", "upc/ean", "barcode/upc"],
  category: ["category", "type", "department", "class", "product type"],
  quantity: ["quantity", "qty", "stock", "current qty", "on hand", "count", "current stock", "inventory"],
  minPar: ["min par", "minimum", "min qty", "minimum par", "min level", "min", "minimum quantity"],
  maxPar: ["max par", "maximum", "max qty", "maximum par", "max level", "max", "maximum quantity"],
  reorderPoint: ["reorder point", "reorder", "reorder level", "reorder qty", "reorder quantity"],
  caseCost: ["case cost", "cost", "price", "unit price", "case price", "purchase price"],
  unitsPerCase: ["units per case", "case size", "qty per case", "case qty", "pack size", "units/case"],
  costPerUnit: ["cost per unit", "unit cost", "each cost", "per unit cost", "unit price", "item price"],
  vendor: ["vendor", "supplier", "source", "manufacturer"],
};

function detectColumn(headers: string[], field: string): string | null {
  const aliases = FIELD_ALIASES[field] ?? [];
  const norm = headers.map((h) => h.toLowerCase().trim());

  for (const alias of aliases) {
    const idx = norm.findIndex((h) => h === alias);
    if (idx !== -1) return headers[idx]!;
  }

  for (const alias of aliases) {
    const idx = norm.findIndex((h) => {
      if ((alias === "item" || alias === "product") && /\b(cost|price)\b/.test(h)) return false;
      if (field === "name" && /\b(cost|price|sales|tax|fee|profit|margin|total)\b/.test(h)) return false;
      return h.includes(alias);
    });
    if (idx !== -1) return headers[idx]!;
  }

  return null;
}

function parseInteger(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback = 0): number {
  return Math.max(0, parseInteger(value, fallback));
}

function parseMoney(value: string | undefined): number | null {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/* ── POST /warehouse/import/preview ── */
router.post("/warehouse/import/preview", requirePermission("edit_warehouse"), upload.single("file"), async (req, res) => {
  if (!assertGlobalWarehouseAccess(req, res)) return;

  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const text = req.file.buffer.toString("utf-8");
  const { headers, rows } = parseCSV(text);
  if (!headers.length) { res.status(400).json({ error: "Could not parse CSV" }); return; }

  const detected: Record<string, string | null> = {};
  for (const field of Object.keys(FIELD_ALIASES)) {
    detected[field] = detectColumn(headers, field);
  }

  const nameCol = detected.name;
  if (!nameCol) { res.status(400).json({ error: "Could not detect item name column" }); return; }

  const preview = rows.map((row) => {
    const name = (nameCol ? row[nameCol] : "")?.trim() ?? "";
    if (!name || name.toLowerCase() === "totals") return null;
    return {
      name,
      barcode: detected.barcode ? row[detected.barcode]?.trim() || null : null,
      category: detected.category ? row[detected.category]?.trim() || "Uncategorized" : "Uncategorized",
      quantity: detected.quantity ? parseNonNegativeInteger(row[detected.quantity]) : 0,
      minPar: detected.minPar ? parseNonNegativeInteger(row[detected.minPar]) : 0,
      maxPar: detected.maxPar ? parseNonNegativeInteger(row[detected.maxPar]) : 0,
      reorderPoint: detected.reorderPoint ? parseNonNegativeInteger(row[detected.reorderPoint]) : 0,
      caseCost: detected.caseCost ? parseMoney(row[detected.caseCost]) : null,
      unitsPerCase: detected.unitsPerCase ? Math.max(1, parseNonNegativeInteger(row[detected.unitsPerCase], 1)) : 1,
      costPerUnit: detected.costPerUnit ? parseMoney(row[detected.costPerUnit]) : null,
      vendor: detected.vendor ? row[detected.vendor]?.trim() || null : null,
    };
  }).filter(Boolean);

  res.json({ headers, detected, totalRows: rows.length, preview });
});
export default router;
