CREATE INDEX IF NOT EXISTS "items_account_category_name_idx"
  ON "items" ("account_id", "category", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_account_location_category_name_idx"
  ON "items" ("account_id", "location_id", "category", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_items_account_warehouse_category_name_idx"
  ON "warehouse_items" ("account_id", "warehouse_id", "category", "name");
