import { index, pgTable, serial, text, integer, real, date, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { warehousesTable } from "./warehouses";

export const WAREHOUSE_VENDORS = ["Costco", "Sam's Club", "Vistar", "Walmart", "Pepsi Corp", "Other"] as const;
export type WarehouseVendor = (typeof WAREHOUSE_VENDORS)[number];

export const warehousePurchasesTable = pgTable(
  "warehouse_purchases",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
    warehouseItemId: integer("warehouse_item_id").notNull(),
    vendor: text("vendor").notNull(),
    caseCost: real("case_cost").notNull(),
    casesReceived: integer("cases_received").notNull().default(1),
    unitsPerCase: integer("units_per_case").notNull().default(1),
    totalUnits: integer("total_units").notNull(),
    costPerUnit: real("cost_per_unit").notNull(),
    purchaseDate: date("purchase_date").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountWarehouseIdx: index("warehouse_purchases_account_warehouse_idx").on(table.accountId, table.warehouseId),
    accountCreatedAtIdx: index("warehouse_purchases_account_created_at_idx").on(table.accountId, table.createdAt),
    accountItemCreatedAtIdx: index("warehouse_purchases_account_item_created_idx").on(
      table.accountId,
      table.warehouseItemId,
      table.createdAt,
    ),
  }),
);

export type WarehousePurchaseRow = typeof warehousePurchasesTable.$inferSelect;
export type InsertWarehousePurchaseRow = typeof warehousePurchasesTable.$inferInsert;
