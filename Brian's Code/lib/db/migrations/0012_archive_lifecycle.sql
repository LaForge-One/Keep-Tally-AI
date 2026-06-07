CREATE TABLE IF NOT EXISTS "stockout_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer REFERENCES "accounts"("id") ON DELETE cascade,
  "item_id" integer,
  "location_id" integer REFERENCES "locations"("id") ON DELETE set null,
  "item_name" text NOT NULL,
  "location_name" text,
  "category" text NOT NULL DEFAULT 'Uncategorized',
  "status" text NOT NULL DEFAULT 'open',
  "quantity_at_open" integer NOT NULL DEFAULT 0,
  "min_quantity" integer NOT NULL DEFAULT 0,
  "max_quantity" integer NOT NULL DEFAULT 0,
  "opened_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolution_quantity" integer,
  "source" text NOT NULL DEFAULT 'inventory_history',
  "evidence" text NOT NULL DEFAULT 'history_transition',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stockout_events_account_status_opened_idx"
  ON "stockout_events" ("account_id", "status", "opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stockout_events_account_item_status_idx"
  ON "stockout_events" ("account_id", "item_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stockout_events_account_location_status_opened_idx"
  ON "stockout_events" ("account_id", "location_id", "status", "opened_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "history_archive" (
  "id" integer PRIMARY KEY NOT NULL,
  "account_id" integer,
  "location_id" integer,
  "item_id" integer,
  "item_name" text NOT NULL,
  "action" text NOT NULL,
  "field" text,
  "previous_value" text,
  "new_value" text,
  "note" text,
  "source" text NOT NULL DEFAULT 'ui',
  "performed_by" text,
  "performed_by_role" text,
  "location" text,
  "created_at" timestamp with time zone NOT NULL,
  "archived_at" timestamp with time zone NOT NULL DEFAULT now(),
  "archive_reason" text NOT NULL DEFAULT 'retention_policy'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "history_archive_account_created_idx"
  ON "history_archive" ("account_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "history_archive_account_item_created_idx"
  ON "history_archive" ("account_id", "item_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "count_sessions_archive" (
  "id" integer PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL,
  "user_id" integer,
  "location_id" integer,
  "location_name" text,
  "mode" text NOT NULL,
  "source" text NOT NULL DEFAULT 'voice',
  "status" text NOT NULL DEFAULT 'active',
  "item_count" integer NOT NULL DEFAULT 0,
  "verified_count" integer NOT NULL DEFAULT 0,
  "updated_count" integer NOT NULL DEFAULT 0,
  "skipped_count" integer NOT NULL DEFAULT 0,
  "no_response_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "archived_at" timestamp with time zone NOT NULL DEFAULT now(),
  "archive_reason" text NOT NULL DEFAULT 'retention_policy'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_sessions_archive_account_started_idx"
  ON "count_sessions_archive" ("account_id", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_sessions_archive_account_location_started_idx"
  ON "count_sessions_archive" ("account_id", "location_id", "started_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "count_session_events_archive" (
  "id" integer PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL,
  "session_id" integer NOT NULL,
  "user_id" integer,
  "location_id" integer,
  "item_id" integer,
  "item_name" text,
  "event_type" text NOT NULL,
  "action" text,
  "status" text,
  "expected_quantity" integer,
  "counted_quantity" integer,
  "reason" text,
  "transcript" text,
  "confidence" integer,
  "message" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL,
  "archived_at" timestamp with time zone NOT NULL DEFAULT now(),
  "archive_reason" text NOT NULL DEFAULT 'retention_policy'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_session_events_archive_account_session_created_idx"
  ON "count_session_events_archive" ("account_id", "session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_session_events_archive_account_item_created_idx"
  ON "count_session_events_archive" ("account_id", "item_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stockout_events_archive" (
  "id" integer PRIMARY KEY NOT NULL,
  "account_id" integer,
  "item_id" integer,
  "location_id" integer,
  "item_name" text NOT NULL,
  "location_name" text,
  "category" text NOT NULL DEFAULT 'Uncategorized',
  "status" text NOT NULL DEFAULT 'resolved',
  "quantity_at_open" integer NOT NULL DEFAULT 0,
  "min_quantity" integer NOT NULL DEFAULT 0,
  "max_quantity" integer NOT NULL DEFAULT 0,
  "opened_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolution_quantity" integer,
  "source" text NOT NULL DEFAULT 'inventory_history',
  "evidence" text NOT NULL DEFAULT 'history_transition',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "archived_at" timestamp with time zone NOT NULL DEFAULT now(),
  "archive_reason" text NOT NULL DEFAULT 'retention_policy'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stockout_events_archive_account_opened_idx"
  ON "stockout_events_archive" ("account_id", "opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stockout_events_archive_account_item_opened_idx"
  ON "stockout_events_archive" ("account_id", "item_id", "opened_at");
