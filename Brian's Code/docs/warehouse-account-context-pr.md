# Warehouse account context PR

## Summary

This PR scopes warehouse inventory, purchase, export, import, receive, and transfer routes to the active request account while preserving existing response shapes and warehouse workflow behavior.

## Manual test cases

- Admin can view warehouse dashboard, inventory, item detail, purchase analytics, and CSV exports for the active account.
- A user with `view_all_locations` can use warehouse routes according to existing warehouse permissions.
- Warehouse inventory reads only return `warehouse_items` for `req.account.id`.
- Warehouse purchase reads and exports only return `warehouse_purchases` for `req.account.id`.
- Warehouse item create/update/delete only writes rows for `req.account.id`.
- Warehouse receive creates account-scoped purchase rows and updates only account-scoped warehouse items.
- Warehouse import upsert only matches and updates barcodes inside the active account.
- Warehouse transfer validates the target store location and store item against the active account.
- Restricted users cannot transfer inventory into unauthorized store locations.
- Existing response shapes for warehouse dashboard, inventory list, item detail, purchases, exports, imports, receives, and transfers remain unchanged.

## Notes

- No schema changes are included.
- No UI changes are included.
- Inventory math is unchanged except for account and allowed-location guards.
- Warehouse inventory remains globally visible only to users with the existing warehouse/all-location access behavior.
