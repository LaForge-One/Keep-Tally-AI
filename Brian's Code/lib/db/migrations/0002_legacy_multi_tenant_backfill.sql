INSERT INTO "accounts" ("name", "slug", "status", "plan", "active")
VALUES ('Default Account', 'default', 'active', 'legacy', true)
ON CONFLICT ("slug") DO NOTHING;
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
  UNION
  SELECT DISTINCT assigned_location."name"
  FROM "users" u
  CROSS JOIN LATERAL unnest(u."assigned_locations") AS assigned_location("name")
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
UPDATE "users"
SET "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default')
WHERE "account_id" IS NULL;
--> statement-breakpoint
UPDATE "role_permissions"
SET "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default')
WHERE "account_id" IS NULL;
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
WHERE a."slug" = 'default'
  AND (i."account_id" IS NULL OR i."location_id" IS NULL);
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
WHERE a."slug" = 'default'
  AND (o."account_id" IS NULL OR o."location_id" IS NULL);
--> statement-breakpoint
UPDATE "order_items" oi
SET "account_id" = o."account_id"
FROM "orders" o
WHERE oi."order_id" = o."id"
  AND oi."account_id" IS NULL;
--> statement-breakpoint
UPDATE "history" h
SET
  "account_id" = a."id",
  "location_id" = CASE
    WHEN h."location" IS NULL THEN h."location_id"
    ELSE (
      SELECT l."id"
      FROM "locations" l
      WHERE l."account_id" = a."id" AND l."name" = h."location"
      LIMIT 1
    )
  END
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (h."account_id" IS NULL OR (h."location" IS NOT NULL AND h."location_id" IS NULL));
--> statement-breakpoint
UPDATE "scan_log" s
SET
  "account_id" = a."id",
  "location_id" = CASE
    WHEN s."location" IS NULL THEN s."location_id"
    ELSE (
      SELECT l."id"
      FROM "locations" l
      WHERE l."account_id" = a."id" AND l."name" = s."location"
      LIMIT 1
    )
  END
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (s."account_id" IS NULL OR (s."location" IS NOT NULL AND s."location_id" IS NULL));
--> statement-breakpoint
UPDATE "warehouse_items"
SET
  "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default'),
  "warehouse_id" = (SELECT "id" FROM "warehouses" WHERE "slug" = 'default-warehouse')
WHERE "account_id" IS NULL OR "warehouse_id" IS NULL;
--> statement-breakpoint
UPDATE "warehouse_purchases"
SET
  "account_id" = (SELECT "id" FROM "accounts" WHERE "slug" = 'default'),
  "warehouse_id" = (SELECT "id" FROM "warehouses" WHERE "slug" = 'default-warehouse')
WHERE "account_id" IS NULL OR "warehouse_id" IS NULL;
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
WHERE a."slug" = 'default'
  AND (wt."account_id" IS NULL OR wt."warehouse_id" IS NULL OR wt."store_location_id" IS NULL);
--> statement-breakpoint
INSERT INTO "account_memberships" ("account_id", "user_id", "role", "active")
SELECT u."account_id", u."id", u."role", u."active"
FROM "users" u
WHERE u."account_id" IS NOT NULL
ON CONFLICT ("account_id", "user_id") DO UPDATE SET
  "role" = EXCLUDED."role",
  "active" = EXCLUDED."active",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "user_location_assignments" ("account_id", "user_id", "location_id")
SELECT u."account_id", u."id", l."id"
FROM "users" u
CROSS JOIN LATERAL unnest(u."assigned_locations") AS assigned_location("name")
JOIN "locations" l ON l."account_id" = u."account_id" AND l."name" = assigned_location."name"
WHERE u."account_id" IS NOT NULL
ON CONFLICT ("account_id", "user_id", "location_id") DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "slug" = 'default') THEN
    RAISE EXCEPTION 'legacy backfill failed: default account was not created';
  END IF;

  IF EXISTS (SELECT 1 FROM "users" WHERE "account_id" IS NULL) THEN
    RAISE EXCEPTION 'legacy backfill failed: users remain without account_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users" u
    WHERE NOT EXISTS (
      SELECT 1
      FROM "account_memberships" am
      WHERE am."account_id" = u."account_id" AND am."user_id" = u."id"
    )
  ) THEN
    RAISE EXCEPTION 'legacy backfill failed: users remain without account_memberships';
  END IF;

  IF EXISTS (SELECT 1 FROM "items" WHERE "account_id" IS NULL OR "location_id" IS NULL) THEN
    RAISE EXCEPTION 'legacy backfill failed: items remain without account/location mapping';
  END IF;

  IF EXISTS (SELECT 1 FROM "orders" WHERE "account_id" IS NULL OR "location_id" IS NULL) THEN
    RAISE EXCEPTION 'legacy backfill failed: orders remain without account/location mapping';
  END IF;

  IF EXISTS (SELECT 1 FROM "order_items" WHERE "account_id" IS NULL) THEN
    RAISE EXCEPTION 'legacy backfill failed: order_items remain without account_id';
  END IF;

  IF EXISTS (SELECT 1 FROM "history" WHERE "account_id" IS NULL OR ("location" IS NOT NULL AND "location_id" IS NULL)) THEN
    RAISE EXCEPTION 'legacy backfill failed: history rows remain without account/location mapping';
  END IF;

  IF EXISTS (SELECT 1 FROM "scan_log" WHERE "account_id" IS NULL OR ("location" IS NOT NULL AND "location_id" IS NULL)) THEN
    RAISE EXCEPTION 'legacy backfill failed: scan_log rows remain without account/location mapping';
  END IF;

  IF EXISTS (SELECT 1 FROM "warehouse_items" WHERE "account_id" IS NULL OR "warehouse_id" IS NULL) THEN
    RAISE EXCEPTION 'legacy backfill failed: warehouse_items remain without account/warehouse mapping';
  END IF;

  IF EXISTS (SELECT 1 FROM "warehouse_purchases" WHERE "account_id" IS NULL OR "warehouse_id" IS NULL) THEN
    RAISE EXCEPTION 'legacy backfill failed: warehouse_purchases remain without account/warehouse mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "warehouse_transfers"
    WHERE "account_id" IS NULL OR "warehouse_id" IS NULL OR "store_location_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy backfill failed: warehouse_transfers remain without account/warehouse/location mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users" u
    CROSS JOIN LATERAL unnest(u."assigned_locations") AS assigned_location("name")
    WHERE u."account_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "user_location_assignments" ula
        JOIN "locations" l ON l."id" = ula."location_id"
        WHERE ula."account_id" = u."account_id"
          AND ula."user_id" = u."id"
          AND l."name" = assigned_location."name"
      )
  ) THEN
    RAISE EXCEPTION 'legacy backfill failed: assigned locations remain without assignment rows';
  END IF;
END $$;
