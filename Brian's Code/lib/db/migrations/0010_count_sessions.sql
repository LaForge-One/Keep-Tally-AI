CREATE TABLE IF NOT EXISTS "count_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "location_id" integer REFERENCES "locations"("id") ON DELETE set null,
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
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "count_session_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "session_id" integer NOT NULL REFERENCES "count_sessions"("id") ON DELETE cascade,
  "user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "location_id" integer REFERENCES "locations"("id") ON DELETE set null,
  "item_id" integer REFERENCES "items"("id") ON DELETE set null,
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
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_sessions_account_status_started_idx"
  ON "count_sessions" ("account_id", "status", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_sessions_account_location_started_idx"
  ON "count_sessions" ("account_id", "location_id", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_session_events_account_session_created_idx"
  ON "count_session_events" ("account_id", "session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "count_session_events_account_item_created_idx"
  ON "count_session_events" ("account_id", "item_id", "created_at");
