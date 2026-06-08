import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accountsTable,
  db,
  itemsTable,
  notificationEventsTable,
  notificationPreferencesTable,
  usersTable,
  warehouseItemsTable,
  type InsertNotificationEventRow,
  type NotificationPreferenceRow,
} from "@workspace/db";
import {
  requireAccount,
  requireActiveMembership,
  requirePermission,
} from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

const EVENT_TYPES = [
  "low_stock",
  "out_of_stock",
  "daily_summary",
  "warehouse_reorder",
  "import_notice",
] as const;

const EVENT_LABELS: Record<NotificationEventType, string> = {
  low_stock: "Low-stock alerts",
  out_of_stock: "Out-of-stock alerts",
  daily_summary: "Daily operations summary",
  warehouse_reorder: "Warehouse reorder alerts",
  import_notice: "Import and data-change notices",
};

const DEFAULT_PREFERENCES: Array<Pick<NotificationPreferenceRow, "eventType" | "enabled" | "channels" | "digestFrequency">> = [
  { eventType: "low_stock", enabled: true, channels: ["in_app"], digestFrequency: "instant" },
  { eventType: "out_of_stock", enabled: true, channels: ["in_app"], digestFrequency: "instant" },
  { eventType: "daily_summary", enabled: false, channels: ["in_app", "email"], digestFrequency: "daily" },
  { eventType: "warehouse_reorder", enabled: true, channels: ["in_app"], digestFrequency: "instant" },
  { eventType: "import_notice", enabled: false, channels: ["in_app"], digestFrequency: "instant" },
];

type NotificationEventType = (typeof EVENT_TYPES)[number];

type ActiveUser = {
  id: number;
  role: string;
  assignedLocations: string[];
};

