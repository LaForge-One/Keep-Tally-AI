INSERT INTO "accounts" ("name", "slug", "status", "plan", "active")
VALUES ('Default Account', 'default', 'active', 'legacy', true)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "locations" ("account_id", "name", "slug")
SELECT loc."account_id", loc."name", 'loc-' || md5(loc."name")
FROM (
  SELECT COALESCE(i."account_id", a."id") AS "account_id", i."location" AS "name"
  FROM "items" i
  CROSS JOIN "accounts" a
  WHERE a."slug" = 'default'
  UNION
  SELECT COALESCE(o."account_id", a."id") AS "account_id", o."location" AS "name"
  FROM "orders" o
  CROSS JOIN "accounts" a
  WHERE a."slug" = 'default'
  UNION
  SELECT COALESCE(h."account_id", i."account_id", a."id") AS "account_id", h."location" AS "name"
  FROM "history" h
  LEFT JOIN "items" i ON i."id" = h."item_id"
  CROSS JOIN "accounts" a
  WHERE a."slug" = 'default' AND h."location" IS NOT NULL
  UNION
  SELECT COALESCE(s."account_id", i."account_id", a."id") AS "account_id", s."location" AS "name"
  FROM "scan_log" s
  LEFT JOIN "items" i ON i."id" = s."item_id"
  CROSS JOIN "accounts" a
  WHERE a."slug" = 'default' AND s."location" IS NOT NULL
  UNION
  SELECT COALESCE(wt."account_id", wi."account_id", a."id") AS "account_id", wt."store_location" AS "name"
  FROM "warehouse_transfers" wt
  LEFT JOIN "warehouse_items" wi ON wi."id" = wt."warehouse_item_id"
  CROSS JOIN "accounts" a
  WHERE a."slug" = 'default'
  UNION
  SELECT COALESCE(u."account_id", a."id") AS "account_id", assigned_location."name"
  FROM "users" u
  CROSS JOIN "accounts" a
  CROSS JOIN LATERAL unnest(u."assigned_locations") AS assigned_location("name")
  WHERE a."slug" = 'default'
) loc
WHERE loc."account_id" IS NOT NULL
  AND loc."name" IS NOT NULL
