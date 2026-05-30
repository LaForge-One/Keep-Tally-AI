import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";

export const locationsTable = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountSlugIdx: uniqueIndex("locations_account_slug_idx").on(table.accountId, table.slug),
    accountNameIdx: uniqueIndex("locations_account_name_idx").on(table.accountId, table.name),
  }),
);

export type LocationRow = typeof locationsTable.$inferSelect;
export type InsertLocationRow = typeof locationsTable.$inferInsert;
