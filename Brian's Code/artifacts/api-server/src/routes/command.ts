import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db,
  itemsTable,
  historyTable,
  locationsTable,
  type ItemRow,
  type LocationRow,
  type PermissionKey,
} from "@workspace/db";
import { RunCommandBody } from "@workspace/api-zod";
import {
  parseCommand,
  findBestItem,
} from "../lib/commandParser";
import { canAccessLocation, canViewAllLocations, requireAccount, requireActiveMembership } from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

type CommandResultPayload = {
  success: boolean;
  message: string;
  action: {
    kind: string;
    itemId: number | null;
    itemName: string;
    location: string | null;
    previousQuantity: number | null;
    newQuantity: number | null;
    delta: number | null;
  } | null;
};

async function applyQuantityChange(
  req: Request,
  item: ItemRow,
  newQuantity: number,
  source: "command",
  note: string,
): Promise<ItemRow> {
  const safeQuantity = Math.max(0, Math.floor(newQuantity));
  const [updated] = await db
    .update(itemsTable)
    .set({ quantity: safeQuantity, lastUpdated: new Date() })
    .where(and(eq(itemsTable.id, item.id), eq(itemsTable.accountId, req.account!.id)))
    .returning();
  if (!updated) throw new Error("Failed to update item");
  await db.insert(historyTable).values({
    accountId: req.account!.id,
    locationId: updated.locationId,
    itemId: updated.id,
    itemName: updated.name,
    action: "command",
    field: "quantity",
    previousValue: String(item.quantity),
    newValue: String(safeQuantity),
    note,
    source,
    performedBy: req.authUser?.displayName ?? req.authUser?.username,
    performedByRole: req.authUser?.role,
    location: updated.location,
  });
  return updated;
}

function hasPermission(req: Request, key: PermissionKey): boolean {
  const permissions = req.permissions ?? req.authUser?.permissions;
  return Boolean(permissions?.has(key));
}

function denyPermission(res: Response, key: PermissionKey): void {
  res.status(403).json({ error: `Permission denied: ${key}` });
}

function denyLocation(res: Response): void {
  res.status(403).json({ error: "Permission denied for this location" });
}

async function loadCommandItems(req: Request): Promise<ItemRow[]> {
  if (canViewAllLocations(req)) {
    return db.select().from(itemsTable).where(eq(itemsTable.accountId, req.account!.id));
  }

  const allowedLocationIds = req.allowedLocationIds ?? [];
  const assignedLocations = req.authUser?.assignedLocations ?? [];
  if (allowedLocationIds.length === 0 && assignedLocations.length === 0) return [];

  if (allowedLocationIds.length > 0 && assignedLocations.length > 0) {
    return db
      .select()
      .from(itemsTable)
      .where(
        and(
          eq(itemsTable.accountId, req.account!.id),
          or(inArray(itemsTable.locationId, allowedLocationIds), inArray(itemsTable.location, assignedLocations)),
        ),
      );
  }

  if (allowedLocationIds.length > 0) {
    return db.select().from(itemsTable).where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.locationId, allowedLocationIds)));
  }

  return db.select().from(itemsTable).where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.location, assignedLocations)));
}

function canAccessItem(req: Request, item: ItemRow): boolean {
  if (canViewAllLocations(req)) return true;
  if (item.locationId !== null && (req.allowedLocationIds ?? []).includes(item.locationId)) return true;
  return canAccessLocation(req, item.location);
}

function normalizeHint(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function itemMatchesCommandHints(item: ItemRow, locationHint: string | null, categoryHint: string | null): boolean {
  if (locationHint) {
    const itemLocation = normalizeHint(item.location);
    const commandLocation = normalizeHint(locationHint);
    if (!(itemLocation === commandLocation || itemLocation.includes(commandLocation) || commandLocation.includes(itemLocation))) {
      return false;
    }
  }

  if (categoryHint) {
    const itemCategory = normalizeHint(item.category);
    const commandCategory = normalizeHint(categoryHint);
    if (!(itemCategory === commandCategory || itemCategory.includes(commandCategory) || commandCategory.includes(itemCategory))) {
      return false;
    }
  }

  return true;
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
    denyLocation(res);
    return null;
  }

  return row;
}

