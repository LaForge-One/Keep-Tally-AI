# Multi-Tenant Repair Migration

## Summary

- Adds an idempotent repair-only migration that re-runs default account, location, warehouse, membership, and assignment backfills.
- Backfills missing account, location, and warehouse links for legacy tenant-owned records without changing runtime behavior.
- Adds safety checks that fail the migration if rows still cannot be safely linked.

## Scope

- No route behavior changes.
- No UI changes.
- No NOT NULL constraints or schema tightening.
- Legacy string location fields remain intact for compatibility.

## Safety Checks

- Confirms default account exists.
- Confirms users have account memberships.
- Confirms assigned legacy locations have user location assignment rows.
- Confirms items, orders, history, scan logs, and warehouse records have expected account/location or account/warehouse links.
- Confirms linked locations and warehouses belong to the same account as the owning record.

## Validation

- Run `pnpm run ci`.
