import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { itemsTable } from "./items";
import { locationsTable } from "./locations";
import { usersTable } from "./users";

export const countSessionsTable = pgTable(
  "count_sessions",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    locationName: text("location_name"),
    mode: text("mode").notNull(),
    source: text("source").notNull().default("voice"),
    status: text("status").notNull().default("active"),
    itemCount: integer("item_count").notNull().default(0),
    verifiedCount: integer("verified_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    noResponseCount: integer("no_response_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountStatusStartedIdx: index("count_sessions_account_status_started_idx").on(
      table.accountId,
      table.status,
      table.startedAt,
    ),
    accountLocationStartedIdx: index("count_sessions_account_location_started_idx").on(
      table.accountId,
      table.locationId,
      table.startedAt,
    ),
  }),
);

export const countSessionEventsTable = pgTable(
  "count_session_events",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => countSessionsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    itemId: integer("item_id").references(() => itemsTable.id, { onDelete: "set null" }),
    itemName: text("item_name"),
    eventType: text("event_type").notNull(),
    action: text("action"),
    status: text("status"),
    expectedQuantity: integer("expected_quantity"),
    countedQuantity: integer("counted_quantity"),
    reason: text("reason"),
    transcript: text("transcript"),
    confidence: integer("confidence"),
    message: text("message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountSessionCreatedIdx: index("count_session_events_account_session_created_idx").on(
      table.accountId,
      table.sessionId,
      table.createdAt,
    ),
    accountItemCreatedIdx: index("count_session_events_account_item_created_idx").on(
      table.accountId,
      table.itemId,
      table.createdAt,
    ),
  }),
);

export type CountSessionRow = typeof countSessionsTable.$inferSelect;
export type InsertCountSessionRow = typeof countSessionsTable.$inferInsert;
export type CountSessionEventRow = typeof countSessionEventsTable.$inferSelect;
export type InsertCountSessionEventRow = typeof countSessionEventsTable.$inferInsert;
