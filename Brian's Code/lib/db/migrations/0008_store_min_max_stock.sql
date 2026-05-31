alter table "items"
  add column if not exists "min_quantity" integer default 0 not null,
  add column if not exists "max_quantity" integer default 0 not null;

update "items"
set
  "min_quantity" = greatest(0, "par_level"),
  "max_quantity" = greatest(0, "par_level" * 2, "quantity", "par_level")
where "min_quantity" = 0
  and "max_quantity" = 0
  and ("par_level" > 0 or "quantity" > 0);

create index if not exists "items_account_location_min_qty_idx"
  on "items" ("account_id", "location_id", "min_quantity");

create index if not exists "items_account_location_max_qty_idx"
  on "items" ("account_id", "location_id", "max_quantity");
