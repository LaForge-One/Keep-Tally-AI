import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { locationsTable } from "./locations";

export const itemsTable = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    quantity: integer("quantity").notNull().default(0),
    parLevel: integer("par_level").notNull().default(0),
    location: text("location").notNull(),
    barcode: text("barcode"),
    lastUpdated: timestamp("last_updated", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    accountLocationIdx: index("items_account_location_idx").on(table.accountId, table.locationId),
    accountLocationNameIdx: index("items_account_location_name_idx").on(table.accountId, table.locationId, table.name),
    accountLegacyLocationNameIdx: index("items_account_legacy_location_name_idx").on(table.accountId, table.location, table.name),
    accountBarcodeIdx: index("items_account_barcode_idx").on(table.accountId, table.barcode),
  }),
);

export type ItemRow = typeof itemsTable.$inferSelect;
export type InsertItemRow = typeof itemsTable.$inferInsert;
