import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  locationsTable,
  routeSheetStopItemsTable,
  routeSheetStopsTable,
  routeSheetsTable,
  type RouteSheetRow,
  type RouteSheetStopItemRow,
  type RouteSheetStopRow,
} from "@workspace/db";
import {
  canAccessLocation,
  requireAccount,
  requireActiveMembership,
  requirePermission,
} from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership, requirePermission("edit_store_inventory"));

const conditionValues = ["unchecked", "ok", "needs_attention"] as const;
const priorityValues = ["none", "low", "medium", "high", "urgent"] as const;

const itemSchema = z.object({
  id: z.number().int().optional(),
  itemId: z.number().int().nullable().optional(),
  productName: z.string().trim().min(1, "Product is required"),
  parLevel: z.coerce.number().int().min(0).default(0),
  restockQty: z.coerce.number().int().min(0).default(0),
  notes: z.string().trim().default(""),
});

const stopSchema = z.object({
  id: z.number().int().optional(),
  locationId: z.number().int().nullable().optional(),
  routeOrder: z.coerce.number().int().min(0).default(0),
  locationName: z.string().trim().min(1, "Location is required"),
  address: z.string().trim().default(""),
  contact: z.string().trim().default(""),
  machineTypes: z.string().trim().default(""),
  machineClean: z.enum(conditionValues).default("unchecked"),
  machineWorking: z.enum(conditionValues).default("unchecked"),
  paymentSystem: z.enum(conditionValues).default("unchecked"),
  cashCollected: z.coerce.number().min(0).default(0),
  cashBagNumber: z.string().trim().default(""),
  meterReading: z.string().trim().default(""),
  issueDescription: z.string().trim().default(""),
  issuePriority: z.enum(priorityValues).default("none"),
  beforePhotoUrl: z.string().trim().nullable().optional(),
  afterPhotoUrl: z.string().trim().nullable().optional(),
  notes: z.string().trim().default(""),
  items: z.array(itemSchema).default([]),
});

const sheetSchema = z.object({
  employee: z.string().trim().min(1, "Employee is required"),
  routeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Route date is required"),
  van: z.string().trim().default(""),
  day: z.string().trim().default(""),
  routeName: z.string().trim().min(1, "Route name is required"),
  status: z.enum(["draft", "in_progress", "completed"]).default("draft"),
  notes: z.string().trim().nullable().optional(),
  stops: z.array(stopSchema).default([]),
});

type SheetInput = z.infer<typeof sheetSchema>;

type RouteSheetDetail = RouteSheetRow & {
  stops: Array<RouteSheetStopRow & { items: RouteSheetStopItemRow[] }>;
};

function parseId(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

function asDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "");
}

function serializeSheet(row: RouteSheetRow) {
  return {
    id: row.id,
    employee: row.employee,
    routeDate: asDateString(row.routeDate),
    van: row.van,
    day: row.day,
    routeName: row.routeName,
    status: row.status,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeStop(row: RouteSheetStopRow, items: RouteSheetStopItemRow[]) {
  return {
    id: row.id,
    locationId: row.locationId,
    routeOrder: row.routeOrder,
    locationName: row.locationName,
    address: row.address,
    contact: row.contact,
    machineTypes: row.machineTypes,
    machineClean: row.machineClean,
    machineWorking: row.machineWorking,
    paymentSystem: row.paymentSystem,
    cashCollected: row.cashCollected,
    cashBagNumber: row.cashBagNumber,
    meterReading: row.meterReading,
    issueDescription: row.issueDescription,
    issuePriority: row.issuePriority,
    beforePhotoUrl: row.beforePhotoUrl,
    afterPhotoUrl: row.afterPhotoUrl,
    notes: row.notes,
    items: items.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      productName: item.productName,
      parLevel: item.parLevel,
      restockQty: item.restockQty,
      notes: item.notes,
    })),
  };
}

