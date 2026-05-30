import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, lt, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  ordersTable,
  orderItemsTable,
  itemsTable,
  historyTable,
  locationsTable,
  type LocationRow,
  type OrderRow,
} from "@workspace/db";
import {
  canAccessLocation,
  canViewAllLocations,
  requireAccount,
  requireActiveMembership,
  requirePermission,
} from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership, requirePermission("edit_store_inventory"));

function serializeOrder(order: typeof ordersTable.$inferSelect) {
  return {
    id: order.id,
    location: order.location,
    status: order.status,
    notes: order.notes,
    archivedAt: order.archivedAt ? order.archivedAt.toISOString() : null,
    archivedBy: order.archivedBy ?? null,
    deletedAt: order.deletedAt ? order.deletedAt.toISOString() : null,
    deletedBy: order.deletedBy ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function serializeOrderItem(item: typeof orderItemsTable.$inferSelect) {
  return {
    id: item.id,
    orderId: item.orderId,
    itemId: item.itemId,
    itemName: item.itemName,
    category: item.category,
    orderedQty: item.orderedQty,
    pickedQty: item.pickedQty,
    receivedQty: item.receivedQty,
  };
}

function parseId(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
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
    const aOrder = a as { createdAt?: unknown };
    const bOrder = b as { createdAt?: unknown };
    const aTime = aOrder.createdAt instanceof Date ? aOrder.createdAt.getTime() : 0;
    const bTime = bOrder.createdAt instanceof Date ? bOrder.createdAt.getTime() : 0;
    return bTime - aTime;
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
    res.status(403).json({ error: "You do not have access to this location" });
    return null;
  }

  return row;
}

function assertOrderLocationAccess(req: Request, res: Response, order: OrderRow) {
  if (order.locationId === null && canAccessLocation(req, order.location)) return true;
  if (canAccessLocationId(req, order.locationId)) return true;
  res.status(403).json({ error: "You do not have access to this location" });
  return false;
}

function hasDuplicateReceiveItemIds(items: Array<{ id: number }>) {
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.id)) return true;
    seen.add(item.id);
  }
  return false;
}

async function findOrder(req: Request, id: number) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.accountId, req.account!.id)));

  return order ?? null;
}

async function findOrderItem(req: Request, orderId: number, orderItemId: number) {
  const [orderItem] = await db
    .select()
    .from(orderItemsTable)
    .where(
      and(
        eq(orderItemsTable.id, orderItemId),
        eq(orderItemsTable.orderId, orderId),
        eq(orderItemsTable.accountId, req.account!.id),
      )
    );

  return orderItem ?? null;
}

async function assertOrderItemLocation(
  req: Request,
  order: typeof ordersTable.$inferSelect,
  orderItem: typeof orderItemsTable.$inferSelect,
  res: Response,
) {
  if (!orderItem.itemId) return true;

  const [storeItem] = await db
    .select()
    .from(itemsTable)
    .where(and(eq(itemsTable.id, orderItem.itemId), eq(itemsTable.accountId, req.account!.id)));

  if (!storeItem) {
    res.status(400).json({ error: "Order item is not linked to an existing inventory item" });
    return false;
  }

  const locationMatches =
    storeItem.locationId !== null && order.locationId !== null
      ? storeItem.locationId === order.locationId
      : storeItem.location === order.location;

  if (!locationMatches) {
    res.status(400).json({ error: "Order item does not belong to the order location" });
    return false;
  }

  return true;
}

