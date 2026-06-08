import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountsTable } from "./accounts";
import { usersTable } from "./users";

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }).notNull(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    channels: jsonb("channels").$type<string[]>().notNull().default(sql`'["in_app"]'::jsonb`),
    digestFrequency: text("digest_frequency").notNull().default("instant"),
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountEventIdx: index("notification_preferences_account_event_idx").on(table.accountId, table.eventType),
    accountUserEventIdx: uniqueIndex("notification_preferences_account_user_event_idx").on(
      table.accountId,
      table.userId,
      table.eventType,
    ),
  }),
);

export const notificationEventsTable = pgTable(
  "notification_events",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }).notNull(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountUserReadCreatedIdx: index("notification_events_account_user_read_created_idx").on(
      table.accountId,
      table.userId,
      table.readAt,
      table.createdAt,
    ),
    accountEventCreatedIdx: index("notification_events_account_event_created_idx").on(
      table.accountId,
      table.eventType,
      table.createdAt,
    ),
    accountUserDedupeIdx: uniqueIndex("notification_events_account_user_dedupe_idx").on(
      table.accountId,
      table.userId,
      table.dedupeKey,
    ),
  }),
);

export type NotificationPreferenceRow = typeof notificationPreferencesTable.$inferSelect;
export type InsertNotificationPreferenceRow = typeof notificationPreferencesTable.$inferInsert;
export type NotificationEventRow = typeof notificationEventsTable.$inferSelect;
export type InsertNotificationEventRow = typeof notificationEventsTable.$inferInsert;
