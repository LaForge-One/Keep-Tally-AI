# Import account and location context PR

## Summary

This PR scopes CSV import preview and apply flows to the active request account. It preserves existing preview/apply response shapes while ensuring imported rows can only match and update inventory items in the current account and allowed locations.

## Manual test cases

- Admin can preview and apply imports for all locations in the active account.
- A user with `view_all_locations` can preview and apply imports for all active account locations.
- Assigned-location users only preview matches from assigned locations.
- Assigned-location users receive `{ error: string }` when a CSV includes an unauthorized location.
- CSV rows for locations outside the active account are rejected before preview results are returned.
- Import apply rejects item IDs from another account before any inventory updates are made.
- Import apply rejects unauthorized assigned-location item IDs before any inventory updates are made.
- Deduct mode writes account- and location-scoped history rows only when quantity changes.
- Par mode writes account- and location-scoped history rows only when par level changes.
- Existing success response shapes for preview and apply remain unchanged.

## Notes

- No schema changes are included.
- No UI changes are included.
- Existing import math and fuzzy matching behavior are unchanged.