router.post("/command", async (req, res) => {
  const parsed = RunCommandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const text = parsed.data.text.trim();
  if (!text) {
    res.status(400).json({ error: "Command text is required" });
    return;
  }

  const commandItems = await loadCommandItems(req);
  let cmd;
  try {
    cmd = await parseCommand(text, commandItems);
  } catch (err) {
    req.log.error({ err }, "Command parsing failed");
    res.status(200).json({
      success: false,
      message:
        "Could not interpret that command right now. Try something like 'Set Coke Zero in Mesa to 24'.",
      action: null,
    } satisfies CommandResultPayload);
    return;
  }

  if (cmd.kind === "unknown") {
    res.json({
      success: false,
      message: `I couldn't understand that. ${cmd.reason}`,
      action: null,
    } satisfies CommandResultPayload);
    return;
  }

  if (cmd.kind === "create") {
    if (!hasPermission(req, "edit_store_inventory")) {
      denyPermission(res, "edit_store_inventory");
      return;
    }
    const resolvedLocation = await resolveLocationByName(req, res, cmd.location ?? "Unassigned");
    if (!resolvedLocation) return;

    const [created] = await db
      .insert(itemsTable)
      .values({
        accountId: req.account!.id,
        locationId: resolvedLocation.id,
        name: cmd.itemName,
        category: cmd.category ?? "Uncategorized",
        quantity: Math.max(0, Math.floor(cmd.quantity)),
        parLevel: Math.max(0, Math.floor(cmd.parLevel ?? 0)),
        minQuantity: Math.max(0, Math.floor(cmd.parLevel ?? 0)),
        maxQuantity: Math.max(
          Math.max(0, Math.floor(cmd.parLevel ?? 0)),
          Math.max(0, Math.floor(cmd.quantity)),
          Math.max(0, Math.floor(cmd.parLevel ?? 0)) * 2,
        ),
        location: resolvedLocation.name,
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: "Failed to create item" });
      return;
    }
    await db.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: created.locationId,
      itemId: created.id,
      itemName: created.name,
      action: "create",
      field: null,
      previousValue: null,
      newValue: `${created.quantity} @ ${created.location}`,
      note: text,
      source: "command",
      performedBy: req.authUser?.displayName ?? req.authUser?.username,
      performedByRole: req.authUser?.role,
      location: created.location,
    });
    res.json({
      success: true,
      message: `Created ${created.name} (${created.quantity}) at ${created.location}.`,
      action: {
        kind: "create",
        itemId: created.id,
        itemName: created.name,
        location: created.location,
        previousQuantity: null,
        newQuantity: created.quantity,
        delta: created.quantity,
      },
    } satisfies CommandResultPayload);
    return;
  }

  const itemHint =
    cmd.kind === "delete" ? cmd.itemHint : "itemHint" in cmd ? cmd.itemHint : "";
  const locationHint =
    "locationHint" in cmd ? cmd.locationHint ?? null : null;
  const categoryHint =
    "categoryHint" in cmd ? cmd.categoryHint ?? null : null;
  const matchedItemId =
    "matchedItemId" in cmd && Number.isInteger(cmd.matchedItemId)
      ? cmd.matchedItemId
      : null;

  if (cmd.kind === "delete") {
    if (!hasPermission(req, "delete_items")) {
      denyPermission(res, "delete_items");
      return;
    }
  } else if (cmd.kind === "set" || cmd.kind === "add" || cmd.kind === "reduce") {
    if (!hasPermission(req, "edit_store_inventory")) {
      denyPermission(res, "edit_store_inventory");
      return;
    }
  }

  if (locationHint) {
    const resolvedLocation = await resolveLocationByName(req, res, locationHint);
    if (!resolvedLocation) return;
  }

  const matchedTarget = matchedItemId
    ? commandItems.find((item) => item.id === matchedItemId && itemMatchesCommandHints(item, locationHint, categoryHint)) ?? null
    : null;
  const target = matchedTarget ?? findBestItem(commandItems, itemHint, locationHint, categoryHint);

  if (!target) {
    res.json({
      success: false,
      message: `No matching item found for "${itemHint}"${
        locationHint ? ` at ${locationHint}` : ""
      }.`,
      action: null,
    } satisfies CommandResultPayload);
    return;
  }

  if (cmd.kind === "delete") {
    if (!canAccessItem(req, target)) {
      denyLocation(res);
      return;
    }
    await db.delete(itemsTable).where(and(eq(itemsTable.id, target.id), eq(itemsTable.accountId, req.account!.id)));
    await db.insert(historyTable).values({
      accountId: req.account!.id,
      locationId: target.locationId,
      itemId: null,
      itemName: target.name,
      action: "delete",
      field: null,
      previousValue: `${target.quantity} @ ${target.location}`,
      newValue: null,
      note: text,
      source: "command",
      performedBy: req.authUser?.displayName ?? req.authUser?.username,
      performedByRole: req.authUser?.role,
      location: target.location,
    });
    res.json({
      success: true,
      message: `Deleted ${target.name} from ${target.location}.`,
      action: {
        kind: "delete",
        itemId: target.id,
        itemName: target.name,
        location: target.location,
        previousQuantity: target.quantity,
        newQuantity: null,
        delta: -target.quantity,
      },
    } satisfies CommandResultPayload);
    return;
  }

  let previousQuantity = target.quantity;
  let newQuantity = previousQuantity;
  let delta = 0;

  if (cmd.kind === "set") {
    newQuantity = Math.max(0, Math.floor(cmd.newQuantity));
    delta = newQuantity - previousQuantity;
  } else if (cmd.kind === "add") {
    delta = Math.floor(cmd.delta);
    newQuantity = Math.max(0, previousQuantity + delta);
  } else if (cmd.kind === "reduce") {
    delta = -Math.floor(cmd.delta);
    newQuantity = Math.max(0, previousQuantity + delta);
    delta = newQuantity - previousQuantity;
  }

  if (!canAccessItem(req, target)) {
    denyLocation(res);
    return;
  }

  const updated = await applyQuantityChange(req, target, newQuantity, "command", text);

  const verbMessage =
    cmd.kind === "set"
      ? `Set ${updated.name} at ${updated.location} to ${updated.quantity}.`
      : cmd.kind === "add"
        ? `Added ${Math.abs(delta)} to ${updated.name} at ${updated.location} (now ${updated.quantity}).`
        : `Reduced ${updated.name} at ${updated.location} by ${Math.abs(delta)} (now ${updated.quantity}).`;

  res.json({
    success: true,
    message: verbMessage,
    action: {
      kind: cmd.kind,
      itemId: updated.id,
      itemName: updated.name,
      location: updated.location,
      previousQuantity,
      newQuantity: updated.quantity,
      delta,
    },
  } satisfies CommandResultPayload);
});

export default router;
