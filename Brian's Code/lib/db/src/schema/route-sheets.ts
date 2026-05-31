import { index, integer, pgTable, real, serial, text, timestamp, date } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { itemsTable } from "./items";
import { locationsTable } from "./locations";

export const routeSheetsTable = pgTable(
  "route_sheets",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    employee: text("employee").notNull(),
    routeDate: date("route_date").notNull(),
    van: text("van").notNull().default(""),
    day: text("day").notNull().default(""),
    routeName: text("route_name").notNull(),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountDateIdx: index("route_sheets_account_date_idx").on(table.accountId, table.routeDate),
    accountStatusIdx: index("route_sheets_account_status_idx").on(table.accountId, table.status),
  }),
);

export const routeSheetStopsTable = pgTable(
  "route_sheet_stops",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    routeSheetId: integer("route_sheet_id").notNull().references(() => routeSheetsTable.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    routeOrder: integer("route_order").notNull().default(0),
    locationName: text("location_name").notNull(),
    address: text("address").notNull().default(""),
    contact: text("contact").notNull().default(""),
    machineTypes: text("machine_types").notNull().default(""),
    machineClean: text("machine_clean").notNull().default("unchecked"),
    machineWorking: text("machine_working").notNull().default("unchecked"),
    paymentSystem: text("payment_system").notNull().default("unchecked"),
    cashCollected: real("cash_collected").notNull().default(0),
    cashBagNumber: text("cash_bag_number").notNull().default(""),
    meterReading: text("meter_reading").notNull().default(""),
    issueDescription: text("issue_description").notNull().default(""),
    issuePriority: text("issue_priority").notNull().default("none"),
    beforePhotoUrl: text("before_photo_url"),
    afterPhotoUrl: text("after_photo_url"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountSheetIdx: index("route_sheet_stops_account_sheet_idx").on(table.accountId, table.routeSheetId),
    accountLocationIdx: index("route_sheet_stops_account_location_idx").on(table.accountId, table.locationId),
    accountLocationCreatedAtIdx: index("route_sheet_stops_account_location_created_idx").on(
      table.accountId,
      table.locationId,
      table.createdAt,
    ),
    routeOrderIdx: index("route_sheet_stops_order_idx").on(table.routeSheetId, table.routeOrder),
  }),
);

export const routeSheetStopItemsTable = pgTable(
  "route_sheet_stop_items",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    routeSheetStopId: integer("route_sheet_stop_id").notNull().references(() => routeSheetStopsTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id").references(() => itemsTable.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    parLevel: integer("par_level").notNull().default(0),
    restockQty: integer("restock_qty").notNull().default(0),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountStopIdx: index("route_sheet_stop_items_account_stop_idx").on(table.accountId, table.routeSheetStopId),
    accountItemIdx: index("route_sheet_stop_items_account_item_idx").on(table.accountId, table.itemId),
  }),
);

export type RouteSheetRow = typeof routeSheetsTable.$inferSelect;
export type InsertRouteSheetRow = typeof routeSheetsTable.$inferInsert;
export type RouteSheetStopRow = typeof routeSheetStopsTable.$inferSelect;
export type InsertRouteSheetStopRow = typeof routeSheetStopsTable.$inferInsert;
export type RouteSheetStopItemRow = typeof routeSheetStopItemsTable.$inferSelect;
export type InsertRouteSheetStopItemRow = typeof routeSheetStopItemsTable.$inferInsert;
