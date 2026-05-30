CREATE TABLE "route_sheets" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL,
  "employee" text NOT NULL,
  "route_date" date NOT NULL,
  "van" text DEFAULT '' NOT NULL,
  "day" text DEFAULT '' NOT NULL,
  "route_name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "notes" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "route_sheet_stops" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL,
  "route_sheet_id" integer NOT NULL,
  "location_id" integer,
  "route_order" integer DEFAULT 0 NOT NULL,
  "location_name" text NOT NULL,
  "address" text DEFAULT '' NOT NULL,
  "contact" text DEFAULT '' NOT NULL,
  "machine_types" text DEFAULT '' NOT NULL,
  "machine_clean" text DEFAULT 'unchecked' NOT NULL,
  "machine_working" text DEFAULT 'unchecked' NOT NULL,
  "payment_system" text DEFAULT 'unchecked' NOT NULL,
  "cash_collected" real DEFAULT 0 NOT NULL,
  "cash_bag_number" text DEFAULT '' NOT NULL,
  "meter_reading" text DEFAULT '' NOT NULL,
  "issue_description" text DEFAULT '' NOT NULL,
  "issue_priority" text DEFAULT 'none' NOT NULL,
  "before_photo_url" text,
  "after_photo_url" text,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "route_sheet_stop_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL,
  "route_sheet_stop_id" integer NOT NULL,
  "item_id" integer,
  "product_name" text NOT NULL,
  "par_level" integer DEFAULT 0 NOT NULL,
  "restock_qty" integer DEFAULT 0 NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "route_sheets" ADD CONSTRAINT "route_sheets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE cascade;
ALTER TABLE "route_sheet_stops" ADD CONSTRAINT "route_sheet_stops_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE cascade;
ALTER TABLE "route_sheet_stops" ADD CONSTRAINT "route_sheet_stops_route_sheet_id_route_sheets_id_fk" FOREIGN KEY ("route_sheet_id") REFERENCES "route_sheets"("id") ON DELETE cascade;
ALTER TABLE "route_sheet_stops" ADD CONSTRAINT "route_sheet_stops_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE set null;
ALTER TABLE "route_sheet_stop_items" ADD CONSTRAINT "route_sheet_stop_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE cascade;
ALTER TABLE "route_sheet_stop_items" ADD CONSTRAINT "route_sheet_stop_items_route_sheet_stop_id_route_sheet_stops_id_fk" FOREIGN KEY ("route_sheet_stop_id") REFERENCES "route_sheet_stops"("id") ON DELETE cascade;
ALTER TABLE "route_sheet_stop_items" ADD CONSTRAINT "route_sheet_stop_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE set null;

CREATE INDEX "route_sheets_account_date_idx" ON "route_sheets" USING btree ("account_id","route_date");
CREATE INDEX "route_sheets_account_status_idx" ON "route_sheets" USING btree ("account_id","status");
CREATE INDEX "route_sheet_stops_account_sheet_idx" ON "route_sheet_stops" USING btree ("account_id","route_sheet_id");
CREATE INDEX "route_sheet_stops_account_location_idx" ON "route_sheet_stops" USING btree ("account_id","location_id");
CREATE INDEX "route_sheet_stops_order_idx" ON "route_sheet_stops" USING btree ("route_sheet_id","route_order");
CREATE INDEX "route_sheet_stop_items_account_stop_idx" ON "route_sheet_stop_items" USING btree ("account_id","route_sheet_stop_id");