const NotificationPreferenceSchema = z.object({
  eventType: z.enum(EVENT_TYPES),
  enabled: z.boolean(),
  channels: z.array(z.enum(["in_app", "email"])).min(1),
  digestFrequency: z.enum(["instant", "daily", "weekly"]),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

function parseParamId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string") return null;
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function canReceiveStoreEvent(user: ActiveUser, location: string | null) {
  if (user.role === "admin") return true;
  if (!location) return false;
  return user.assignedLocations.length === 0 || user.assignedLocations.includes(location);
}

function canReceiveWarehouseEvent(user: ActiveUser) {
  return user.role === "admin" || user.role === "warehouse";
}

function serializePreference(row: NotificationPreferenceRow) {
  return {
    id: row.id,
    eventType: row.eventType,
    label: EVENT_LABELS[row.eventType as NotificationEventType] ?? row.eventType,
    enabled: row.enabled,
    channels: Array.isArray(row.channels) ? row.channels : ["in_app"],
    digestFrequency: row.digestFrequency,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeEvent(row: typeof notificationEventsTable.$inferSelect) {
  return {
    id: row.id,
    eventType: row.eventType,
    severity: row.severity,
    title: row.title,
    message: row.message,
    payload: row.payload,
    readAt: row.readAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    deliveryStatus: row.deliveryStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ensureDefaultPreferences(accountId: number) {
  const existing = await db
    .select()
    .from(notificationPreferencesTable)
    .where(and(eq(notificationPreferencesTable.accountId, accountId), isNull(notificationPreferencesTable.userId)));
  const existingTypes = new Set(existing.map((row) => row.eventType));
  const missing = DEFAULT_PREFERENCES.filter((pref) => !existingTypes.has(pref.eventType));

  if (missing.length > 0) {
    await db.insert(notificationPreferencesTable).values(
      missing.map((pref) => ({
        accountId,
        userId: null,
        eventType: pref.eventType,
        enabled: pref.enabled,
        channels: pref.channels,
        digestFrequency: pref.digestFrequency,
      })),
    );
  }

  return db
    .select()
    .from(notificationPreferencesTable)
    .where(and(eq(notificationPreferencesTable.accountId, accountId), isNull(notificationPreferencesTable.userId)))
    .orderBy(asc(notificationPreferencesTable.id));
}

function isEnabled(preferences: NotificationPreferenceRow[], eventType: NotificationEventType) {
  const pref = preferences.find((row) => row.eventType === eventType);
  return Boolean(pref?.enabled);
}

async function activeUsers(accountId: number): Promise<ActiveUser[]> {
  return db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      assignedLocations: usersTable.assignedLocations,
    })
    .from(usersTable)
    .where(and(eq(usersTable.accountId, accountId), eq(usersTable.active, true)));
}

async function insertEvents(events: InsertNotificationEventRow[]) {
  if (events.length === 0) return 0;
  await db.insert(notificationEventsTable).values(events).onConflictDoNothing();
  return events.length;
}

async function generateNotificationEventsForAccount(accountId: number) {
  const preferences = await ensureDefaultPreferences(accountId);
  const users = await activeUsers(accountId);
  const events: InsertNotificationEventRow[] = [];
  const now = new Date();

  if (isEnabled(preferences, "out_of_stock") || isEnabled(preferences, "low_stock")) {
    const storeItems = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.accountId, accountId), lt(itemsTable.quantity, itemsTable.minQuantity)))
      .orderBy(asc(itemsTable.quantity), asc(itemsTable.name))
      .limit(50);

    for (const item of storeItems) {
      const eventType: NotificationEventType = item.quantity <= 0 ? "out_of_stock" : "low_stock";
      if (!isEnabled(preferences, eventType)) continue;
      const targetUsers = users.filter((user) => canReceiveStoreEvent(user, item.location));
      for (const user of targetUsers) {
        events.push({
          accountId,
          userId: user.id,
          eventType,
          severity: item.quantity <= 0 ? "critical" : "warning",
          title: item.quantity <= 0 ? `${item.name} is out of stock` : `${item.name} is below minimum`,
          message: `${item.location}: ${item.quantity} on hand, minimum ${item.minQuantity}, target maximum ${item.maxQuantity}.`,
          payload: {
            itemId: item.id,
            location: item.location,
            quantity: item.quantity,
            minQuantity: item.minQuantity,
            maxQuantity: item.maxQuantity,
          },
          dedupeKey: `${eventType}:store:${item.id}:q${item.quantity}:min${item.minQuantity}`,
          deliveryStatus: "delivered",
          deliveredAt: now,
        });
      }
    }
  }

  if (isEnabled(preferences, "warehouse_reorder")) {
    const warehouseRows = await db
      .select()
      .from(warehouseItemsTable)
      .where(
        and(
          eq(warehouseItemsTable.accountId, accountId),
          or(
            lt(warehouseItemsTable.quantity, warehouseItemsTable.minPar),
            sql`${warehouseItemsTable.reorderPoint} > 0 AND ${warehouseItemsTable.quantity} <= ${warehouseItemsTable.reorderPoint}`,
          ),
        ),
      )
      .orderBy(asc(warehouseItemsTable.quantity), asc(warehouseItemsTable.name))
      .limit(50);

    const targetUsers = users.filter(canReceiveWarehouseEvent);
    for (const item of warehouseRows) {
      for (const user of targetUsers) {
        events.push({
          accountId,
          userId: user.id,
          eventType: "warehouse_reorder",
          severity: item.quantity <= 0 ? "critical" : "warning",
          title: `${item.name} needs warehouse attention`,
          message: `Warehouse has ${item.quantity} on hand. Minimum par is ${item.minPar}; reorder point is ${item.reorderPoint}.`,
          payload: {
            warehouseItemId: item.id,
            quantity: item.quantity,
            minPar: item.minPar,
            reorderPoint: item.reorderPoint,
          },
          dedupeKey: `warehouse_reorder:${item.id}:q${item.quantity}:min${item.minPar}:reorder${item.reorderPoint}`,
          deliveryStatus: "delivered",
          deliveredAt: now,
        });
      }
    }
  }

  if (isEnabled(preferences, "daily_summary")) {
    const [storeRisk] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(itemsTable)
      .where(and(eq(itemsTable.accountId, accountId), lt(itemsTable.quantity, itemsTable.minQuantity)));
    const [warehouseRisk] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(warehouseItemsTable)
      .where(and(eq(warehouseItemsTable.accountId, accountId), lt(warehouseItemsTable.quantity, warehouseItemsTable.minPar)));
    const targetUsers = users.filter((user) => user.role === "admin");
    const summaryDate = todayKey(now);
    for (const user of targetUsers) {
      events.push({
        accountId,
        userId: user.id,
        eventType: "daily_summary",
        severity: "info",
        title: "Daily operations summary is ready",
        message: `${storeRisk?.count ?? 0} store items and ${warehouseRisk?.count ?? 0} warehouse items need review.`,
        payload: {
          summaryDate,
          storeRiskCount: storeRisk?.count ?? 0,
          warehouseRiskCount: warehouseRisk?.count ?? 0,
        },
        dedupeKey: `daily_summary:${summaryDate}`,
        deliveryStatus: "pending",
      });
    }
  }

  const attempted = await insertEvents(events);
  logger.info({ accountId, attempted }, "Notification event generation completed");
  return { attempted };
}

async function generateNotificationEventsForAllAccounts() {
  const accounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(eq(accountsTable.active, true));
  let attempted = 0;

  for (const account of accounts) {
    const result = await generateNotificationEventsForAccount(account.id);
    attempted += result.attempted;
  }

  return { accounts: accounts.length, attempted };
}

function startNotificationDigestScheduler() {
  if (process.env.NOTIFICATIONS_DIGEST_SCHEDULER_ENABLED !== "true") return;
  const intervalMinutes = Math.max(Number(process.env.NOTIFICATIONS_DIGEST_INTERVAL_MINUTES ?? 1440), 15);
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info({ intervalMinutes }, "Notification digest scheduler enabled");
  setInterval(() => {
    generateNotificationEventsForAllAccounts().catch((err) => {
      logger.error({ err }, "Notification digest scheduler failed");
    });
  }, intervalMs).unref();
}

router.get("/settings/notifications", requirePermission("edit_settings"), async (req, res) => {
  const preferences = await ensureDefaultPreferences(req.account!.id);
  res.json({
    preferences: preferences.map(serializePreference),
    emailProviderConfigured: Boolean(process.env.NOTIFICATIONS_EMAIL_PROVIDER),
  });
});

router.put("/settings/notifications", requirePermission("edit_settings"), async (req, res) => {
  const schema = z.object({
    preferences: z.array(NotificationPreferenceSchema).length(EVENT_TYPES.length),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  await ensureDefaultPreferences(req.account!.id);
  for (const pref of parsed.data.preferences) {
    await db
      .update(notificationPreferencesTable)
      .set({
        enabled: pref.enabled,
        channels: pref.channels,
        digestFrequency: pref.digestFrequency,
        quietHoursStart: pref.quietHoursStart ?? null,
        quietHoursEnd: pref.quietHoursEnd ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationPreferencesTable.accountId, req.account!.id),
          isNull(notificationPreferencesTable.userId),
          eq(notificationPreferencesTable.eventType, pref.eventType),
        ),
      );
  }

  const preferences = await ensureDefaultPreferences(req.account!.id);
  res.json({ preferences: preferences.map(serializePreference) });
});

router.get("/notifications", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 50);
  const unreadOnly = req.query.unreadOnly === "true";
  const where = unreadOnly
    ? and(
        eq(notificationEventsTable.accountId, req.account!.id),
        eq(notificationEventsTable.userId, req.authUser!.id),
        isNull(notificationEventsTable.readAt),
      )
    : and(
        eq(notificationEventsTable.accountId, req.account!.id),
        eq(notificationEventsTable.userId, req.authUser!.id),
      );

  const rows = await db
    .select()
    .from(notificationEventsTable)
    .where(where)
    .orderBy(desc(notificationEventsTable.createdAt))
    .limit(limit);
  const [unread] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationEventsTable)
    .where(
      and(
        eq(notificationEventsTable.accountId, req.account!.id),
        eq(notificationEventsTable.userId, req.authUser!.id),
        isNull(notificationEventsTable.readAt),
      ),
    );

  res.json({
    unreadCount: unread?.count ?? 0,
    notifications: rows.map(serializeEvent),
  });
});

router.post("/notifications/generate", requirePermission("edit_settings"), async (req, res) => {
  const result = await generateNotificationEventsForAccount(req.account!.id);
  res.json({ ok: true, ...result });
});

router.post("/notifications/:id/read", async (req, res) => {
  const id = parseParamId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }

  await db
    .update(notificationEventsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationEventsTable.accountId, req.account!.id),
        eq(notificationEventsTable.userId, req.authUser!.id),
        eq(notificationEventsTable.id, id),
      ),
    );

  res.json({ ok: true });
});

router.post("/notifications/read-all", async (req, res) => {
  await db
    .update(notificationEventsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationEventsTable.accountId, req.account!.id),
        eq(notificationEventsTable.userId, req.authUser!.id),
        isNull(notificationEventsTable.readAt),
      ),
    );

  res.json({ ok: true });
});

export { generateNotificationEventsForAccount };
export { generateNotificationEventsForAllAccounts, startNotificationDigestScheduler };
export default router;
