# Scan and Command Security PR Notes

This PR is intentionally limited to barcode scan and voice/text command access control. It does not change UI, schema, inventory math, or unrelated route groups.

## Security Behavior

- Scan lookup remains behind the existing `scan_barcodes` route permission.
- Scan lookup returns store items only from the requested accessible location, all locations for admin or `view_all_locations`, or the user's assigned locations when no location is requested.
- Warehouse barcode fallback is only returned to admin or `view_all_locations` users because warehouse inventory is global in the current schema.
- Scan mutations validate destination and source item locations before creating or updating inventory.
- Scan log reads are scoped in the database by requested location, all locations for admin or `view_all_locations`, or assigned locations.
- Command actions check mutation permissions before item matching or inventory changes.
- Command item matching loads only items the current user is allowed to access.
- Command location hints that are not accessible are rejected before item matching.
- Scan and command history rows include performer, role, and location metadata for actual inventory changes.
- New denials use the existing `{ error: string }` response shape.

## Tenant/Account Limitation

The current schema has no tenant/account columns. This PR prevents cross-location scan and command leakage with the available assigned-location model, but true tenant/account isolation requires schema support.

## Manual Test Cases

1. Sign in without `scan_barcodes` and confirm scan lookup/action/log routes return `403`.
2. As an assigned-location user, scan lookup with an assigned `location` and confirm the existing response shape is unchanged.
3. As an assigned-location user, scan lookup with another `location` and confirm it returns `403` with `{ error: string }`.
4. As an assigned-location user, scan lookup without a location and confirm only assigned-location store items are returned.
5. As an assigned-location user, scan an unknown store barcode that exists only in warehouse and confirm `warehouseItem` is not returned.
6. As admin or `view_all_locations`, scan an unknown store barcode that exists in warehouse and confirm the existing warehouse fallback still works.
7. As an assigned-location user, attempt scan `add-to-store`, `create`, `verify`, or `adjust` against an unauthorized location and confirm mutation is rejected.
8. As a user missing `edit_store_inventory`, attempt command set/add/reduce/create and confirm it returns `403`.
9. As a user missing `delete_items`, attempt command delete and confirm it returns `403`.
10. As an assigned-location user, issue a command for an unauthorized location and confirm it returns `{ error: string }` before mutation.
11. As an assigned-location user, issue a command without a location and confirm matching is limited to assigned locations.
12. Confirm successful scan and command mutations preserve response shapes.
13. Confirm scan and command mutations write history rows with performer, role, and location metadata.
