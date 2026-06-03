import { index, pgTable, serial, text, integer, real, date, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { productsTable } from "./products";
import { warehousesTable } from "./warehouses";

export const warehouseItemsTable = pgTable(
  "warehouse_items",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
    warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    barcode: text("barcode"),
    category: text("category").notNull().default("Uncategorized"),
    quantity: integer("quantity").notNull().default(0),
    minPar: integer("min_par").notNull().default(0),
    maxPar: integer("max_par").notNull().default(0),
    reorderPoint: integer("reorder_point").notNull().default(0),
    caseCost: real("case_cost"),
    unitsPerCase: integer("units_per_case").notNull().default(1),
    costPerUnit: real("cost_per_unit"),
    lastPurchaseDate: date("last_purchase_date"),
    lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountWarehouseIdx: index("warehouse_items_account_warehouse_idx").on(table.accountId, table.warehouseId),
    accountProductWarehouseIdx: index("warehouse_items_account_product_warehouse_idx").on(table.accountId, table.productId, table.warehouseId),
    accountBarcodeIdx: index("warehouse_items_account_barcode_idx").on(table.accountId, table.barcode),
    accountWarehouseCategoryNameIdx: index("warehouse_items_account_warehouse_category_name_idx").on(
      table.accountId,
      table.warehouseId,
      table.category,
      table.name,
    ),
  }),
);

export type WarehouseItemRow = typeof warehouseItemsTable.$inferSelect;
export type InsertWarehouseItemRow = typeof warehouseItemsTable.$inferInsert;
