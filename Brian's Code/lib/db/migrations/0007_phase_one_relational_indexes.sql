CREATE INDEX IF NOT EXISTS "user_location_assignments_account_user_idx"
  ON "user_location_assignments" ("account_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "history_account_item_created_idx"
  ON "history" ("account_id", "item_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_log_account_item_created_idx"
  ON "scan_log" ("account_id", "item_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_account_item_idx"
  ON "order_items" ("account_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_sheet_stops_account_location_created_idx"
  ON "route_sheet_stops" ("account_id", "location_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_sheet_stop_items_account_item_idx"
  ON "route_sheet_stop_items" ("account_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_purchases_account_item_created_idx"
  ON "warehouse_purchases" ("account_id", "warehouse_item_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_transfers_account_warehouse_item_created_idx"
  ON "warehouse_transfers" ("account_id", "warehouse_item_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_transfers_account_store_item_created_idx"
  ON "warehouse_transfers" ("account_id", "store_item_id", "created_at");
