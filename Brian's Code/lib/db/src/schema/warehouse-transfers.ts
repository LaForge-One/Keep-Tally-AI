import { index, pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { locationsTable } from "./locations";
import { warehousesTable } from "./warehouses";

export const warehouseTransfersTable = pgTable(
  "warehouse_transfers",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
    storeLocationId: integer("store_location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    warehouseItemId: integer("warehouse_item_id").notNull(),
    warehouseItemName: text("warehouse_item_name").notNull(),
    storeItemId: integer("store_item_id"),
    storeLocation: text("store_location").notNull(),
    unitsTransferred: integer("units_transferred").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountWarehouseIdx: index("warehouse_transfers_account_warehouse_idx").on(table.accountId, table.warehouseId),
    accountStoreLocationIdx: index("warehouse_transfers_account_store_location_idx").on(table.accountId, table.storeLocationId),
    accountWarehouseItemCreatedAtIdx: index("warehouse_transfers_account_warehouse_item_created_idx").on(
      table.accountId,
      table.warehouseItemId,
      table.createdAt,
    ),
    accountStoreItemCreatedAtIdx: index("warehouse_transfers_account_store_item_created_idx").on(
      table.accountId,
      table.storeItemId,
      table.createdAt,
    ),
  }),
);

export type WarehouseTransferRow = typeof warehouseTransfersTable.$inferSelect;
export type InsertWarehouseTransferRow = typeof warehouseTransfersTable.$inferInsert;
