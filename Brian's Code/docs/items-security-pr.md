# Items Security PR Notes

This PR is intentionally limited to documenting the current items route location-scope hardening. It does not change schema, inventory math, auth behavior, or unrelated route groups.

## Current Location-Scope Coverage

- `GET /items` returns only the requested accessible location, all locations for admins or users with `view_all_locations`, or the authenticated user's assigned locations.
- `POST /items` requires access to the submitted item location before creating inventory.
- `GET /items/:id` loads the item first and requires access to the item's actual location before returning it.
- `PATCH /items/:id` requires access to the existing item location and also requires access to a new location when moving an item.
- `POST /items/:id/adjust` requires access to the item's actual location before changing quantity.
- `POST /items/:id/verify` requires access to the item's actual location before recording verification history.
- `DELETE /items/:id` requires access to the item's actual location before deleting.

## Manual Test Cases

1. Sign in as an admin and confirm `GET /items` returns items from all locations.
2. Sign in as a user with `view_all_locations` and confirm `GET /items` returns items from all locations.
3. Sign in as a user assigned to one location and confirm `GET /items` without a location only returns that location.
4. As a one-location user, call `GET /items?location=<other-location>` and confirm it returns `403`.
5. As a one-location user, call `GET /items/:id` for an item in another location and confirm it returns `403`.
6. As a one-location user, attempt to create an item in another location and confirm it returns `403`.
7. As a one-location user, attempt to update, adjust, verify, or delete an item in another location and confirm each route returns `403`.
8. As a one-location user, attempt to move an accessible item into an inaccessible location and confirm it returns `403`.
9. Confirm successful item create, update, adjust, verify, and delete responses keep their existing response shapes for accessible locations.
