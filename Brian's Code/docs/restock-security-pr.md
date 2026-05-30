# Restock Security PR Notes

This PR is intentionally limited to restock route location-scope hardening. It does not change UI, schema, inventory math, or unrelated route groups.

## Security Behavior

- Restock JSON and CSV routes require the existing `edit_store_inventory` permission.
- Admins and users with `view_all_locations` can view and export restock data for all locations.
- Assigned-location users can view and export restock data only for assigned locations.
- A requested `location` filter is validated before querying or exporting.
- Requests for inaccessible locations return the existing `{ error: string }` response shape.
- Requests without a location filter are automatically scoped to the user's assigned locations.
- Users with no assigned locations receive empty restock responses instead of cross-location data.

## Tenant/Account Limitation

The current schema has no tenant/account columns. This PR prevents cross-location restock leakage with the available assigned-location model, but true tenant/account isolation requires schema support.

## Manual Test Cases

1. Sign in as an admin and confirm `GET /restock` returns the same response shape for all under-par items.
2. Sign in as an admin and confirm `GET /restock.csv` exports all under-par item locations.
3. Sign in as a user with `view_all_locations` and confirm JSON and CSV restock routes include all locations.
4. Sign in as an assigned-location user and request `GET /restock` without a `location` filter; confirm only assigned locations appear.
5. Sign in as an assigned-location user and request `GET /restock.csv` without a `location` filter; confirm the export only includes assigned locations.
6. Sign in as an assigned-location user and request an assigned `location`; confirm the existing JSON response shape is unchanged.
7. Sign in as an assigned-location user and request another `location`; confirm it returns `403` with `{ error: string }`.
8. Sign in as a user without `edit_store_inventory`; confirm JSON and CSV routes return `403`.
9. Sign in as a user with no assigned locations; confirm JSON returns an empty restock list and CSV returns headers only.
10. Confirm no restock route changes item quantities, par levels, or history records.
