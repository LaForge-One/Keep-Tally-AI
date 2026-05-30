import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  plan: text("plan").notNull().default("legacy"),
  billingEmail: text("billing_email"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccountRow = typeof accountsTable.$inferSelect;
export type InsertAccountRow = typeof accountsTable.$inferInsert;
