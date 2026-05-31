# KeepTally Relational Database Upgrade Plan

Generated: 2026-05-30

This document outlines practical schema improvements to make the KeepTally database more relational, more consistent, and faster under real operational load. It builds on the current schema in `lib/db/src/schema` and the existing multi-tenant migrations.

## Design Direction

The database is already moving in the right direction:

- Core business tables have `account_id`.
- Locations have a real `locations.id`.
- Users have account membership rows.
- There are indexes for common inventory lookups.

The main opportunity is to finish the normalization path. Several tables still store legacy text snapshots such as `location`, `store_location`, `performed_by`, and `operator`. Those strings are useful as audit snapshots, but they should not be the primary relationship mechanism.

## Big O And Database Performance

In relational databases, performance is less about code-level Big O loops and more about whether queries can use indexes and joins efficiently.

Good target behavior:

| Workflow | Desired Complexity Shape | How We Get There |
| --- | --- | --- |
| Find item by barcode within account | `O(log n)` index lookup | `(account_id, barcode)` index |
| Find items at a location | `O(log n + k)` | `(account_id, location_id)` index |
| Find item by location/name | `O(log n)` | `(account_id, location_id, name)` index |
| Load recent history | `O(log n + k)` | `(account_id, created_at)` index |
| Load scans for a location | `O(log n + k)` | `(account_id, location_id, created_at)` index |
| Load user location access | `O(log n + k)` | `(account_id, user_id, location_id)` unique index |

Bad target behavior to avoid:

- String matching on location names across large tables.
- Full table scans for history or scan logs.
- Application-side filtering after loading broad result sets.
- Repeated queries inside loops when a single join would do.

## Main Upgrade Areas

## 1. Users, History, And Scan Logs

Current issue:

- `history.performed_by` is text.
- `scan_log.operator` is text.
- `history.item_id` and `scan_log.item_id` are plain integers without formal foreign keys.
- `history.location` and `scan_log.location` are legacy strings alongside `location_id`.

Recommended relational upgrade:

Add user references:

```sql
alter table history add column performed_by_user_id integer references users(id) on delete set null;
alter table scan_log add column operator_user_id integer references users(id) on delete set null;
```

Add indexes:

```sql
create index if not exists history_account_user_created_idx
  on history (account_id, performed_by_user_id, created_at);

create index if not exists scan_log_account_user_created_idx
  on scan_log (account_id, operator_user_id, created_at);
```

Recommended behavior:

- Keep `performed_by` and `operator` as audit display snapshots.
- Use `performed_by_user_id` and `operator_user_id` for relational joins, permissions, reports, and accountability.

Why this helps:

- Lets us answer “who did this?” without fragile name matching.
- Enables fast per-user audit reports.
- Keeps historical readability even if a user changes display name later.

## 2. Item Relationships In History And Scan Logs

Current issue:

- `history.item_id` and `scan_log.item_id` are not formal foreign keys.
- This allows orphan references and weakens query planning.

Recommended relational upgrade:

```sql
alter table history
  add constraint history_item_id_fk
  foreign key (item_id) references items(id) on delete set null;

alter table scan_log
  add constraint scan_log_item_id_fk
  foreign key (item_id) references items(id) on delete set null;
```

Add compound indexes:

```sql
create index if not exists history_account_item_created_idx
  on history (account_id, item_id, created_at);

create index if not exists scan_log_account_item_created_idx
  on scan_log (account_id, item_id, created_at);
```

Why this helps:

- Prevents invalid references.
- Speeds item-level history timelines.
- Supports item drill-down pages cleanly.

## 3. Location Normalization

Current issue:

Several tables carry both a normalized ID and a legacy string:

- `items.location_id` and `items.location`
- `orders.location_id` and `orders.location`
- `history.location_id` and `history.location`
- `scan_log.location_id` and `scan_log.location`
- `warehouse_transfers.store_location_id` and `warehouse_transfers.store_location`
- `users.assigned_locations` and `user_location_assignments`

Recommended direction:

- Treat `location_id` as the relational source of truth.
- Keep the string fields only as snapshots during the transition.
- Eventually stop writing new business logic against text location fields.

Safe migration sequence:

