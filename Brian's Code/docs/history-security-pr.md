# History Security PR Notes

This PR is intentionally limited to history route location-scope hardening. It does not change schema, inventory logic, response shapes, or unrelated route groups.

## Location-Scope Behavior

- Admins can read all history rows.
- Users with `view_all_locations` can read all history rows.
- Users without all-location access can only read history rows whose `location` is in their assigned locations.
- Users without assigned locations receive an empty history list.
- Legacy history rows with no `location` are hidden from location-limited users because the route cannot prove they belong to an assigned location.

## Manual Test Cases

1. Sign in as an admin and confirm `GET /history` returns rows from multiple locations.
2. Sign in as a user with `view_all_locations` and confirm `GET /history` returns rows from multiple locations.
3. Sign in as a user assigned to one location and confirm `GET /history` only returns rows from that location.
4. As a one-location user, confirm `GET /history?itemId=<same-location-item>` returns only history rows for that assigned location.
5. As a one-location user, confirm `GET /history?itemId=<other-location-item>` returns an empty list instead of cross-location rows.
6. As a user with no assigned locations, confirm `GET /history` and `GET /history?itemId=<id>` return an empty list.
7. Confirm response objects still include the existing fields: `id`, `itemId`, `itemName`, `action`, `field`, `previousValue`, `newValue`, `note`, `source`, `performedBy`, `performedByRole`, `location`, and `createdAt`.