class ReceiveError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// GET /orders?view=active|archived|completed|deleted
router.get("/orders", async (req, res) => {
  const location = req.query.location as string | undefined;
  const view = (req.query.view as string | undefined) ?? "active";
  const isAdmin = req.authUser?.role === "admin";

  const resolvedLocation = location ? await resolveLocationByName(req, res, location) : null;
  if (location && !resolvedLocation) return;

  const permittedLocationIds = allowedLocationIds(req);
  const legacyLocations = assignedLocations(req);
  if (!location && !canViewAllLocations(req) && permittedLocationIds.length === 0 && legacyLocations.length === 0) {
    res.json([]);
    return;
  }

  const rows = resolvedLocation
    ? mergeById([
        await db
          .select()
          .from(ordersTable)
          .where(and(eq(ordersTable.accountId, req.account!.id), eq(ordersTable.locationId, resolvedLocation.id)))
          .orderBy(desc(ordersTable.createdAt)),
        await db
          .select()
          .from(ordersTable)
          .where(and(eq(ordersTable.accountId, req.account!.id), eq(ordersTable.location, resolvedLocation.name)))
          .orderBy(desc(ordersTable.createdAt)),
      ])
    : canViewAllLocations(req)
      ? await db
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.accountId, req.account!.id))
          .orderBy(desc(ordersTable.createdAt))
      : mergeById([
          permittedLocationIds.length > 0
            ? await db
                .select()
                .from(ordersTable)
                .where(and(eq(ordersTable.accountId, req.account!.id), inArray(ordersTable.locationId, permittedLocationIds)))
                .orderBy(desc(ordersTable.createdAt))
            : [],
          legacyLocations.length > 0
            ? await db
                .select()
                .from(ordersTable)
                .where(and(eq(ordersTable.accountId, req.account!.id), inArray(ordersTable.location, legacyLocations)))
                .orderBy(desc(ordersTable.createdAt))
            : [],
        ]);

  const filtered = rows.filter((r) => {
    if (r.deletedAt !== null && view !== "deleted") return false;

    if (view === "active") {
      return r.deletedAt === null && r.archivedAt === null && r.status !== "received";
    }
    if (view === "archived") {
      return r.deletedAt === null && r.archivedAt !== null;
    }
    if (view === "completed") {
      return r.deletedAt === null && r.status === "received";
    }
    if (view === "deleted") {
      if (!isAdmin) return false;
      return r.deletedAt !== null;
    }
    return r.deletedAt === null;
  });

  const ordersWithCounts = await Promise.all(
    filtered.map(async (order) => {
      const items = await db
        .select()
        .from(orderItemsTable)
        .where(and(eq(orderItemsTable.accountId, req.account!.id), eq(orderItemsTable.orderId, order.id)));
      return { ...serializeOrder(order), itemCount: items.length };
    })
  );

  res.json(ordersWithCounts);
});

