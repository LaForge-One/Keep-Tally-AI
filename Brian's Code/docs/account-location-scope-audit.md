# Account and location scope audit

## Summary

This audit reviewed protected API routes, shared helpers, and database queries for account and location scoping gaps after the multi-tenant route conversion work.

## Findings addressed

- Item list/detail paths now preserve legacy string-location fallback for assigned-location users while still filtering by `accountId`.
- Order list paths now preserve legacy string-location fallback for assigned-location users while still filtering by `accountId`.
- Import apply no longer performs an unscoped item ID lookup before validation.
- The unused shared command parser item loader was removed because it returned all inventory items without account context.

## Manual test coverage

- Assigned-location users can still see legacy items with null `locationId` when the string `location` matches an assigned location.
- Assigned-location users can still see legacy orders with null `locationId` when the string `location` matches an assigned location.
- Assigned-location users cannot see items or orders from another account.
- Import apply rejects missing or cross-account item IDs before mutating inventory.
- Command parsing still works through the route-owned account-scoped item loading path.
- Admin and `view_all_locations` behavior remains unchanged.
- Existing response shapes remain unchanged.

## Notes

- No schema changes are included.
- No UI changes are included.
- Nullable `accountId` and `locationId` fields are intentionally left as-is for this phase.
- This repository does not currently have first-party API test files; validation is via CI and the manual cases above.
