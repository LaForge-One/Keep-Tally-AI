-- BASELINE WARNING:
-- This migration is for brand-new, empty databases only.
-- Do not apply it to an existing Replit, staging, or production database
-- that already contains KeepTally tables. Existing databases must be
-- baselined/adopted manually after schema comparison and backup.

CREATE TABLE "items" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "par_level" integer DEFAULT 0 NOT NULL,
  "location" text NOT NULL,
  "barcode" text,
  "last_updated" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history" (
  "id" serial PRIMARY KEY NOT NULL,
  "item_id" integer,
  "item_name" text NOT NULL,
  "action" text NOT NULL,
  "field" text,
  "previous_value" text,
  "new_value" text,
  "note" text,
  "source" text DEFAULT 'ui' NOT NULL,
  "performed_by" text,
  "performed_by_role" text,
  "location" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "location" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "notes" text,
  "archived_at" timestamp with time zone,
  "archived_by" text,
  "deleted_at" timestamp with time zone,
  "deleted_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "display_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text DEFAULT 'stocker' NOT NULL,
  "assigned_locations" text[] DEFAULT '{}' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "must_change_password" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "role" text NOT NULL,
  "permission_key" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "barcode" text,
  "category" text DEFAULT 'Uncategorized' NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "min_par" integer DEFAULT 0 NOT NULL,
  "max_par" integer DEFAULT 0 NOT NULL,
  "reorder_point" integer DEFAULT 0 NOT NULL,
  "case_cost" real,
  "units_per_case" integer DEFAULT 1 NOT NULL,
  "cost_per_unit" real,
  "last_purchase_date" date,
  "last_updated" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_purchases" (
  "id" serial PRIMARY KEY NOT NULL,
  "warehouse_item_id" integer NOT NULL,
  "vendor" text NOT NULL,
  "case_cost" real NOT NULL,
  "cases_received" integer DEFAULT 1 NOT NULL,
  "units_per_case" integer DEFAULT 1 NOT NULL,
  "total_units" integer NOT NULL,
  "cost_per_unit" real NOT NULL,
  "purchase_date" date NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_transfers" (
  "id" serial PRIMARY KEY NOT NULL,
  "warehouse_item_id" integer NOT NULL,
  "warehouse_item_name" text NOT NULL,
  "store_item_id" integer,
  "store_location" text NOT NULL,
  "units_transferred" integer NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "barcode" text NOT NULL,
  "item_id" integer,
  "item_name" text,
  "location" text,
  "action" text NOT NULL,
  "qty_change" integer,
  "reason" text,
  "notes" text,
  "operator" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "item_id" integer,
  "item_name" text NOT NULL,
  "category" text NOT NULL,
  "ordered_qty" integer DEFAULT 0 NOT NULL,
  "picked_qty" integer,
  "received_qty" integer
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;
