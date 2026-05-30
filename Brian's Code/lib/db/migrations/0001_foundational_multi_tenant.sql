CREATE TABLE "accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "plan" text DEFAULT 'legacy' NOT NULL,
  "billing_email" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "accounts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "locations" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "locations_account_slug_idx" ON "locations" ("account_id", "slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "locations_account_name_idx" ON "locations" ("account_id", "name");
--> statement-breakpoint
CREATE TABLE "warehouses" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "location_id" integer REFERENCES "locations"("id") ON DELETE set null,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_account_slug_idx" ON "warehouses" ("account_id", "slug");
--> statement-breakpoint
CREATE TABLE "account_memberships" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "role" text DEFAULT 'stocker' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_memberships_account_user_idx" ON "account_memberships" ("account_id", "user_id");
--> statement-breakpoint
CREATE TABLE "user_location_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "location_id" integer NOT NULL REFERENCES "locations"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_location_assignments_account_user_location_idx" ON "user_location_assignments" ("account_id", "user_id", "location_id");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "location_id" integer REFERENCES "locations"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_id" integer REFERENCES "locations"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "history" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "history" ADD COLUMN "location_id" integer REFERENCES "locations"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "scan_log" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "scan_log" ADD COLUMN "location_id" integer REFERENCES "locations"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "warehouse_items" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "warehouse_items" ADD COLUMN "warehouse_id" integer REFERENCES "warehouses"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "warehouse_purchases" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "warehouse_purchases" ADD COLUMN "warehouse_id" integer REFERENCES "warehouses"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "warehouse_transfers" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "warehouse_transfers" ADD COLUMN "warehouse_id" integer REFERENCES "warehouses"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "warehouse_transfers" ADD COLUMN "store_location_id" integer REFERENCES "locations"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "users_account_idx" ON "users" ("account_id");
--> statement-breakpoint
CREATE INDEX "role_permissions_account_role_idx" ON "role_permissions" ("account_id", "role");
--> statement-breakpoint
CREATE INDEX "items_account_location_idx" ON "items" ("account_id", "location_id");
--> statement-breakpoint
CREATE INDEX "items_account_barcode_idx" ON "items" ("account_id", "barcode");
--> statement-breakpoint
CREATE INDEX "orders_account_location_idx" ON "orders" ("account_id", "location_id");
--> statement-breakpoint
CREATE INDEX "orders_account_status_idx" ON "orders" ("account_id", "status");
--> statement-breakpoint
CREATE INDEX "order_items_account_order_idx" ON "order_items" ("account_id", "order_id");
--> statement-breakpoint
CREATE INDEX "history_account_location_idx" ON "history" ("account_id", "location_id");
--> statement-breakpoint
CREATE INDEX "history_account_created_at_idx" ON "history" ("account_id", "created_at");
--> statement-breakpoint
CREATE INDEX "scan_log_account_location_idx" ON "scan_log" ("account_id", "location_id");
--> statement-breakpoint
CREATE INDEX "scan_log_account_created_at_idx" ON "scan_log" ("account_id", "created_at");
--> statement-breakpoint
CREATE INDEX "warehouse_items_account_warehouse_idx" ON "warehouse_items" ("account_id", "warehouse_id");
--> statement-breakpoint
CREATE INDEX "warehouse_items_account_barcode_idx" ON "warehouse_items" ("account_id", "barcode");
--> statement-breakpoint
CREATE INDEX "warehouse_purchases_account_warehouse_idx" ON "warehouse_purchases" ("account_id", "warehouse_id");
--> statement-breakpoint
CREATE INDEX "warehouse_purchases_account_created_at_idx" ON "warehouse_purchases" ("account_id", "created_at");
--> statement-breakpoint
CREATE INDEX "warehouse_transfers_account_warehouse_idx" ON "warehouse_transfers" ("account_id", "warehouse_id");
--> statement-breakpoint
CREATE INDEX "warehouse_transfers_account_store_location_idx" ON "warehouse_transfers" ("account_id", "store_location_id");
--> statement-breakpoint
INSERT INTO "accounts" ("name", "slug", "status", "plan", "active")
VALUES ('Default Account', 'default', 'active', 'legacy', true);
--> statement-breakpoint
INSERT INTO "locations" ("account_id", "name", "slug")
SELECT a."id", loc."name", 'loc-' || md5(loc."name")
FROM "accounts" a
CROSS JOIN (
  SELECT DISTINCT "location" AS "name" FROM "items"
  UNION
  SELECT DISTINCT "location" AS "name" FROM "orders"
  UNION
  SELECT DISTINCT "location" AS "name" FROM "history" WHERE "location" IS NOT NULL
  UNION
  SELECT DISTINCT "location" AS "name" FROM "scan_log" WHERE "location" IS NOT NULL
  UNION
  SELECT DISTINCT "store_location" AS "name" FROM "warehouse_transfers"
) loc
WHERE a."slug" = 'default'
  AND loc."name" IS NOT NULL
