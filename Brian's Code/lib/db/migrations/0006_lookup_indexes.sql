CREATE INDEX IF NOT EXISTS "items_account_location_name_idx"
  ON "items" ("account_id", "location_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_account_legacy_location_name_idx"
  ON "items" ("account_id", "location", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_location_assignments_account_location_idx"
  ON "user_location_assignments" ("account_id", "location_id");