function serializeDetail(detail: RouteSheetDetail) {
  return {
    ...serializeSheet(detail),
    stops: detail.stops
      .sort((a, b) => a.routeOrder - b.routeOrder || a.id - b.id)
      .map((stop) => serializeStop(stop, stop.items)),
  };
}

async function resolveLocationForStop(req: Request, res: Response, locationName: string): Promise<number | null | false> {
  const [row] = await db
    .select()
    .from(locationsTable)
    .where(and(eq(locationsTable.accountId, req.account!.id), eq(locationsTable.name, locationName)))
    .limit(1);

  if (row?.status === "active") {
    if ((req.allowedLocationIds ?? []).includes(row.id) || canAccessLocation(req, row.name)) return row.id;
    res.status(403).json({ error: `You do not have access to ${locationName}` });
    return false;
  }

  if (canAccessLocation(req, locationName)) return null;

  res.status(403).json({ error: `You do not have access to ${locationName}` });
  return false;
}

async function validateStopLocations(req: Request, res: Response, stops: SheetInput["stops"]) {
  const resolved = new Map<number, number | null>();
  for (let index = 0; index < stops.length; index += 1) {
    const locationId = await resolveLocationForStop(req, res, stops[index].locationName);
    if (locationId === false) return null;
    resolved.set(index, locationId);
  }
  return resolved;
}

async function loadDetail(accountId: number, id: number): Promise<RouteSheetDetail | null> {
  const [sheet] = await db
    .select()
    .from(routeSheetsTable)
    .where(and(eq(routeSheetsTable.id, id), eq(routeSheetsTable.accountId, accountId)))
    .limit(1);

  if (!sheet) return null;

  const stops = await db
    .select()
    .from(routeSheetStopsTable)
    .where(and(eq(routeSheetStopsTable.accountId, accountId), eq(routeSheetStopsTable.routeSheetId, id)))
    .orderBy(asc(routeSheetStopsTable.routeOrder), asc(routeSheetStopsTable.id));

  const stopsWithItems = [] as RouteSheetDetail["stops"];
  for (const stop of stops) {
    const items = await db
      .select()
      .from(routeSheetStopItemsTable)
      .where(and(eq(routeSheetStopItemsTable.accountId, accountId), eq(routeSheetStopItemsTable.routeSheetStopId, stop.id)))
      .orderBy(asc(routeSheetStopItemsTable.id));
    stopsWithItems.push({ ...stop, items });
  }

  return { ...sheet, stops: stopsWithItems };
}

async function saveStops(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  accountId: number,
  sheetId: number,
  stops: SheetInput["stops"],
  locationIds: Map<number, number | null>,
) {
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const [insertedStop] = await tx
      .insert(routeSheetStopsTable)
      .values({
        accountId,
        routeSheetId: sheetId,
        locationId: locationIds.get(index) ?? null,
        routeOrder: stop.routeOrder,
        locationName: stop.locationName,
        address: stop.address,
        contact: stop.contact,
        machineTypes: stop.machineTypes,
        machineClean: stop.machineClean,
        machineWorking: stop.machineWorking,
        paymentSystem: stop.paymentSystem,
        cashCollected: stop.cashCollected,
        cashBagNumber: stop.cashBagNumber,
        meterReading: stop.meterReading,
        issueDescription: stop.issueDescription,
        issuePriority: stop.issuePriority,
        beforePhotoUrl: stop.beforePhotoUrl || null,
        afterPhotoUrl: stop.afterPhotoUrl || null,
        notes: stop.notes,
      })
      .returning();

    if (stop.items.length > 0) {
      await tx.insert(routeSheetStopItemsTable).values(
        stop.items.map((item) => ({
          accountId,
          routeSheetStopId: insertedStop.id,
          itemId: item.itemId ?? null,
          productName: item.productName,
          parLevel: item.parLevel,
          restockQty: item.restockQty,
          notes: item.notes,
        })),
      );
    }
  }
}

