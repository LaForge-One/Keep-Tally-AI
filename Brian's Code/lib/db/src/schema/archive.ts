import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { locationsTable } from "./locations";

export const stockoutEventsTable = pgTable(
  "stockout_events",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id"),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    itemName: text("item_name").notNull(),
    locationName: text("location_name"),
    category: text("category").notNull().default("Uncategorized"),
    status: text("status").notNull().default("open"),
    quantityAtOpen: integer("quantity_at_open").notNull().default(0),
    minQuantity: integer("min_quantity").notNull().default(0),
    maxQuantity: integer("max_quantity").notNull().default(0),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionQuantity: integer("resolution_quantity"),
    source: text("source").notNull().default("inventory_history"),
    evidence: text("evidence").notNull().default("history_transition"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountStatusOpenedIdx: index("stockout_events_account_status_opened_idx").on(
      table.accountId,
      table.status,
      table.openedAt,
    ),
    accountItemStatusIdx: index("stockout_events_account_item_status_idx").on(
      table.accountId,
      table.itemId,
      table.status,
    ),
    accountLocationStatusOpenedIdx: index("stockout_events_account_location_status_opened_idx").on(
      table.accountId,
      table.locationId,
      table.status,
      table.openedAt,
    ),
  }),
);

export type StockoutEventRow = typeof stockoutEventsTable.$inferSelect;
export type InsertStockoutEventRow = typeof stockoutEventsTable.$inferInsert;
