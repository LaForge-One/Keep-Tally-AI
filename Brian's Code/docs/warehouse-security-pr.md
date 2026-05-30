# Warehouse Security PR Notes

This PR is intentionally limited to warehouse route location-scope hardening. It does not change schema, redesign warehouse workflows, or change existing inventory math except to stop unauthorized transfer attempts before any inventory mutation occurs.

## Location-Scope Behavior

- Admins can access all warehouse inventory, purchase, receive, import, and export routes.
- Users with `view_all_locations` can access all warehouse inventory, purchase, receive, import, and export routes.
- Warehouse inventory and purchase records are global because the current schema has no warehouse location column, so location-limited users are denied access to routes that cannot be filtered safely.
- Transfer requests validate the destination `storeLocation` against the user's assigned locations.
- Transfer requests with a `storeItemId` validate that the store item exists and belongs to the requested `storeLocation` before any warehouse quantity is decremented.
- New access denials use the existing `{ error: string }` response shape.

## Manual Test Cases

1. Sign in as an admin and confirm all warehouse read, receive, transfer, import, and export routes still work.
2. Sign in as a user with `view_all_locations` and confirm all warehouse read, receive, transfer, import, and export routes still work.
3. Sign in as a location-limited user with warehouse permissions and confirm global warehouse inventory, purchase, receive, import, and export routes return `403` with `{ error: string }`.
4. As a location-limited user with `transfer_inventory`, transfer warehouse stock to an assigned `storeLocation` and confirm the existing response shape is unchanged.
5. As a location-limited user with `transfer_inventory`, transfer warehouse stock to another `storeLocation` and confirm it returns `403` before warehouse quantity changes.
6. Transfer with a `storeItemId` from a different store than `storeLocation` and confirm it returns `400` before warehouse quantity changes.
7. Transfer with a missing `storeItemId` and confirm it returns `404` before warehouse quantity changes.
8. As a user with no assigned locations, confirm transfer to any store location returns `403`.
9. Confirm successful transfer, receive, purchase, import, and export response shapes remain unchanged for authorized users.