1. Backfill missing `location_id` from matching `(account_id, location name)`.
2. Add reports that find rows still missing `location_id`.
3. Update API routes to always write both `location_id` and snapshot text.
4. Update read queries to join by `location_id`.
5. Later, make `location_id` required where appropriate.
6. Later still, consider removing legacy fields only after imports and workflows no longer depend on them.

Suggested check:

```sql
select 'items' as table_name, count(*) from items where location_id is null
union all select 'orders', count(*) from orders where location_id is null
union all select 'history', count(*) from history where location is not null and location_id is null
union all select 'scan_log', count(*) from scan_log where location is not null and location_id is null;
```

## 4. User Location Assignment Cleanup

Current issue:

- `users.assigned_locations` is a text array.
- `user_location_assignments` is the better relational model.

Recommended direction:

- Keep `assigned_locations` temporarily for compatibility.
- Make `user_location_assignments` the source of truth for permission checks.
- Backfill from `assigned_locations`.
- Update user management API to write `user_location_assignments` first.

Indexes already in place:

- Unique `(account_id, user_id, location_id)`.
- `(account_id, location_id)`.

Recommended additional index:

```sql
create index if not exists user_location_assignments_account_user_idx
  on user_location_assignments (account_id, user_id);
```

Why this helps:

- Quickly loads all locations a user can access.
- Avoids scanning by user when many location assignments exist.

## 5. Warehouse Purchases And Transfers

Current issue:

- `warehouse_purchases.warehouse_item_id` is a plain integer.
- `warehouse_transfers.warehouse_item_id` is a plain integer.
- `warehouse_transfers.store_item_id` is a plain integer.

Recommended relational upgrade:

```sql
alter table warehouse_purchases
  add constraint warehouse_purchases_item_fk
  foreign key (warehouse_item_id) references warehouse_items(id) on delete restrict;

alter table warehouse_transfers
  add constraint warehouse_transfers_warehouse_item_fk
  foreign key (warehouse_item_id) references warehouse_items(id) on delete restrict;

alter table warehouse_transfers
  add constraint warehouse_transfers_store_item_fk
  foreign key (store_item_id) references items(id) on delete set null;
```

Recommended indexes:

```sql
create index if not exists warehouse_purchases_account_item_created_idx
  on warehouse_purchases (account_id, warehouse_item_id, created_at);

create index if not exists warehouse_transfers_account_warehouse_item_created_idx
  on warehouse_transfers (account_id, warehouse_item_id, created_at);

create index if not exists warehouse_transfers_account_store_item_created_idx
  on warehouse_transfers (account_id, store_item_id, created_at);
```

Why this helps:

- Keeps purchase/transfer records tied to real inventory.
- Enables fast cost and movement history by item.
- Reduces data drift between warehouse and store inventory.

## 6. Orders And Route Sheets

Current state:

- Orders and order items are mostly relational.
- Route sheets, stops, and stop items are mostly relational.

Recommended improvements:

Add item timeline indexes:

```sql
create index if not exists order_items_account_item_idx
  on order_items (account_id, item_id);

create index if not exists route_sheet_stop_items_account_item_idx
  on route_sheet_stop_items (account_id, item_id);
```

Add useful route lookup index:

```sql
create index if not exists route_sheet_stops_account_location_created_idx
  on route_sheet_stops (account_id, location_id, created_at);
```

Why this helps:

- Faster item-level order history.
- Faster location-level route history.
- Better reporting without broad scans.

## 7. Status And Role Constraints

Current issue:

Many status/role fields are plain text. Application code controls expected values, but the database does not enforce all of them.

Examples:

- `users.role`
- `account_memberships.role`
- `orders.status`
- `route_sheets.status`
- `locations.status`
- `warehouses.status`

Recommended direction:

Use check constraints first, not PostgreSQL enums. Check constraints are easier to modify during early test-stage development.

Example:

```sql
alter table users
  add constraint users_role_check
  check (role in ('admin', 'warehouse', 'stocker'));

alter table account_memberships
  add constraint account_memberships_role_check
  check (role in ('admin', 'warehouse', 'stocker'));
```

Why this helps:

- Prevents bad state from imports/scripts.
- Keeps test data closer to production standards.
- Avoids hard-to-debug permission failures.

