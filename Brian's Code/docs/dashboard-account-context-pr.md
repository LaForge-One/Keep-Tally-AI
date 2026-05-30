# Dashboard account and location context PR

## Summary

This PR scopes dashboard summary and voice-dashboard reads to the request account context. Dashboard totals, below-par summaries, recent activity, voice sessions, and warehouse cost lookups now use account-scoped queries and allowed location IDs while preserving existing response shapes.

## Manual test cases

- Admin can view dashboard totals for all locations in the active account.
- A user with `view_all_locations` can view all dashboard totals for the active account.
- Assigned-location users only see totals, below-par items, recent changes, and voice sessions for assigned locations.
- A restricted user requesting an unauthorized location receives `{ error: string }` with 403.
- A requested location outside the active account is rejected and does not leak totals.
- Dashboard voice cost lookups use warehouse items from the active account only.
- Legacy rows with null `locationId` still appear when their string `location` matches an assigned location.
- `/dashboard/summary` response shape remains unchanged.
- `/dashboard/voice` response shape remains unchanged.

## Notes

- No schema changes are included.
- No UI changes are included.
- Inventory math is unchanged.
