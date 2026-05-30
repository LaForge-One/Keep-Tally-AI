# Account/Location Required-Field Readiness

## Summary

This audit prepares the next constraint phase without changing schema nullability, route behavior, API response shapes, or legacy string location fallback. The current database shape is ready for continued repair/reporting work, but not for blanket `NOT NULL` enforcement yet.

## Remaining Nullable Tenant Fields

These ownership fields are still nullable in the Drizzle schema:

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

Already-required tenant foundation fields:

- `locations.account_id`
- `warehouses.account_id`
- `account_memberships.account_id`
- `account_memberships.user_id`
- `user_location_assignments.account_id`
- `user_location_assignments.user_id`
- `user_location_assignments.location_id`

## Rows That Would Block Enforcement

Before any `NOT NULL` migration, run the tenant link report and the repair migration safety checks against the target environment. Any rows in these groups block enforcement:

- Users with no `account_id`.
- Users with no matching `account_memberships` row.
- Legacy `users.assigned_locations` values without matching `user_location_assignments`.
- Items or orders without `account_id` or `location_id`.
- Order items without an `account_id` matching their order.
- History or scan log rows without `account_id`.
- History or scan log rows with legacy `location` text but no `location_id`.
- Warehouse items, purchases, or transfers without `account_id`.
- Warehouse items or purchases without `warehouse_id`.
- Warehouse transfers without `warehouse_id` or `store_location_id`.
- Any linked location or warehouse whose account does not match the owning row.

Intentional exceptions to decide before enforcement:

- `history.location_id` may remain nullable for account-level audit events with no store location.
- `scan_log.location_id` may remain nullable if non-location scan events are valid.
- `warehouses.location_id` may remain nullable if a warehouse is account-level rather than store-specific.
- `role_permissions.account_id` should not become required until global/default permission fallback is fully retired.

## Legacy Location Fallback Still Required

Do not remove legacy string location compatibility until all live rows have durable location links and the UI/API no longer writes location strings as the source of truth.

Known fallback surfaces:

- `auth` and user-management flows still expose `assignedLocations`.
- Item, order, history, dashboard, import, restock, scan, command, voice, and warehouse routes still preserve string-location matching for legacy rows.
- Seed/import compatibility still preserves string `location` fields even after resolving `accountId` and `locationId`.

## Exact Migration Order

1. Keep reporting and repair-only checks in place.
   - Run the read-only tenant link report.
   - Run migrations through `0003_multi_tenant_repair_checks`.
   - Confirm no repair safety checks fail.

2. Enforce account-owned identity records first.
   - `users.account_id`
   - `items.account_id`
   - `orders.account_id`
   - `order_items.account_id`
   - `history.account_id`
   - `scan_log.account_id`
   - `warehouse_items.account_id`
   - `warehouse_purchases.account_id`
   - `warehouse_transfers.account_id`

3. Enforce primary operational location links.
   - `items.location_id`
   - `orders.location_id`
   - `warehouse_transfers.store_location_id`

4. Enforce warehouse links.
   - `warehouse_items.warehouse_id`
   - `warehouse_purchases.warehouse_id`
   - `warehouse_transfers.warehouse_id`

5. Retire global permission fallback, then enforce permissions.
   - Seed account-scoped role permissions for every account.
   - Remove runtime dependency on null/global role permissions.
   - Enforce `role_permissions.account_id`.

6. Decide account-level event policy before optional location constraints.
   - Either leave `history.location_id` and `scan_log.location_id` nullable for account-level events, or enforce only for inventory/location event subsets.
   - Decide whether `warehouses.location_id` represents an optional store relationship or a required physical location.

7. Remove legacy string fallback route by route.
   - Keep response shape compatibility while moving writes and filters to IDs.
   - Remove fallback only after production reports show no legacy-only rows.

## Safety Checks Before Each Constraint

Each enforcement migration should include `DO $$` checks that raise before altering columns:

- Target column has no null values.
- Every foreign key points to an existing row.
- Every location or warehouse belongs to the same account as the owning row.
- Every active user has an active account membership.
- Every account has account-scoped role permissions before permission fallback removal.
- Seed/import flows write tenant/location IDs before constraints are tightened.

## Recommended PR Title

Scope account/location required-field readiness
