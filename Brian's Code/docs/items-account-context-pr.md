# Items Account and Location Context

## Scope

- Item reads now require request account context and filter by `items.account_id`.
- Location-filtered item reads resolve the legacy location string to the current account's `locations.id`.
- Item create/update/delete, quantity adjustment, and verify flows require access to the resolved item location.
- New item writes store both the legacy `location` string and the new `location_id`.
- Existing response shapes are preserved by continuing to serialize only the legacy item fields used by the UI.

## Manual Test Cases

1. Cross-account item lookup blocked
   - Sign in as an admin for Account A.
   - Request `GET /items/:id` for an item whose `account_id` belongs to Account B.
   - Expect `{ "error": "Item not found" }`.

2. Unauthorized location inventory blocked
   - Sign in as a user without `view_all_locations` and without assignment to Location B.
   - Request `GET /items?location=Location B`.
   - Expect `{ "error": "Permission denied for this location" }`.

3. Invalid location rejected
   - Attempt to create or move an item using a location string that does not map to an active location in the current account.
   - Expect `{ "error": "Invalid location" }`.

4. Admin and view_all_locations behavior preserved
   - Sign in as an admin or a user with `view_all_locations`.
   - Request `GET /items` without a location filter.
   - Expect all current-account items and no cross-account items.

5. Existing response shape preserved
   - Create, read, update, adjust, and verify an item.
   - Confirm responses still expose `id`, `name`, `category`, `quantity`, `parLevel`, `location`, `barcode`, `lastUpdated`, and `createdAt`.
   - Confirm `accountId` and `locationId` are not returned in item API responses.

6. Legacy location compatibility
   - Create an item in a valid location.
   - Confirm the item row has both `location` and `location_id` populated.
   - Confirm the UI still shows the legacy location string.
