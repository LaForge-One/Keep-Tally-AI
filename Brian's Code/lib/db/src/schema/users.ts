import { index, pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";

export const USER_ROLES = ["admin", "warehouse", "stocker"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("stocker"),
    assignedLocations: text("assigned_locations").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountIdx: index("users_account_idx").on(table.accountId),
  }),
);

export type UserRow = typeof usersTable.$inferSelect;
export type InsertUserRow = typeof usersTable.$inferInsert;

export const PERMISSION_KEYS = [
  "manage_users",
  "delete_items",
  "edit_settings",
  "view_costs",
  "view_all_reports",
  "edit_warehouse",
  "receive_purchases",
  "transfer_inventory",
  "view_warehouse",
  "edit_store_inventory",
  "scan_barcodes",
  "use_voice_mode",
  "mark_adjustments",
  "view_all_locations",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  manage_users: "Manage Users",
  delete_items: "Delete Items",
  edit_settings: "Edit Settings",
  view_costs: "View Cost & Pricing Data",
  view_all_reports: "View Company-Wide Reports",
  edit_warehouse: "Edit Warehouse Inventory",
  receive_purchases: "Receive Purchases",
  transfer_inventory: "Transfer Inventory to Stores",
  view_warehouse: "View Warehouse",
  edit_store_inventory: "Edit Store Inventory",
  scan_barcodes: "Scan Barcodes",
  use_voice_mode: "Use Voice Count Mode",
  mark_adjustments: "Mark Theft / Spoilage / Adjustments",
  view_all_locations: "View All Locations",
};

export const DEFAULT_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  admin: [...PERMISSION_KEYS],
  warehouse: [
    "view_warehouse",
    "edit_warehouse",
    "receive_purchases",
    "transfer_inventory",
    "edit_store_inventory",
    "scan_barcodes",
    "use_voice_mode",
    "mark_adjustments",
    "view_all_locations",
  ],
  stocker: [
    "scan_barcodes",
    "use_voice_mode",
    "edit_store_inventory",
    "mark_adjustments",
  ],
};

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    permissionKey: text("permission_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountRoleIdx: index("role_permissions_account_role_idx").on(table.accountId, table.role),
  }),
);

export type RolePermissionRow = typeof rolePermissionsTable.$inferSelect;
