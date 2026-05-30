# History account and location context PR

## Summary

This PR scopes history reads to the request account context while preserving existing response shapes. Location filtering now prefers `locationId` from the account context and falls back to legacy string `location` values for older history rows.

## Manual test cases

- Admin can view all history rows for the active account.
- A user with `view_all_locations` can view all history rows for the active account.
- Assigned-location users only see history for their allowed locations.
- Assigned-location users with no assigned locations receive an empty array.
- Item-specific history remains scoped to the active account and allowed locations.
- Cross-account history rows are not returned.
- Legacy rows with null `locationId` still appear when their string `location` matches an assigned location.
- Response shape remains unchanged: `id`, `itemId`, `itemName`, `action`, `field`, values, note, source, performer fields, `location`, and `createdAt`.

## Notes

- No schema changes are included.
- No inventory logic is changed.
- This route remains read-only.
