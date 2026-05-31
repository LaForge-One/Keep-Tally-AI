import { index, integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";
import { locationsTable } from "./locations";
import { usersTable } from "./users";

export const userLocationAssignmentsTable = pgTable(
  "user_location_assignments",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    locationId: integer("location_id").notNull().references(() => locationsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountUserLocationIdx: uniqueIndex("user_location_assignments_account_user_location_idx").on(
      table.accountId,
      table.userId,
      table.locationId,
    ),
    accountUserIdx: index("user_location_assignments_account_user_idx").on(table.accountId, table.userId),
    accountLocationIdx: index("user_location_assignments_account_location_idx").on(table.accountId, table.locationId),
  }),
);

export type UserLocationAssignmentRow = typeof userLocationAssignmentsTable.$inferSelect;
export type InsertUserLocationAssignmentRow = typeof userLocationAssignmentsTable.$inferInsert;
