import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, historyTable, itemsTable, locationsTable, type ItemRow, type LocationRow } from "@workspace/db";
import { canAccessLocation, canViewAllLocations, requireAccount, requireActiveMembership } from "../middleware/auth";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAccount, requireActiveMembership);

/* ── CSV parser ── */
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = splitCSVLine(lines[0]!).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = splitCSVLine(line).map((v) => v.replace(/^"|"$/g, "").trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

/* ── Column auto-detector ── */
const ITEM_ALIASES = ["name", "product name", "item name", "product description", "description", "product", "item", "sku name"];
const BARCODE_ALIASES = ["barcode", "upc", "sku", "ean", "gtin", "product code", "item code", "item number"];
const QTY_ALIASES = ["sold", "qty sold", "units sold", "quantity sold", "quantity", "qty", "sales qty", "unit sales", "count"];
const LOCATION_ALIASES = ["location", "market", "site", "store", "machine", "machine name", "site name", "market name"];
const DATE_ALIASES = ["date", "sale date", "transaction date", "period", "day"];

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = normalized.findIndex((h) => h === alias);
    if (idx !== -1) return headers[idx]!;
  }
  for (const alias of aliases) {
    const idx = normalized.findIndex((h) => {
      if (alias === "item" && /\b(cost|price)\b/.test(h)) return false;
      if (alias === "product" && /\b(cost|price)\b/.test(h)) return false;
      return h.includes(alias);
    });
    if (idx !== -1) return headers[idx]!;
  }
  return null;
}

/* ── Fuzzy item matcher ── */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

