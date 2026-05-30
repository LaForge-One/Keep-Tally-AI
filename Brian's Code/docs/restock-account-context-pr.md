# Restock account and location context PR

## Summary

This PR scopes restock JSON and CSV reads to the active request account and allowed locations while preserving existing response shapes.

## Manual test cases

- Admin can view and export restock data for all active account locations.
- A user with `view_all_locations` can view and export restock data for all active account locations.
- Assigned-location users only see restock rows from their allowed locations.
- Assigned-location users with no assigned locations receive an empty restock list.
- Requesting an unauthorized location returns `{ error: string }` with 403.
- Requesting a location outside the active account returns `{ error: string }`.
- Restock CSV export includes only rows visible to the requesting user.
- Legacy item rows with null `locationId` still appear when their string `location` matches an assigned location.
- `/restock` and `/restock.csv` response shapes remain unchanged.

## Notes

- No schema changes are included.
- No UI changes are included.
- Restock inventory math is unchanged.
