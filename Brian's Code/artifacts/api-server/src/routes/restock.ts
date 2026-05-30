import { Router, type IRouter, type Request, type Response } from "express";
import { lt, asc, eq, and, inArray } from "drizzle-orm";
import { db, itemsTable, locationsTable, type LocationRow } from "@workspace/db";
import { serializeItem } from "./items.js";
import { canViewAllLocations, requireAccount, requireActiveMembership, requirePermission } from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

function sanitizeCsvString(value: string): string {
  return /^[\t\r\n\f\v ]*[=+\-@|%]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: string | number): string {
  const s = typeof value === "string" ? sanitizeCsvString(value) : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function getRestockRows(req: Request, res: Response, location: string | undefined) {
  const baseWhere = lt(itemsTable.quantity, itemsTable.parLevel);
  if (location) {
    const resolvedLocation = await resolveLocationByName(req, res, location);
    if (!resolvedLocation) return null;

    const byLocationId = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.accountId, req.account!.id), baseWhere, eq(itemsTable.locationId, resolvedLocation.id)))
      .orderBy(asc(itemsTable.category), asc(itemsTable.name));
    const byLegacyLocation = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.accountId, req.account!.id), baseWhere, eq(itemsTable.location, resolvedLocation.name)))
      .orderBy(asc(itemsTable.category), asc(itemsTable.name));
    return mergeById([byLocationId, byLegacyLocation]);
  }

  if (canViewAllLocations(req)) {
    return db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.accountId, req.account!.id), baseWhere))
      .orderBy(asc(itemsTable.category), asc(itemsTable.name));
  }

  const allowedLocationIds = req.allowedLocationIds ?? [];
  const assignedLocations = req.authUser?.assignedLocations ?? [];
  if (allowedLocationIds.length === 0 && assignedLocations.length === 0) return [];

  const byLocationId = allowedLocationIds.length > 0
    ? await db
        .select()
        .from(itemsTable)
        .where(and(eq(itemsTable.accountId, req.account!.id), baseWhere, inArray(itemsTable.locationId, allowedLocationIds)))
        .orderBy(asc(itemsTable.category), asc(itemsTable.name))
    : [];
  const byLegacyLocation = assignedLocations.length > 0
    ? await db
        .select()
        .from(itemsTable)
        .where(and(eq(itemsTable.accountId, req.account!.id), baseWhere, inArray(itemsTable.location, assignedLocations)))
        .orderBy(asc(itemsTable.category), asc(itemsTable.name))
    : [];

  return mergeById([byLocationId, byLegacyLocation]);
}

function mergeById<T extends { id: number }>(rows: T[][]): T[] {
  const merged = new Map<number, T>();
  for (const group of rows) {
    for (const row of group) merged.set(row.id, row);
  }
  return Array.from(merged.values()).sort((a, b) => {
    const aRow = a as { category?: unknown; name?: unknown };
    const bRow = b as { category?: unknown; name?: unknown };
    const categoryCompare = String(aRow.category ?? "").localeCompare(String(bRow.category ?? ""));
    if (categoryCompare !== 0) return categoryCompare;
    return String(aRow.name ?? "").localeCompare(String(bRow.name ?? ""));
  });
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

  if (!canViewAllLocations(req) && !(req.allowedLocationIds ?? []).includes(row.id) && !(req.authUser?.assignedLocations ?? []).includes(row.name)) {
    res.status(403).json({ error: "Permission denied for this location" });
    return null;
  }

  return row;
}

router.get("/restock", requirePermission("edit_store_inventory"), async (req, res) => {
  const location = req.query.location as string | undefined;
  const rows = await getRestockRows(req, res, location);
  if (rows === null) return;

  const entries = rows.map((row) => ({
    item: serializeItem(row),
    unitsNeeded: Math.max(0, row.parLevel - row.quantity),
  }));
  const totalUnitsNeeded = entries.reduce((acc, e) => acc + e.unitsNeeded, 0);

  res.json({
    generatedAt: new Date().toISOString(),
    totalItems: entries.length,
    totalUnitsNeeded,
    entries,
  });
});

router.get("/restock.csv", requirePermission("edit_store_inventory"), async (req, res) => {
  const location = req.query.location as string | undefined;
  const rows = await getRestockRows(req, res, location);
  if (rows === null) return;

  const header = [
    "Name",
    "Category",
    "Location",
    "Current Qty",
    "Par Level",
    "Units Needed",
    "Last Updated",
  ];
  const lines: string[] = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.name),
        csvEscape(row.category),
        csvEscape(row.location),
        row.quantity,
        row.parLevel,
        Math.max(0, row.parLevel - row.quantity),
        row.lastUpdated.toISOString(),
      ].join(","),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="restock-list-${today}.csv"`,
  );
  res.send(lines.join("\n"));
});

export default router;
