# DB/API Schema Reconciliation

This note records the current `@workspace/db` audit against `artifacts/api-server`.

## API Imports Checked

The API imports these symbols from `@workspace/db`:

- `db`
- `itemsTable`
- `historyTable`
- `usersTable`
- `rolePermissionsTable`
- `ordersTable`
- `orderItemsTable`
- `scanLogTable`
- `warehouseItemsTable`
- `warehousePurchasesTable`
- `warehouseTransfersTable`
- `PERMISSION_KEYS`
- `USER_ROLES`
- `DEFAULT_PERMISSIONS`
- `ItemRow`
- `PermissionKey`
- `UserRole`

All of these are present in `lib/db/src` and are re-exported through `lib/db/src/schema/index.ts` and `lib/db/src/index.ts`.

## Schema Alignment Checked

The source schema includes the columns the API currently assumes:

- Store items: `barcode`, `quantity`, `parLevel`, `location`, `lastUpdated`
- History: `performedBy`, `performedByRole`, `location`, `source`
- Users: `assignedLocations`, `active`, `mustChangePassword`
- Role permissions: `role`, `permissionKey`, `enabled`
- Orders and order items: archive/delete metadata plus ordered, picked, and received quantities
- Scan log: barcode, item/location/action fields, operator, and quantity change fields
- Warehouse inventory, purchases, and transfers tables

## Finding

The source DB package is current enough for the API expectations above. The stale artifact is `lib/db/dist`, which only contains older declaration output for `items` and `history`. Because `dist` is ignored build output, this PR does not manually edit it. Instead, `@workspace/db` now explicitly resolves both runtime and type consumers to the source entrypoints used by the workspace.

## Out Of Scope

- No database schema redesign
- No migration changes
- No inventory math changes
- No route behavior changes