ON CONFLICT ("account_id", "name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "warehouses" ("account_id", "name", "slug")
SELECT "id", 'Default Warehouse', 'default-warehouse'
FROM "accounts"
WHERE "slug" = 'default'
ON CONFLICT ("account_id", "slug") DO NOTHING;
--> statement-breakpoint
UPDATE "users" SET "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default');
--> statement-breakpoint
UPDATE "role_permissions" SET "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default');
--> statement-breakpoint
UPDATE "items" i
SET
  "account_id" = a."id",
  "location_id" = (
    SELECT l."id"
    FROM "locations" l
    WHERE l."account_id" = a."id" AND l."name" = i."location"
    LIMIT 1
  )
FROM "accounts" a
WHERE a."slug" = 'default';
--> statement-breakpoint
UPDATE "orders" o
SET
  "account_id" = a."id",
  "location_id" = (
    SELECT l."id"
    FROM "locations" l
    WHERE l."account_id" = a."id" AND l."name" = o."location"
    LIMIT 1
  )
FROM "accounts" a
WHERE a."slug" = 'default';
--> statement-breakpoint
UPDATE "order_items" oi
SET "account_id" = o."account_id"
FROM "orders" o
WHERE oi."order_id" = o."id";
--> statement-breakpoint
UPDATE "history" h
SET
  "account_id" = a."id",
  "location_id" = (
    SELECT l."id"
    FROM "locations" l
    WHERE l."account_id" = a."id" AND l."name" = h."location"
    LIMIT 1
  )
FROM "accounts" a
WHERE a."slug" = 'default';
--> statement-breakpoint
UPDATE "scan_log" s
SET
  "account_id" = a."id",
  "location_id" = (
    SELECT l."id"
    FROM "locations" l
    WHERE l."account_id" = a."id" AND l."name" = s."location"
    LIMIT 1
  )
FROM "accounts" a
WHERE a."slug" = 'default';
--> statement-breakpoint
UPDATE "warehouse_items"
SET
  "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default'),
  "warehouse_id" = (SELECT "id" FROM "warehouses" WHERE "slug" = 'default-warehouse');
--> statement-breakpoint
UPDATE "warehouse_purchases"
SET
  "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default'),
  "warehouse_id" = (SELECT "id" FROM "warehouses" WHERE "slug" = 'default-warehouse');
--> statement-breakpoint
UPDATE "warehouse_transfers" wt
SET
  "account_id" = a."id",
  "warehouse_id" = (
    SELECT w."id"
    FROM "warehouses" w
    WHERE w."account_id" = a."id" AND w."slug" = 'default-warehouse'
    LIMIT 1
  ),
  "store_location_id" = (
    SELECT l."id"
    FROM "locations" l
    WHERE l."account_id" = a."id" AND l."name" = wt."store_location"
    LIMIT 1
  )
FROM "accounts" a
WHERE a."slug" = 'default';
--> statement-breakpoint
INSERT INTO "account_memberships" ("account_id", "user_id", "role", "active")
SELECT u."account_id", u."id", u."role", u."active"
FROM "users" u
WHERE u."account_id" IS NOT NULL
ON CONFLICT ("account_id", "user_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_location_assignments" ("account_id", "user_id", "location_id")
SELECT u."account_id", u."id", l."id"
FROM "users" u
CROSS JOIN LATERAL unnest(u."assigned_locations") AS assigned_location("name")
JOIN "locations" l ON l."account_id" = u."account_id" AND l."name" = assigned_location."name"
WHERE u."account_id" IS NOT NULL
ON CONFLICT ("account_id", "user_id", "location_id") DO NOTHING;
