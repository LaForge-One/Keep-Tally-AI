CREATE TABLE IF NOT EXISTS "products" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "category" text NOT NULL DEFAULT 'Uncategorized',
  "brand" text,
  "size" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_identifiers" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "normalized_code" text NOT NULL,
  "type" text NOT NULL DEFAULT 'upc',
  "unit_multiplier" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'active',
  "primary_for_type" boolean NOT NULL DEFAULT false,
  "source" text NOT NULL DEFAULT 'legacy_barcode',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "product_id" integer REFERENCES "products"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "warehouse_items" ADD COLUMN IF NOT EXISTS "product_id" integer REFERENCES "products"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_account_status_name_idx"
  ON "products" ("account_id", "status", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_account_category_name_idx"
  ON "products" ("account_id", "category", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_identifiers_account_normalized_code_idx"
  ON "product_identifiers" ("account_id", "normalized_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_identifiers_account_product_idx"
  ON "product_identifiers" ("account_id", "product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_identifiers_account_status_type_idx"
  ON "product_identifiers" ("account_id", "status", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_account_product_location_idx"
  ON "items" ("account_id", "product_id", "location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_items_account_product_warehouse_idx"
  ON "warehouse_items" ("account_id", "product_id", "warehouse_id");
--> statement-breakpoint
INSERT INTO "products" ("account_id", "name", "category", "status")
SELECT DISTINCT source."account_id", source."name", source."category", 'active'
FROM (
  SELECT "account_id", trim("name") AS "name", trim("category") AS "category"
  FROM "items"
  WHERE "account_id" IS NOT NULL AND trim("name") <> ''
  UNION
  SELECT "account_id", trim("name") AS "name", trim("category") AS "category"
  FROM "warehouse_items"
  WHERE "account_id" IS NOT NULL AND trim("name") <> ''
) source
WHERE NOT EXISTS (
  SELECT 1
  FROM "products" p
  WHERE p."account_id" = source."account_id"
    AND lower(p."name") = lower(source."name")
    AND lower(p."category") = lower(source."category")
);
--> statement-breakpoint
UPDATE "items" i
SET "product_id" = p."id"
FROM "products" p
WHERE i."product_id" IS NULL
  AND i."account_id" = p."account_id"
  AND lower(trim(i."name")) = lower(p."name")
  AND lower(trim(i."category")) = lower(p."category");
--> statement-breakpoint
UPDATE "warehouse_items" wi
SET "product_id" = p."id"
FROM "products" p
WHERE wi."product_id" IS NULL
  AND wi."account_id" = p."account_id"
  AND lower(trim(wi."name")) = lower(p."name")
  AND lower(trim(wi."category")) = lower(p."category");
--> statement-breakpoint
INSERT INTO "product_identifiers" (
  "account_id",
  "product_id",
  "code",
  "normalized_code",
  "type",
  "unit_multiplier",
  "status",
  "primary_for_type",
  "source"
)
SELECT DISTINCT source."account_id",
  source."product_id",
  source."barcode",
  regexp_replace(lower(source."barcode"), '[^0-9a-z]', '', 'g'),
  'upc',
  1,
  'active',
  true,
  source."source"
FROM (
  SELECT "account_id", "product_id", trim("barcode") AS "barcode", 'store_item_barcode' AS "source"
  FROM "items"
  WHERE "account_id" IS NOT NULL
    AND "product_id" IS NOT NULL
    AND "barcode" IS NOT NULL
    AND trim("barcode") <> ''
  UNION
  SELECT "account_id", "product_id", trim("barcode") AS "barcode", 'warehouse_item_barcode' AS "source"
  FROM "warehouse_items"
  WHERE "account_id" IS NOT NULL
    AND "product_id" IS NOT NULL
    AND "barcode" IS NOT NULL
    AND trim("barcode") <> ''
) source
WHERE regexp_replace(lower(source."barcode"), '[^0-9a-z]', '', 'g') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "product_identifiers" pi
    WHERE pi."account_id" = source."account_id"
      AND pi."product_id" = source."product_id"
      AND pi."normalized_code" = regexp_replace(lower(source."barcode"), '[^0-9a-z]', '', 'g')
      AND pi."type" = 'upc'
  );
