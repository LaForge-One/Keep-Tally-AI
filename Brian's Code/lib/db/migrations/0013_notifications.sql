CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "user_id" integer REFERENCES "users"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "channels" jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  "digest_frequency" text NOT NULL DEFAULT 'instant',
  "quiet_hours_start" text,
  "quiet_hours_end" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notification_preferences_account_event_idx"
  ON "notification_preferences" ("account_id", "event_type");

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_account_user_event_idx"
  ON "notification_preferences" ("account_id", "user_id", "event_type");

CREATE TABLE IF NOT EXISTS "notification_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "user_id" integer REFERENCES "users"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'info',
  "title" text NOT NULL,
  "message" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" text NOT NULL,
  "read_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "delivery_status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notification_events_account_user_read_created_idx"
  ON "notification_events" ("account_id", "user_id", "read_at", "created_at");

CREATE INDEX IF NOT EXISTS "notification_events_account_event_created_idx"
  ON "notification_events" ("account_id", "event_type", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "notification_events_account_user_dedupe_idx"
  ON "notification_events" ("account_id", "user_id", "dedupe_key");