function normalizeBarcode(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function barcodeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function findBestMatch(query: string, items: ItemRow[], barcode?: string | null): ItemRow | null {
  const normalizedBarcode = normalizeBarcode(barcode ?? "");
  const numericBarcode = barcodeDigits(barcode ?? "");
  if (normalizedBarcode || numericBarcode) {
    const exactBarcode = items.find((item) => {
      const itemBarcode = item.barcode ?? "";
      return (
        (normalizedBarcode && normalizeBarcode(itemBarcode) === normalizedBarcode) ||
        (numericBarcode && barcodeDigits(itemBarcode) === numericBarcode)
      );
    });
    if (exactBarcode) return exactBarcode;
  }

  const q = normalizeName(query);
  if (!q) return null;
  const qWords = q.split(/\s+/).filter((w) => w.length > 1);

  let bestScore = 0;
  let bestItem: ItemRow | null = null;

  for (const item of items) {
    const name = normalizeName(item.name);
    if (name === q) return item; // exact match
    if (name.includes(q) || q.includes(name)) {
      const score = (Math.min(name.length, q.length) / Math.max(name.length, q.length)) * 100;
      if (score > bestScore) { bestScore = score; bestItem = item; }
      continue;
    }
    const iWords = name.split(/\s+/).filter((w) => w.length > 1);
    let matchCount = 0;
    for (const qw of qWords) {
      if (iWords.some((iw) => iw.includes(qw) || qw.includes(iw))) matchCount++;
    }
    const score = qWords.length > 0 ? (matchCount / qWords.length) * 80 : 0;
    if (score > bestScore && score >= 40) { bestScore = score; bestItem = item; }
  }

  return bestScore >= 40 ? bestItem : null;
}

function canSeeAllLocations(req: Request): boolean {
  return canViewAllLocations(req);
}

function allowedLocationIds(req: Request): number[] {
  return req.allowedLocationIds ?? [];
}

function canAccessItem(req: Request, item: ItemRow): boolean {
  if (canSeeAllLocations(req)) return true;
  if (item.locationId !== null && allowedLocationIds(req).includes(item.locationId)) return true;
  return canAccessLocation(req, item.location);
}

function filterAccessibleItems(req: Request, items: ItemRow[]) {
  return items.filter((item) => canAccessItem(req, item));
}

async function findAccountLocationsByName(req: Request, names: string[]): Promise<Map<string, LocationRow>> {
  const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (uniqueNames.length === 0) return new Map();

  const rows = await db
    .select()
    .from(locationsTable)
    .where(and(eq(locationsTable.accountId, req.account!.id), inArray(locationsTable.name, uniqueNames)));

  return new Map(rows.map((row) => [row.name, row]));
}

async function validateCsvLocations(req: Request, rows: Record<string, string>[], locationCol: string | null): Promise<string | null> {
  if (!locationCol) return null;

  const csvLocations = rows
    .map((row) => (row[locationCol] ?? "").trim())
    .filter(Boolean);
  const accountLocations = await findAccountLocationsByName(req, csvLocations);

  for (const row of rows) {
    const location = (row[locationCol] ?? "").trim();
    if (!location) continue;
    const accountLocation = accountLocations.get(location);
    if (!accountLocation || accountLocation.status !== "active") return location;
    if (!canSeeAllLocations(req) && !allowedLocationIds(req).includes(accountLocation.id) && !canAccessLocation(req, location)) {
      return location;
    }
  }
  return null;
}

async function validateFallbackLocation(req: Request, location: string): Promise<string | null> {
  if (!location) return null;
  const accountLocations = await findAccountLocationsByName(req, [location]);
  const accountLocation = accountLocations.get(location);
  if (!accountLocation || accountLocation.status !== "active") return location;
  if (!canSeeAllLocations(req) && !allowedLocationIds(req).includes(accountLocation.id) && !canAccessLocation(req, location)) {
    return location;
  }
  return null;
}

function itemMatchesLocation(item: ItemRow, location: string): boolean {
  return item.location.trim().toLowerCase() === location.trim().toLowerCase();
}

/* ── POST /import/preview ── */
router.post("/import/preview", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const text = req.file.buffer.toString("utf-8");
  const { headers, rows } = parseCSV(text);

  if (!headers.length) {
    res.status(400).json({ error: "Could not parse CSV headers" });
    return;
  }

  const itemCol = findColumn(headers, ITEM_ALIASES);
  const barcodeCol = findColumn(headers, BARCODE_ALIASES);
  const qtyCol = findColumn(headers, QTY_ALIASES);
  const locationCol = findColumn(headers, LOCATION_ALIASES);
  const dateCol = findColumn(headers, DATE_ALIASES);
  if (!itemCol && !barcodeCol) {
    res.status(400).json({ error: "Could not detect item name or barcode column" });
    return;
  }

  if (!qtyCol) {
    res.status(400).json({ error: "Could not detect quantity/count column" });
    return;
  }

  const fallbackLocation = typeof req.body?.location === "string" ? req.body.location.trim() : "";
  const deniedLocation = await validateCsvLocations(req, rows, locationCol) ?? (!locationCol ? await validateFallbackLocation(req, fallbackLocation) : null);
  if (deniedLocation) {
    res.status(403).json({ error: "Permission denied for one or more import locations" });
    return;
  }

  // Aggregate by item name (sum quantities across rows)
  const aggregated = new Map<string, { csvName: string; barcode: string | null; qty: number; locations: Set<string>; dates: string[] }>();
  for (const row of rows) {
    const rawName = itemCol ? (row[itemCol] ?? "").trim() : "";
    const rawBarcode = barcodeCol ? (row[barcodeCol] ?? "").trim() : "";
    const rawQty = qtyCol ? (row[qtyCol] ?? "0").replace(/[^0-9.-]/g, "") : "0";
    const rawLoc = locationCol ? (row[locationCol] ?? "").trim() : fallbackLocation;
    const rawDate = dateCol ? (row[dateCol] ?? "").trim() : "";
    const csvName = rawName || rawBarcode;

    if (!csvName || (rawName.trim().toLowerCase() === "totals" && !rawBarcode)) continue;
    const qty = parseFloat(rawQty) || 0;
    if (qty <= 0) continue;

    const key = `${barcodeDigits(rawBarcode) || normalizeBarcode(rawBarcode) || normalizeName(csvName)}::${rawLoc.trim().toLowerCase()}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.qty += qty;
      if (rawLoc) existing.locations.add(rawLoc);
      if (rawDate) existing.dates.push(rawDate);
    } else {
      aggregated.set(key, {
        csvName,
        barcode: rawBarcode || null,
        qty,
        locations: rawLoc ? new Set([rawLoc]) : new Set<string>(),
        dates: rawDate ? [rawDate] : [],
      });
    }
  }

  const accountItems = await db
    .select()
    .from(itemsTable)
    .where(eq(itemsTable.accountId, req.account!.id));
  const allItems = filterAccessibleItems(req, accountItems);
  const scopedItems = fallbackLocation && !locationCol
    ? allItems.filter((item) => itemMatchesLocation(item, fallbackLocation))
    : allItems;

  const matched: object[] = [];
  const unmatched: object[] = [];

  for (const data of aggregated.values()) {
    const item = findBestMatch(data.csvName, scopedItems, data.barcode);
    const entry = {
      csvName: data.csvName,
      qtySold: Math.round(data.qty),
      locations: Array.from(data.locations),
    };

    if (item) {
      matched.push({
        ...entry,
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        location: item.location,
        currentQty: item.quantity,
        parLevel: item.parLevel,
        minQuantity: item.minQuantity,
        maxQuantity: item.maxQuantity,
        projectedQty: Math.max(0, item.quantity - Math.round(data.qty)),
        suggestedPar: null, // computed client-side or on apply
      });
    } else {
      unmatched.push(entry);
    }
  }

  res.json({
    headers,
    detectedColumns: { item: itemCol, barcode: barcodeCol, qty: qtyCol, location: locationCol, date: dateCol },
    totalRows: rows.length,
    matched,
    unmatched,
  });
});

/* ── POST /import/apply ── */
router.post("/import/apply", async (req, res) => {
  const schema = z.object({
    mode: z.enum(["deduct", "par"]),
    restockDays: z.number().int().min(1).max(365).optional().default(7),
    items: z.array(
      z.object({
        itemId: z.number().int(),
        qtySold: z.number().int().min(0),
        override: z.boolean().optional(),
      })
    ),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { mode, restockDays, items } = parsed.data;
  const results: object[] = [];
  const itemIds = [...new Set(items.map((item) => item.itemId))];
  const existingItems = itemIds.length > 0
    ? await db
        .select()
        .from(itemsTable)
        .where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.id, itemIds)))
    : [];

  if (existingItems.length !== itemIds.length) {
    res.status(403).json({ error: "Permission denied for one or more item locations" });
    return;
  }

  for (const item of existingItems) {
    if (!canAccessItem(req, item)) {
      res.status(403).json({ error: "Permission denied for one or more item locations" });
      return;
    }
  }

  for (const { itemId, qtySold } of items) {
    const [item] = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.id, itemId), eq(itemsTable.accountId, req.account!.id)));
    if (!item) continue;

    if (mode === "deduct") {
      const newQty = Math.max(0, item.quantity - qtySold);
      await db.update(itemsTable)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(and(eq(itemsTable.id, itemId), eq(itemsTable.accountId, req.account!.id)));
      if (newQty !== item.quantity) {
        await db.insert(historyTable).values({
          accountId: req.account!.id,
          locationId: item.locationId,
          itemId: item.id,
          itemName: item.name,
          action: "import",
          field: "quantity",
          previousValue: String(item.quantity),
          newValue: String(newQty),
          note: `CSV import deducted ${qtySold} units`,
          source: "import",
          performedBy: req.authUser?.displayName ?? null,
          performedByRole: req.authUser?.role ?? null,
          location: item.location,
        });
      }
      results.push({ itemId, itemName: item.name, previousQty: item.quantity, newQty, change: newQty - item.quantity });

    } else if (mode === "par") {
      // Weekly velocity -> minimum = velocity x restockDays, maximum = two cycles.
      const weeklyVelocity = qtySold / 7;
      const suggestedPar = Math.ceil(weeklyVelocity * restockDays);
      const suggestedMax = Math.max(suggestedPar, suggestedPar * 2, item.quantity);
      if (suggestedPar > 0) {
        await db.update(itemsTable)
          .set({
            parLevel: suggestedPar,
            minQuantity: suggestedPar,
            maxQuantity: suggestedMax,
            lastUpdated: new Date(),
          })
          .where(and(eq(itemsTable.id, itemId), eq(itemsTable.accountId, req.account!.id)));
        if (suggestedPar !== item.minQuantity || suggestedMax !== item.maxQuantity) {
          await db.insert(historyTable).values({
            accountId: req.account!.id,
            locationId: item.locationId,
            itemId: item.id,
            itemName: item.name,
            action: "import",
            field: "stockRange",
            previousValue: `${item.minQuantity}-${item.maxQuantity}`,
            newValue: `${suggestedPar}-${suggestedMax}`,
            note: `CSV import calculated min/max stock from ${qtySold} sold over ${restockDays} restock days`,
            source: "import",
            performedBy: req.authUser?.displayName ?? null,
            performedByRole: req.authUser?.role ?? null,
            location: item.location,
          });
        }
        results.push({ itemId, itemName: item.name, previousMin: item.minQuantity, newMin: suggestedPar, previousMax: item.maxQuantity, newMax: suggestedMax });
      }
    }
  }

  res.json({ mode, applied: results.length, results });
});

export default router;
