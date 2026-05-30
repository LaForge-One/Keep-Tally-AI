# KeepTally migration cleanup plan

## Goal

Prepare KeepTally to move from legacy single-tenant compatibility to strict tenant/location ownership without changing current route behavior yet. Legacy string `location` fields and fallback reads stay in place until data reports show the database is fully linked.

## Current nullable ownership columns

These columns are still nullable in the Drizzle schema and should be treated as cleanup targets:

- `users.account_id`
- `role_permissions.account_id`
- `items.account_id`
- `items.location_id`
- `orders.account_id`
- `orders.location_id`
- `order_items.account_id`
- `history.account_id`
- `history.location_id`
- `scan_log.account_id`
- `scan_log.location_id`
- `warehouse_items.account_id`
- `warehouse_items.warehouse_id`
- `warehouse_purchases.account_id`
- `warehouse_purchases.warehouse_id`
- `warehouse_transfers.account_id`
- `warehouse_transfers.warehouse_id`
- `warehouse_transfers.store_location_id`
- `warehouses.location_id`

Already non-null foundational ownership columns:

- `accounts.id`
- `locations.account_id`
- `account_memberships.account_id`
- `account_memberships.user_id`
- `user_location_assignments.account_id`
- `user_location_assignments.user_id`
- `user_location_assignments.location_id`
- `warehouses.account_id`

## Records that would fail if enforced today

Run the read-only report before each cleanup migration:

```powershell
pnpm --filter @workspace/scripts run report:tenant-links
```

Rows reported as `blocker` would fail a strict tenant/account migration. Rows reported as `warning` may be valid during the compatibility phase, but should be resolved or intentionally exempted before removing legacy fallback.

Likely blockers to watch:

- Users without `account_id`.
- Active users without an active account membership.
- Legacy `assigned_locations` values without matching `user_location_assignments`.
- Items, orders, order items, history, scan log, warehouse items, purchases, or transfers without `account_id`.
- Items or orders without `location_id`.
- Location IDs that belong to a different account than their parent row.

Likely warnings to decide before final enforcement:

- `role_permissions.account_id IS NULL`: these are global/default fallback permissions. Keep them nullable until every account has seeded account-scoped permissions and auth no longer needs global fallback.
- `history.location_id IS NULL` when `history.location` is null: some audit rows are account-level and may not need a location.
- `scan_log.location_id IS NULL` when `scan_log.location` is null: some logs may not be tied to a store location.
- `warehouse_id` null on warehouse item/purchase/transfer rows: decide whether the default warehouse should be required for all warehouse records.
- `warehouses.location_id IS NULL`: a warehouse may be a global warehouse rather than a store location. Do not force this until the product model decides whether warehouses are locations.

## Legacy string location fallback still in use

Keep these until the report is clean and the product is ready for a compatibility-breaking cleanup:

- `middleware/auth.ts`: `canAccessLocation` checks `authUser.assignedLocations`.
- `auth.ts`: login and `/auth/me` still return `assignedLocations` for UI compatibility.
- `users.ts`: user management still reads/writes legacy `assignedLocations` while syncing `user_location_assignments`.
- `items.ts`: list/detail/mutation checks still fall back to `items.location`.
- `orders.ts`: list/access/receive logic still falls back to `orders.location` and `items.location`.
- `history.ts`: restricted history reads still fall back to `history.location`.
- `dashboard.ts`: item/history summaries still merge `locationId` and string `location`.
- `import.ts`: preview/apply access checks still fall back to item string `location`.
- `restock.ts`: restock reads/exports still merge `locationId` and string `location`.
- `scan.ts`: lookup/action/log logic still merges or checks string `location`.
- `command.ts`: command item matching and access checks still use string `location` fallback.
- `voice.ts`: voice item filtering still falls back to string `location`.
- `warehouse.ts`: store transfer validation still compares string store locations for legacy rows.
- `commandParser.ts`: fuzzy matching still uses `item.location` for location hints.

## Seeded/demo data notes

- `scripts/src/seed.ts` still inserts legacy items and history without `accountId` / `locationId`.
- `scripts/src/import-csv.ts` still imports legacy items and history without tenant/location links.
- These scripts are not safe for strict multi-tenant production seeding yet. Update them before enforcing NOT NULL constraints or restrict them to local-only legacy usage.

## Cleanup migration order

1. Keep current runtime behavior and legacy fallback while adding visibility.
   - Run `report:tenant-links` against local/staging/prod.
   - Save output before any migration.

2. Repair seed/import scripts.
   - Require a target account and location.
   - Insert or resolve `locations` records before inserting items/history.
   - Write both `accountId` and `locationId` while preserving string `location`.

3. Add an idempotent data repair migration.
   - Ensure a default account exists for legacy deployments.
   - Ensure locations exist for every legacy string location.
   - Backfill `account_id` and `location_id` on items, orders, history, scan log, and warehouse transfers.
   - Backfill `account_id` and warehouse links on warehouse items/purchases/transfers.
   - Backfill user memberships and user location assignments.
   - Backfill account-scoped role permissions for every account.

4. Add database safety checks.
   - Use `DO $$` checks that raise if blockers remain.
   - Keep checks separate from NOT NULL changes at first so failures are easy to diagnose.

5. Tighten account ownership columns first.
   - Make `account_id` NOT NULL on users, items, orders, order_items, history, scan_log, warehouse_items, warehouse_purchases, warehouse_transfers, and role_permissions only after global permission fallback is retired.
   - Keep `location_id` nullable where rows are legitimately account-level.

6. Tighten location ownership columns by domain.
   - Items and orders should require `location_id`.
   - Warehouse transfer `store_location_id` should be required if every transfer goes to a location.
   - History and scan log need a product decision: either require location for inventory events only, or allow account-level audit rows.
   - Warehouse rows need a product decision before forcing `warehouses.location_id`.

7. Remove legacy fallback in route code.
   - Remove string-location merge queries after all live data has IDs.
   - Keep response shape `location` until the UI is migrated.
   - Later, optionally expose `locationId` in API responses as an additive field.

8. Remove or deprecate legacy columns.
   - Only after UI/API clients no longer depend on string location writes.
   - Consider leaving `location` as denormalized display text if it remains useful for audit history.

## Safety checks before NOT NULL

Every enforcement migration should verify:

- No target table has `account_id IS NULL`.
- Every location-scoped table has a valid `location_id` or an explicitly allowed account-level exception.
- Every location ID belongs to the same account as the parent record.
- Every active user has an active account membership.
- Every assigned legacy user location has a matching `user_location_assignments` row.
- Every account has account-scoped role permissions before global permission fallback is removed.
- Seed/import scripts have been updated so new rows cannot reintroduce null links.
- The route fallback audit has been repeated, with each remaining fallback intentionally accepted or scheduled for removal.

## Recommended next PRs

1. Update seed/import scripts to write account and location links.
2. Add a repair-only migration that re-runs backfills and safety checks without changing constraints.
3. Add account-scoped role permission seeding for every account and retire global permission fallback.
4. Enforce NOT NULL on account ownership columns.
5. Enforce location IDs for items/orders and then remove legacy fallback route by route.
