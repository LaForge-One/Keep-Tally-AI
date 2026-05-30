import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { usersTable } from "./users";

export const accountMembershipsTable = pgTable(
  "account_memberships",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("stocker"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountUserIdx: uniqueIndex("account_memberships_account_user_idx").on(table.accountId, table.userId),
  }),
);

export type AccountMembershipRow = typeof accountMembershipsTable.$inferSelect;
export type InsertAccountMembershipRow = typeof accountMembershipsTable.$inferInsert;