## 8. Updated Timestamp Maintenance

Current issue:

Several tables have `updated_at`, but the schema does not show database-level triggers to update it automatically.

Recommended direction:

Either:

- Keep updating timestamps in application code consistently, or
- Add a shared PostgreSQL trigger function for `updated_at`.

Example:

```sql
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
```

Then attach it to tables with `updated_at`.

Why this helps:

- Makes audit timing reliable.
- Reduces missed timestamp updates in future code paths.

## Prioritized Implementation Plan

### Phase 1: Safe Indexes And Audit Checks

Low risk. Good to implement first.

- Add missing performance indexes.
- Add schema-health queries.
- Add preflight checks for missing normalized references.
- Keep existing app behavior unchanged.

Recommended first indexes:

```sql
create index if not exists user_location_assignments_account_user_idx
  on user_location_assignments (account_id, user_id);

create index if not exists history_account_item_created_idx
  on history (account_id, item_id, created_at);

create index if not exists scan_log_account_item_created_idx
  on scan_log (account_id, item_id, created_at);

create index if not exists order_items_account_item_idx
  on order_items (account_id, item_id);

create index if not exists route_sheet_stop_items_account_item_idx
  on route_sheet_stop_items (account_id, item_id);
```

### Phase 2: Add User References To Logs

Medium risk. Requires small API write-path changes.

- Add `performed_by_user_id` to `history`.
- Add `operator_user_id` to `scan_log`.
- Update write paths to populate these from the authenticated user.
- Keep existing text fields as display snapshots.

### Phase 3: Add Foreign Keys For Existing Integer References

Medium risk. Requires confirming there are no orphan rows first.

Pre-check example:

```sql
select count(*) from history h
where h.item_id is not null
  and not exists (select 1 from items i where i.id = h.item_id);
```

Only add constraints after orphan checks pass or are repaired.

### Phase 4: Finish Location Normalization

Higher risk. Should be done after testing confirms all routes use `location_id`.

- Backfill missing location references.
- Update API reads/writes to rely on `location_id`.
- Make required location relationships `not null` where business rules require it.
- Retire legacy string use from query filters.

### Phase 5: Tighten Constraints

Higher risk but important before production.

- Role check constraints.
- Status check constraints.
- Optional `not null` constraints after backfill.
- Optional updated-at triggers.

## Suggested VPS Test Review Queries

Run these against `keeptally_test` before adding constraints:

```sql
select 'history orphan item_id' as check_name, count(*) as count
from history h
where h.item_id is not null
  and not exists (select 1 from items i where i.id = h.item_id)
union all
select 'scan_log orphan item_id', count(*)
from scan_log s
where s.item_id is not null
  and not exists (select 1 from items i where i.id = s.item_id)
union all
select 'warehouse_purchases orphan warehouse_item_id', count(*)
from warehouse_purchases wp
where not exists (select 1 from warehouse_items wi where wi.id = wp.warehouse_item_id)
union all
select 'warehouse_transfers orphan warehouse_item_id', count(*)
from warehouse_transfers wt
where not exists (select 1 from warehouse_items wi where wi.id = wt.warehouse_item_id)
union all
select 'warehouse_transfers orphan store_item_id', count(*)
from warehouse_transfers wt
where wt.store_item_id is not null
  and not exists (select 1 from items i where i.id = wt.store_item_id);
```

Also check missing normalized locations:

```sql
select 'items missing location_id' as check_name, count(*) from items where location_id is null
union all select 'orders missing location_id', count(*) from orders where location_id is null
union all select 'history missing location_id', count(*) from history where location is not null and location_id is null
union all select 'scan_log missing location_id', count(*) from scan_log where location is not null and location_id is null
union all select 'warehouse_transfers missing store_location_id', count(*) from warehouse_transfers where store_location_id is null;
```

## Recommendation

Start with Phase 1 immediately. It improves performance and gives us better visibility without changing behavior.

Then implement Phase 2 because users, history, and scan logs are operationally important. A clean relationship between users and audit records is one of the most valuable upgrades for accountability, reporting, and debugging.

Delay destructive cleanup, dropping legacy fields, and `not null` hardening until after the VPS test workflow has stable data and all API write paths are confirmed.