router.get("/route-sheets", async (req, res) => {
  const status = req.query.status as string | undefined;
  const where = status && status !== "all"
    ? and(eq(routeSheetsTable.accountId, req.account!.id), eq(routeSheetsTable.status, status))
    : eq(routeSheetsTable.accountId, req.account!.id);

  const rows = await db
    .select({
      id: routeSheetsTable.id,
      accountId: routeSheetsTable.accountId,
      employee: routeSheetsTable.employee,
      routeDate: routeSheetsTable.routeDate,
      van: routeSheetsTable.van,
      day: routeSheetsTable.day,
      routeName: routeSheetsTable.routeName,
      status: routeSheetsTable.status,
      notes: routeSheetsTable.notes,
      createdBy: routeSheetsTable.createdBy,
      createdAt: routeSheetsTable.createdAt,
      updatedAt: routeSheetsTable.updatedAt,
      stopCount: sql<number>`count(${routeSheetStopsTable.id})::int`,
    })
    .from(routeSheetsTable)
    .leftJoin(routeSheetStopsTable, and(eq(routeSheetStopsTable.routeSheetId, routeSheetsTable.id), eq(routeSheetStopsTable.accountId, req.account!.id)))
    .where(where)
    .groupBy(routeSheetsTable.id)
    .orderBy(desc(routeSheetsTable.routeDate), desc(routeSheetsTable.createdAt));

  res.json(rows.map((row) => ({ ...serializeSheet(row), stopCount: row.stopCount })));
});

router.get("/route-sheets/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid route sheet id" });
    return;
  }

  const detail = await loadDetail(req.account!.id, id);
  if (!detail) {
    res.status(404).json({ error: "Route sheet not found" });
    return;
  }

  res.json(serializeDetail(detail));
});

router.post("/route-sheets", async (req, res) => {
  const parsed = sheetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const locationIds = await validateStopLocations(req, res, parsed.data.stops);
  if (!locationIds) return;

  const result = await db.transaction(async (tx) => {
    const [sheet] = await tx
      .insert(routeSheetsTable)
      .values({
        accountId: req.account!.id,
        employee: parsed.data.employee,
        routeDate: parsed.data.routeDate,
        van: parsed.data.van,
        day: parsed.data.day,
        routeName: parsed.data.routeName,
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
        createdBy: req.authUser?.displayName ?? req.authUser?.username ?? null,
      })
      .returning();

    await saveStops(tx, req.account!.id, sheet.id, parsed.data.stops, locationIds);
    return sheet;
  });

  const detail = await loadDetail(req.account!.id, result.id);
  res.status(201).json(detail ? serializeDetail(detail) : serializeSheet(result));
});

router.put("/route-sheets/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid route sheet id" });
    return;
  }

  const parsed = sheetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await loadDetail(req.account!.id, id);
  if (!existing) {
    res.status(404).json({ error: "Route sheet not found" });
    return;
  }

  const locationIds = await validateStopLocations(req, res, parsed.data.stops);
  if (!locationIds) return;

  await db.transaction(async (tx) => {
    await tx
      .update(routeSheetsTable)
      .set({
        employee: parsed.data.employee,
        routeDate: parsed.data.routeDate,
        van: parsed.data.van,
        day: parsed.data.day,
        routeName: parsed.data.routeName,
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(routeSheetsTable.id, id), eq(routeSheetsTable.accountId, req.account!.id)));

    await tx
      .delete(routeSheetStopsTable)
      .where(and(eq(routeSheetStopsTable.accountId, req.account!.id), eq(routeSheetStopsTable.routeSheetId, id)));

    await saveStops(tx, req.account!.id, id, parsed.data.stops, locationIds);
  });

  const detail = await loadDetail(req.account!.id, id);
  res.json(detail ? serializeDetail(detail) : null);
});

export default router;


