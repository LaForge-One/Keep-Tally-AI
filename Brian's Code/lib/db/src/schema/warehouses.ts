import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { locationsTable } from "./locations";

export const warehousesTable = pgTable(
  "warehouses",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountSlugIdx: uniqueIndex("warehouses_account_slug_idx").on(table.accountId, table.slug),
  }),
);

export type WarehouseRow = typeof warehousesTable.$inferSelect;
export type InsertWarehouseRow = typeof warehousesTable.$inferInsert;
