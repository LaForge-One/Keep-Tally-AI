# Route Security Helper Cleanup

This PR centralizes duplicated route access helpers without changing route behavior, response shapes, UI, schema, or inventory logic.

## Centralized Helpers

- `canViewAllLocations(req)` now lives in `middleware/auth.ts`.
- `assertLocationAccess(req, res, location, message?)` now lives in `middleware/auth.ts`.
- Routes that used the standard `{ error: "Permission denied for this location" }` response now import the shared helper.
- Orders keeps its existing `{ error: "You do not have access to this location" }` response by passing that message to the shared helper.

## Routes Updated

- `command.ts`
- `dashboard.ts`
- `history.ts`
- `items.ts`
- `orders.ts`
- `restock.ts`
- `scan.ts`
- `voice.ts`
- `warehouse.ts`

## Manual Test Cases

1. Confirm an assigned-location user requesting another location still receives the same route-specific `403` response body.
2. Confirm orders routes still use `{ error: "You do not have access to this location" }`.
3. Confirm items, restock, scan, dashboard, and warehouse routes still use `{ error: "Permission denied for this location" }`.
4. Confirm admin and `view_all_locations` users still see all allowed location-scoped reads.
5. Confirm assigned-location users still see only assigned locations for no-location filter reads.
6. Confirm `pnpm run ci` passes after the helper imports are centralized.

## Remaining Duplication

Orders keeps a tiny local wrapper so its existing error message stays unchanged. Warehouse keeps `assertGlobalWarehouseAccess` because global warehouse inventory has no location column and intentionally uses a different response message.
