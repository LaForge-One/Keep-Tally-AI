# Scan and command account context PR

## Summary

This PR scopes barcode scan and natural-language command routes to the active request account and allowed locations while preserving existing response shapes.

## Manual test cases

- Barcode lookup only returns store items from the active account.
- Barcode lookup with a location only returns items from that account-owned location.
- Restricted users only see barcode matches from assigned locations.
- Warehouse catalog fallback only returns warehouse items from the active account.
- Scan verify and adjust reject cross-account or unauthorized-location item IDs.
- Scan create and add-to-store validate target locations against the active account.
- Scan history/log reads only return active-account entries from allowed locations.
- Command create validates the requested location against the active account.
- Command set/add/reduce/delete only load and mutate items from the active account.
- Command mutations write account- and location-scoped history rows.
- Existing scan and command response shapes remain unchanged.

## Notes

- No schema changes are included.
- No UI changes are included.
- Inventory math and command parsing behavior are unchanged.
- Legacy rows with null `locationId` continue to work through string-location fallback.