// POST /orders
router.post("/orders", async (req, res) => {
  const schema = z.object({
    location: z.string().min(1),
    notes: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { location, notes } = parsed.data;
  const resolvedLocation = await resolveLocationByName(req, res, location);
  if (!resolvedLocation) return;

  const belowPar = await db
    .select()
    .from(itemsTable)
    .where(
      and(
        eq(itemsTable.accountId, req.account!.id),
        eq(itemsTable.locationId, resolvedLocation.id),
        lt(itemsTable.quantity, itemsTable.parLevel)
      )
    )
    .orderBy(itemsTable.category, itemsTable.name);

  const [order] = await db
    .insert(ordersTable)
    .values({ accountId: req.account!.id, locationId: resolvedLocation.id, location: resolvedLocation.name, notes, status: "draft" })
    .returning();

  if (belowPar.length > 0) {
    await db.insert(orderItemsTable).values(
      belowPar.map((item) => ({
        accountId: req.account!.id,
        orderId: order.id,
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        orderedQty: Math.max(0, item.parLevel - item.quantity),
      }))
    );
  }

  const items = await db
    .select()
    .from(orderItemsTable)
    .where(and(eq(orderItemsTable.accountId, req.account!.id), eq(orderItemsTable.orderId, order.id)));

  res.status(201).json({
    ...serializeOrder(order),
    items: items.map(serializeOrderItem),
  });
});

// GET /orders/:id
router.get("/orders/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }

  const order = await findOrder(req, id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!assertOrderLocationAccess(req, res, order)) return;

  const items = await db
    .select()
    .from(orderItemsTable)
    .where(and(eq(orderItemsTable.accountId, req.account!.id), eq(orderItemsTable.orderId, id)))
    .orderBy(orderItemsTable.category, orderItemsTable.itemName);

  res.json({
    ...serializeOrder(order),
    items: items.map(serializeOrderItem),
  });
});

// PATCH /orders/:id
router.patch("/orders/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }

  const schema = z.object({
    status: z.enum(["draft", "sent", "picked", "received"]).optional(),
    notes: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const order = await findOrder(req, id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!assertOrderLocationAccess(req, res, order)) return;

  const [updated] = await db
    .update(ordersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(ordersTable.id, id), eq(ordersTable.accountId, req.account!.id)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(serializeOrder(updated));
});

// POST /orders/:id/archive
router.post("/orders/:id/archive", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }

  const order = await findOrder(req, id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!assertOrderLocationAccess(req, res, order)) return;

  if (order.deletedAt) {
    res.status(400).json({ error: "Cannot archive a deleted pick list" });
    return;
  }

  const now = new Date();
  const isArchiving = order.archivedAt === null;
  const performer = req.authUser?.displayName ?? req.authUser?.username ?? "unknown";
  const role = req.authUser?.role ?? "unknown";

  const [updated] = await db
    .update(ordersTable)
    .set({
      archivedAt: isArchiving ? now : null,
      archivedBy: isArchiving ? performer : null,
      updatedAt: now,
    })
    .where(and(eq(ordersTable.id, id), eq(ordersTable.accountId, req.account!.id)))
    .returning();

  await db.insert(historyTable).values({
    itemId: null,
    accountId: req.account!.id,
    locationId: order.locationId,
    itemName: `Pick List #${id} (${order.location})`,
    action: isArchiving ? "archive_order" : "unarchive_order",
    field: null,
    previousValue: null,
    newValue: null,
    note: isArchiving
      ? `Pick List #${id} archived by ${performer} (${role})`
      : `Pick List #${id} unarchived by ${performer} (${role})`,
    source: "ui",
    performedBy: performer,
    performedByRole: role,
    location: order.location,
  });

  res.json({ ...serializeOrder(updated!), archived: isArchiving });
});

// DELETE /orders/:id
router.delete("/orders/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }

  if (req.authUser?.role !== "admin") {
    res.status(403).json({ error: "Only administrators can permanently delete pick lists" });
    return;
  }

  const order = await findOrder(req, id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!assertOrderLocationAccess(req, res, order)) return;

  const now = new Date();
  const performer = req.authUser?.displayName ?? req.authUser?.username ?? "unknown";
  const role = req.authUser?.role ?? "unknown";

  await db.insert(historyTable).values({
    itemId: null,
    accountId: req.account!.id,
    locationId: order.locationId,
    itemName: `Pick List #${id} (${order.location})`,
    action: "delete_order",
    field: null,
    previousValue: String(order.status),
    newValue: null,
    note: `Pick List #${id} permanently deleted by ${performer} (${role})`,
    source: "ui",
    performedBy: performer,
    performedByRole: role,
    location: order.location,
  });

  await db
    .update(ordersTable)
    .set({ deletedAt: now, deletedBy: performer, updatedAt: now })
    .where(and(eq(ordersTable.id, id), eq(ordersTable.accountId, req.account!.id)));

  res.status(204).send();
});

