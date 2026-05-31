# VPS Test Data and Database Edge Cases

Generated: 2026-05-30

This document describes the expanded VPS test seed and the database edge-case checks added to make testing safer.

## Expanded Test Seed

The TypeScript seed file is:

```text
scripts/src/seed.ts
```

It now creates a deterministic vending-style inventory catalog instead of only the original small sample set.

Default behavior:

- Targets 600 store inventory rows.
- Uses four locations:
  - `Carvana North`
  - `Carvana South`
  - `Carvana 1305`
  - `Mesa Warehouse`
- Generates vending-style products across:
  - Beverages
  - Candy
  - Chips
  - Snacks
  - Pastries
- Creates matching `history` rows with source `seed`.
- Preserves existing admin/users/accounts/permissions.
- Tops up missing items instead of automatically wiping the database.

The generated data intentionally includes some realistic testing variety:

- Zero-quantity items.
- Very low quantity items.
- Items with par level `0`.
- Items without barcodes.
- Same product families repeated across multiple locations.
- Punctuation-heavy names such as `M&M's`.

These are useful for scanner, voice, import, low-stock, par-level, and search testing.

## VPS Seed Commands

Top up the database to roughly 600 items:

```bash
cd "/root/Keep-Tally-AI/Brian's Code"

docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm -e SEED_ITEM_COUNT=600 keeptally corepack pnpm --filter @workspace/scripts run seed
```

Reset test inventory and rebuild the 600-item seed:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm -e SEED_RESET=true -e SEED_ITEM_COUNT=600 keeptally corepack pnpm --filter @workspace/scripts run seed
```

Use reset only for the VPS test database. It removes account inventory and account history before recreating test inventory.

## Added Preflight Edge-Case Checks

The deploy preflight now checks for:

- Missing Phase 1 relational indexes.
- Orphan item references in `history`.
- Orphan item references in `scan_log`.
- Orphan warehouse item references in `warehouse_purchases`.
- Orphan warehouse item references in `warehouse_transfers`.
- Missing normalized location references.
- Negative store item quantity.
- Negative store par levels.
- Duplicate item names within the same account/location.
- Duplicate barcodes within the same account/location.
- Negative warehouse item quantity.
- Duplicate warehouse item names within the same account/warehouse.
- Active users without active account memberships.
- Legacy assigned location names that do not have normalized assignment rows.

These checks are warnings where appropriate, so they help testing without blocking every experimental data state.

## Recommended Test Flow

1. Apply migrations.
2. Seed or reset-seed test inventory.
3. Run preflight.
4. Log in as admin.
5. Change the admin password.
6. Validate dashboard, scan, voice-check, warehouse, orders, route sheets, and user-management workflows.

Commands:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm keeptally corepack pnpm --filter @workspace/db run migrate

docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm -e SEED_ITEM_COUNT=600 keeptally corepack pnpm --filter @workspace/scripts run seed

docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm keeptally corepack pnpm run deploy:preflight
```

## Useful Manual Counts

```sql
select l.name, count(i.id) as items
from locations l
left join items i on i.location_id = l.id
group by l.name
order by l.name;

select category, count(*) as items
from items
group by category
order by category;

select
  count(*) as total_items,
  count(*) filter (where quantity = 0) as zero_quantity,
  count(*) filter (where quantity <= 2) as low_quantity,
  count(*) filter (where barcode is null or trim(barcode) = '') as missing_barcode
from items;
```

## Production Transition Note

The 600-item catalog is test data. It is useful for load, workflow, voice, scanner, and edge-case testing, but it should not be treated as real customer inventory.

Before production, replace the seed data with import-based customer inventory and keep the preflight checks in place.
