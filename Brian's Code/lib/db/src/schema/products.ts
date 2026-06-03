import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";

export const productsTable = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull().default("Uncategorized"),
    brand: text("brand"),
    size: text("size"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountStatusNameIdx: index("products_account_status_name_idx").on(table.accountId, table.status, table.name),
    accountCategoryNameIdx: index("products_account_category_name_idx").on(table.accountId, table.category, table.name),
  }),
);

export const productIdentifiersTable = pgTable(
  "product_identifiers",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => productsTable.id, { onDelete: "cascade" }).notNull(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    type: text("type").notNull().default("upc"),
    unitMultiplier: integer("unit_multiplier").notNull().default(1),
    status: text("status").notNull().default("active"),
    primaryForType: boolean("primary_for_type").notNull().default(false),
    source: text("source").notNull().default("legacy_barcode"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => ({
    accountNormalizedCodeIdx: index("product_identifiers_account_normalized_code_idx").on(
      table.accountId,
      table.normalizedCode,
    ),
    accountProductIdx: index("product_identifiers_account_product_idx").on(table.accountId, table.productId),
    accountStatusTypeIdx: index("product_identifiers_account_status_type_idx").on(
      table.accountId,
      table.status,
      table.type,
    ),
  }),
);

export type ProductRow = typeof productsTable.$inferSelect;
export type InsertProductRow = typeof productsTable.$inferInsert;
export type ProductIdentifierRow = typeof productIdentifiersTable.$inferSelect;
export type InsertProductIdentifierRow = typeof productIdentifiersTable.$inferInsert;
