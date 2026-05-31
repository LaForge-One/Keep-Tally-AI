# Store Min/Max Stock Implementation

Last updated: May 30, 2026

## Business Rule

Store inventory now uses a stocking range instead of relying on a single par value.

- `quantity`: current system quantity at the store.
- `min_quantity`: lowest acceptable quantity before replenishment is needed.
- `max_quantity`: refill target for that item at that location.

Replenishment logic:

```text
if quantity < min_quantity:
  recommended_transfer_quantity = max_quantity - quantity
else:
  recommended_transfer_quantity = 0
```

The old `par_level` field is preserved as a compatibility alias during the test phase. New code writes `par_level` to the same value as `min_quantity` so older screens and reports do not break while the application is migrated.

## Implemented Changes

- Added `items.min_quantity` and `items.max_quantity`.
- Added migration `0008_store_min_max_stock.sql`.
- Updated store item serialization to return `minQuantity` and `maxQuantity`.
- Updated store create/edit payloads to accept `minQuantity` and `maxQuantity`.
- Updated restock logic to trigger when `quantity < min_quantity`.
- Updated restock quantities to refill toward `max_quantity`.
- Updated dashboard low-stock logic to use `min_quantity`.
- Updated store voice count prompts to say current system quantity and stock range.
- Updated store voice verification to compare spoken count against current system quantity.
- Updated seed data to generate deterministic min/max ranges.
- Updated deployment preflight to check min/max data health.
- Added a read-only agent middleware endpoint at `GET /api/agents/housekeeping`.

## Precheck Expectations

The VPS test database should pass these checks before user access testing:

- `min_quantity >= 0`.
- `max_quantity >= 0`.
- `max_quantity >= min_quantity`.
- Store items below minimum are warnings, not failures.
- Restock output should include items where `quantity < min_quantity`.
- Recommended transfer quantity should equal `max_quantity - quantity`.

## Agent Middleware Layer

The first AI-agent layer is intentionally read-only. It acts as a middleware service between the frontend and backend by summarizing operational recommendations from normalized backend data.

Current endpoint:

```text
GET /api/agents/housekeeping
```

Current recommendation types:

- `store_restock`: store item is below minimum or out of stock.
- `store_overstock`: store item is above maximum.
- `warehouse_reorder`: warehouse item is below its warehouse reorder range.

The endpoint does not mutate inventory. It returns recommendations for review, which keeps the system safe while the agent layer is tested.

## Next Step

The next natural step is to add a frontend panel for housekeeping recommendations and then decide which recommendations can become user-confirmed actions, such as creating a transfer draft from warehouse to store.
