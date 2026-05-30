import { index, pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { itemsTable } from "./items";
import { locationsTable } from "./locations";

export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    location: text("location").notNull(),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: text("archived_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountLocationIdx: index("orders_account_location_idx").on(table.accountId, table.locationId),
    accountStatusIdx: index("orders_account_status_idx").on(table.accountId, table.status),
  }),
);

export const orderItemsTable = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id").references(() => itemsTable.id, { onDelete: "set null" }),
    itemName: text("item_name").notNull(),
    category: text("category").notNull(),
    orderedQty: integer("ordered_qty").notNull().default(0),
    pickedQty: integer("picked_qty"),
    receivedQty: integer("received_qty"),
  },
  (table) => ({
    accountOrderIdx: index("order_items_account_order_idx").on(table.accountId, table.orderId),
  }),
);

export type OrderRow = typeof ordersTable.$inferSelect;
export type InsertOrderRow = typeof ordersTable.$inferInsert;
export type OrderItemRow = typeof orderItemsTable.$inferSelect;
export type InsertOrderItemRow = typeof orderItemsTable.$inferInsert;
