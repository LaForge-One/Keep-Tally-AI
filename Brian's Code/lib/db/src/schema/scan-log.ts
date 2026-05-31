import { index, pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { locationsTable } from "./locations";

export const scanLogTable = pgTable(
  "scan_log",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    barcode: text("barcode").notNull(),
    itemId: integer("item_id"),
    itemName: text("item_name"),
    location: text("location"),
    action: text("action").notNull(),
    qtyChange: integer("qty_change"),
    reason: text("reason"),
    notes: text("notes"),
    operator: text("operator"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountLocationIdx: index("scan_log_account_location_idx").on(table.accountId, table.locationId),
    accountCreatedAtIdx: index("scan_log_account_created_at_idx").on(table.accountId, table.createdAt),
    accountItemCreatedAtIdx: index("scan_log_account_item_created_idx").on(
      table.accountId,
      table.itemId,
      table.createdAt,
    ),
  }),
);

export type ScanLogRow = typeof scanLogTable.$inferSelect;
export type InsertScanLogRow = typeof scanLogTable.$inferInsert;
