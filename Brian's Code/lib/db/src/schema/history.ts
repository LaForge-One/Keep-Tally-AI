import { index, pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { locationsTable } from "./locations";

export const historyTable = pgTable(
  "history",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    itemId: integer("item_id"),
    itemName: text("item_name").notNull(),
    action: text("action").notNull(),
    field: text("field"),
    previousValue: text("previous_value"),
    newValue: text("new_value"),
    note: text("note"),
    source: text("source").notNull().default("ui"),
    performedBy: text("performed_by"),
    performedByRole: text("performed_by_role"),
    location: text("location"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    accountLocationIdx: index("history_account_location_idx").on(table.accountId, table.locationId),
    accountCreatedAtIdx: index("history_account_created_at_idx").on(table.accountId, table.createdAt),
    accountItemCreatedAtIdx: index("history_account_item_created_idx").on(
      table.accountId,
      table.itemId,
      table.createdAt,
    ),
  }),
);

export type HistoryRow = typeof historyTable.$inferSelect;
export type InsertHistoryRow = typeof historyTable.$inferInsert;
