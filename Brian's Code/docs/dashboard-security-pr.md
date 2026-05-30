# Dashboard Security PR Notes

This PR is intentionally limited to dashboard route location-scope hardening. It does not change schema, inventory math, auth behavior, response shapes, or unrelated route groups.

## Location-Scope Behavior

- Admins can read dashboard data across all locations.
- Users with `view_all_locations` can read dashboard data across all locations.
- Users without all-location access can only read dashboard data for their assigned locations.
- Requests for an inaccessible `location` return `403` with the existing `{ error: string }` shape.
- Users without assigned locations receive empty or zero dashboard data.
- Warehouse cost lookup remains internal to the existing voice dashboard calculations and is not returned as warehouse item data.

## Manual Test Cases

1. Sign in as an admin and confirm `GET /dashboard/summary` and `GET /dashboard/voice` include data across multiple locations.
2. Sign in as a user with `view_all_locations` and confirm both dashboard routes include data across multiple locations.
3. Sign in as a user assigned to one location and confirm both dashboard routes without a `location` filter only include that assigned location.
4. As a one-location user, call both dashboard routes with `?location=<assigned-location>` and confirm the responses succeed.
5. As a one-location user, call both dashboard routes with `?location=<other-location>` and confirm they return `403` with `{ error: string }`.
6. As a one-location user, confirm `recentChanges` on `GET /dashboard/summary` does not include another location.
7. As a one-location user, confirm `recentSessions` and `lastCountAt` on `GET /dashboard/voice` do not include another location's voice or command activity.
8. As a user with no assigned locations, confirm both dashboard routes return empty or zero data using the existing response fields.
9. Confirm response objects keep the existing fields for `GET /dashboard/summary` and `GET /dashboard/voice`.
