# Orders account and location context PR

## Summary

This PR scopes order and pick-list routes to the request account context while preserving the existing API response shapes. The routes continue to return legacy `location` strings for UI compatibility, but account-owned `locationId` values now drive access checks and query scoping.

## Manual test cases

- Admin can list, create, update, archive, delete, and receive orders across all account locations.
- A user with `view_all_locations` can read and manage orders across all account locations allowed by their account membership.
- Assigned-location users only see orders for their assigned locations when no location filter is provided.
- Assigned-location users receive `{ error: string }` with 403 when requesting or mutating another location.
- Creating an order with an invalid location returns the existing error response shape and does not create an order.
- Order item update/delete rejects order items whose linked inventory item is outside the order location.
- Receiving an order rejects cross-account or cross-location order items before inventory changes.
- Duplicate item IDs in one receive request still return `{ error: string }` and do not increment inventory twice.
- Repeated receive requests still fail after the first successful receive.
- Order list/detail responses still include `location`, `status`, timestamps, `itemCount`, and nested `items` as before.

## Notes

- No schema changes are included.
- Inventory math is unchanged except for account/location guards around the existing receive update.
- Legacy string `location` fields remain intact for response compatibility.