// PATCH /orders/:id/items/:itemId
router.patch("/orders/:id/items/:itemId", async (req, res) => {
  const orderId = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  if (orderId === null || itemId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const schema = z.object({
    orderedQty: z.number().int().min(0).optional(),
    pickedQty: z.number().int().min(0).nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const order = await findOrder(req, orderId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!assertOrderLocationAccess(req, res, order)) return;

  const orderItem = await findOrderItem(req, orderId, itemId);
  if (!orderItem) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }
  if (!(await assertOrderItemLocation(req, order, orderItem, res))) return;

  const [updated] = await db
    .update(orderItemsTable)
    .set(parsed.data)
    .where(
      and(
        eq(orderItemsTable.id, itemId),
        eq(orderItemsTable.orderId, orderId),
        eq(orderItemsTable.accountId, req.account!.id),
      )
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }

  res.json(serializeOrderItem(updated));
});

// DELETE /orders/:id/items/:itemId
router.delete("/orders/:id/items/:itemId", async (req, res) => {
  const orderId = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  if (orderId === null || itemId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const order = await findOrder(req, orderId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!assertOrderLocationAccess(req, res, order)) return;

  const orderItem = await findOrderItem(req, orderId, itemId);
  if (!orderItem) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }
  if (!(await assertOrderItemLocation(req, order, orderItem, res))) return;

  await db
    .delete(orderItemsTable)
    .where(
      and(
        eq(orderItemsTable.id, itemId),
        eq(orderItemsTable.orderId, orderId),
        eq(orderItemsTable.accountId, req.account!.id),
      )
    );

  res.status(204).send();
});

// POST /orders/:id/receive
router.post("/orders/:id/receive", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }

  const schema = z.object({
    items: z.array(
      z.object({
        id: z.number().int(),
        receivedQty: z.number().int().min(0),
      })
    ),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (hasDuplicateReceiveItemIds(parsed.data.items)) {
    res.status(400).json({ error: "Receive request contains duplicate order items" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, id), eq(ordersTable.accountId, req.account!.id)));

      if (!order) {
        throw new ReceiveError(404, "Order not found");
      }
      if (order.locationId === null ? !canAccessLocation(req, order.location) : !canAccessLocationId(req, order.locationId)) {
        throw new ReceiveError(403, "You do not have access to this location");
      }

      const [receivingOrder] = await tx
        .update(ordersTable)
        .set({ status: "received", updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.id, id),
            eq(ordersTable.accountId, req.account!.id),
            sql`${ordersTable.status} in ('picked', 'sent')`
          )
        )
        .returning();

      if (!receivingOrder) {
        throw new ReceiveError(400, "Order must be in picked or sent status to receive");
      }

      for (const { id: itemId, receivedQty } of parsed.data.items) {
        const [orderItem] = await tx
          .select()
          .from(orderItemsTable)
          .where(
            and(
              eq(orderItemsTable.id, itemId),
              eq(orderItemsTable.orderId, id),
              eq(orderItemsTable.accountId, req.account!.id)
            )
          );

        if (!orderItem) {
          throw new ReceiveError(404, `Order item ${itemId} not found`);
        }
        if (!orderItem.itemId) {
          throw new ReceiveError(400, `Order item ${itemId} is not linked to an inventory item`);
        }

        const [storeItem] = await tx
          .select()
          .from(itemsTable)
          .where(and(eq(itemsTable.id, orderItem.itemId), eq(itemsTable.accountId, req.account!.id)));

        if (!storeItem) {
          throw new ReceiveError(400, "Order item is not linked to an existing inventory item");
        }
        const locationMatches =
          storeItem.locationId !== null && receivingOrder.locationId !== null
            ? storeItem.locationId === receivingOrder.locationId
            : storeItem.location === receivingOrder.location;

        if (!locationMatches) {
          throw new ReceiveError(400, "Order item does not belong to the order location");
        }

        const [updatedOrderItem] = await tx
          .update(orderItemsTable)
          .set({ receivedQty })
          .where(
            and(
              eq(orderItemsTable.id, itemId),
              eq(orderItemsTable.orderId, id),
              eq(orderItemsTable.accountId, req.account!.id)
            )
          )
          .returning();

        if (!updatedOrderItem) {
          throw new ReceiveError(404, `Order item ${itemId} not found`);
        }

        if (receivedQty > 0) {
          const receivingLocationId = receivingOrder.locationId;
          const locationCondition =
            receivingLocationId === null
              ? eq(itemsTable.location, receivingOrder.location)
              : eq(itemsTable.locationId, receivingLocationId);

          const [updatedStoreItem] = await tx
            .update(itemsTable)
            .set({
              quantity: sql`${itemsTable.quantity} + ${receivedQty}`,
              lastUpdated: new Date(),
            })
            .where(
              and(
                eq(itemsTable.id, orderItem.itemId),
                eq(itemsTable.accountId, req.account!.id),
                locationCondition
              )
            )
            .returning();

          if (!updatedStoreItem) {
            throw new ReceiveError(400, "Inventory item was not updated");
          }
        }
      }

      const items = await tx
        .select()
        .from(orderItemsTable)
        .where(and(eq(orderItemsTable.accountId, req.account!.id), eq(orderItemsTable.orderId, id)));

      return { updated: receivingOrder, items };
    });

    res.json({
      ...serializeOrder(result.updated),
      items: result.items.map(serializeOrderItem),
    });
  } catch (error) {
    if (error instanceof ReceiveError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

export default router;