ON CONFLICT ("account_id", "name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "warehouses" ("account_id", "name", "slug")
SELECT a."id", 'Default Warehouse', 'default-warehouse'
FROM "accounts" a
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
  "account_id" = COALESCE(i."account_id", a."id"),
  "location_id" = COALESCE(
    i."location_id",
    (
      SELECT l."id"
      FROM "locations" l
      WHERE l."account_id" = COALESCE(i."account_id", a."id") AND l."name" = i."location"
      LIMIT 1
    )
  )
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (i."account_id" IS NULL OR i."location_id" IS NULL);
--> statement-breakpoint
UPDATE "orders" o
SET
  "account_id" = COALESCE(o."account_id", a."id"),
  "location_id" = COALESCE(
    o."location_id",
    (
      SELECT l."id"
      FROM "locations" l
      WHERE l."account_id" = COALESCE(o."account_id", a."id") AND l."name" = o."location"
      LIMIT 1
    )
  )
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (o."account_id" IS NULL OR o."location_id" IS NULL);
--> statement-breakpoint
UPDATE "order_items" oi
SET "account_id" = o."account_id"
FROM "orders" o
WHERE oi."order_id" = o."id"
  AND (oi."account_id" IS NULL OR oi."account_id" <> o."account_id");
--> statement-breakpoint
UPDATE "history" h
SET
  "account_id" = COALESCE(
    h."account_id",
    (SELECT i."account_id" FROM "items" i WHERE i."id" = h."item_id" LIMIT 1),
    a."id"
  ),
  "location_id" = CASE
    WHEN h."location" IS NULL THEN h."location_id"
    ELSE COALESCE(
      h."location_id",
      (
        SELECT l."id"
        FROM "locations" l
        WHERE l."account_id" = COALESCE(
            h."account_id",
            (SELECT i."account_id" FROM "items" i WHERE i."id" = h."item_id" LIMIT 1),
            a."id"
          )
          AND l."name" = h."location"
        LIMIT 1
      )
    )
  END
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (h."account_id" IS NULL OR (h."location" IS NOT NULL AND h."location_id" IS NULL));
--> statement-breakpoint
UPDATE "scan_log" s
SET
  "account_id" = COALESCE(
    s."account_id",
    (SELECT i."account_id" FROM "items" i WHERE i."id" = s."item_id" LIMIT 1),
    a."id"
  ),
  "location_id" = CASE
    WHEN s."location" IS NULL THEN s."location_id"
    ELSE COALESCE(
      s."location_id",
      (
        SELECT l."id"
        FROM "locations" l
        WHERE l."account_id" = COALESCE(
            s."account_id",
            (SELECT i."account_id" FROM "items" i WHERE i."id" = s."item_id" LIMIT 1),
            a."id"
          )
          AND l."name" = s."location"
        LIMIT 1
      )
    )
  END
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (s."account_id" IS NULL OR (s."location" IS NOT NULL AND s."location_id" IS NULL));
--> statement-breakpoint
UPDATE "warehouse_items" wi
SET
  "account_id" = COALESCE(wi."account_id", a."id"),
  "warehouse_id" = COALESCE(
    wi."warehouse_id",
    (
      SELECT w."id"
      FROM "warehouses" w
      WHERE w."account_id" = COALESCE(wi."account_id", a."id") AND w."slug" = 'default-warehouse'
      LIMIT 1
    )
  )
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (wi."account_id" IS NULL OR wi."warehouse_id" IS NULL);
--> statement-breakpoint
UPDATE "warehouse_purchases" wp
SET
  "account_id" = COALESCE(
    wp."account_id",
    (SELECT wi."account_id" FROM "warehouse_items" wi WHERE wi."id" = wp."warehouse_item_id" LIMIT 1),
    a."id"
  ),
  "warehouse_id" = COALESCE(
    wp."warehouse_id",
    (
      SELECT w."id"
      FROM "warehouses" w
      WHERE w."account_id" = COALESCE(
          wp."account_id",
          (SELECT wi."account_id" FROM "warehouse_items" wi WHERE wi."id" = wp."warehouse_item_id" LIMIT 1),
          a."id"
        )
        AND w."slug" = 'default-warehouse'
      LIMIT 1
    )
  )
FROM "accounts" a
WHERE a."slug" = 'default'
  AND (wp."account_id" IS NULL OR wp."warehouse_id" IS NULL);
--> statement-breakpoint
UPDATE "warehouse_transfers" wt
SET
  "account_id" = COALESCE(
    wt."account_id",
    (SELECT wi."account_id" FROM "warehouse_items" wi WHERE wi."id" = wt."warehouse_item_id" LIMIT 1),
    a."id"
  ),
  "warehouse_id" = COALESCE(
    wt."warehouse_id",
    (
      SELECT w."id"
      FROM "warehouses" w
      WHERE w."account_id" = COALESCE(
          wt."account_id",
          (SELECT wi."account_id" FROM "warehouse_items" wi WHERE wi."id" = wt."warehouse_item_id" LIMIT 1),
          a."id"
        )
        AND w."slug" = 'default-warehouse'
      LIMIT 1
    )
  ),
  "store_location_id" = COALESCE(
    wt."store_location_id",
    (
      SELECT l."id"
      FROM "locations" l
      WHERE l."account_id" = COALESCE(
          wt."account_id",
          (SELECT wi."account_id" FROM "warehouse_items" wi WHERE wi."id" = wt."warehouse_item_id" LIMIT 1),
          a."id"
        )
        AND l."name" = wt."store_location"
      LIMIT 1
    )
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
    RAISE EXCEPTION 'multi-tenant repair failed: default account is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM "users" WHERE "account_id" IS NULL) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: users remain without account_id';
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
    RAISE EXCEPTION 'multi-tenant repair failed: users remain without account_memberships';
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
    RAISE EXCEPTION 'multi-tenant repair failed: assigned locations remain without assignment rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "items" WHERE "account_id" IS NULL OR "location_id" IS NULL) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: items remain without account/location mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "items" i
    JOIN "locations" l ON l."id" = i."location_id"
    WHERE l."account_id" <> i."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: item locations belong to another account';
  END IF;

  IF EXISTS (SELECT 1 FROM "orders" WHERE "account_id" IS NULL OR "location_id" IS NULL) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: orders remain without account/location mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "orders" o
    JOIN "locations" l ON l."id" = o."location_id"
    WHERE l."account_id" <> o."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: order locations belong to another account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "order_items" oi
    JOIN "orders" o ON o."id" = oi."order_id"
    WHERE oi."account_id" IS NULL OR oi."account_id" <> o."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: order_items remain without matching account_id';
  END IF;

  IF EXISTS (SELECT 1 FROM "history" WHERE "account_id" IS NULL OR ("location" IS NOT NULL AND "location_id" IS NULL)) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: history rows remain without account/location mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "history" h
    JOIN "locations" l ON l."id" = h."location_id"
    WHERE h."location_id" IS NOT NULL AND l."account_id" <> h."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: history locations belong to another account';
  END IF;

  IF EXISTS (SELECT 1 FROM "scan_log" WHERE "account_id" IS NULL OR ("location" IS NOT NULL AND "location_id" IS NULL)) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: scan_log rows remain without account/location mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "scan_log" s
    JOIN "locations" l ON l."id" = s."location_id"
    WHERE s."location_id" IS NOT NULL AND l."account_id" <> s."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: scan_log locations belong to another account';
  END IF;

  IF EXISTS (SELECT 1 FROM "warehouse_items" WHERE "account_id" IS NULL OR "warehouse_id" IS NULL) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: warehouse_items remain without account/warehouse mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "warehouse_items" wi
    JOIN "warehouses" w ON w."id" = wi."warehouse_id"
    WHERE w."account_id" <> wi."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: warehouse_items point to warehouses in another account';
  END IF;

  IF EXISTS (SELECT 1 FROM "warehouse_purchases" WHERE "account_id" IS NULL OR "warehouse_id" IS NULL) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: warehouse_purchases remain without account/warehouse mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "warehouse_purchases" wp
    JOIN "warehouses" w ON w."id" = wp."warehouse_id"
    WHERE w."account_id" <> wp."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: warehouse_purchases point to warehouses in another account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "warehouse_transfers"
    WHERE "account_id" IS NULL OR "warehouse_id" IS NULL OR "store_location_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: warehouse_transfers remain without account/warehouse/location mapping';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "warehouse_transfers" wt
    JOIN "warehouses" w ON w."id" = wt."warehouse_id"
    JOIN "locations" l ON l."id" = wt."store_location_id"
    WHERE w."account_id" <> wt."account_id" OR l."account_id" <> wt."account_id"
  ) THEN
    RAISE EXCEPTION 'multi-tenant repair failed: warehouse_transfers point to another account';
  END IF;
END $$;
