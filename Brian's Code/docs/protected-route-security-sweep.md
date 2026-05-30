# Final Protected-Route Security Sweep

This PR is intentionally limited to protected-route security review and the remaining voice parser hardening. It does not change UI, schema, inventory math, or unrelated workflows.

## Route Registration Review

- `health` and `auth` are mounted before global authentication.
- Protected API routes are mounted after `requireAuth`.
- `auth/change-password` and `auth/me` keep their route-level `requireAuth` checks.
- `command` keeps command rate limiting before the command handler.
- `orders` and `import` keep `edit_store_inventory`.
- `scan` keeps `scan_barcodes`.
- `voice` keeps `use_voice_mode`.
- Warehouse, user, item, history, dashboard, restock, scan, command, import, and order route groups have route-level permission or location-scope checks from the recent hardening PRs.

## Voice Hardening

- `/voice/transcribe`, `/voice/speak`, and `/voice/parse` remain protected by the router-level `requireAuth` and `use_voice_mode` middleware.
- `/voice/parse` no longer trusts the client-provided item list for custom item matching.
- Custom voice parse items are checked against server-side inventory rows.
- Users with `view_all_locations` or admin role can parse against all provided valid item IDs.
- Assigned-location users can parse only item IDs from locations they are allowed to access.
- Unauthorized or nonexistent item IDs are removed before building the model prompt.
- Existing parse response shapes are preserved.

## Auth/Session Review

- Login uses a generic invalid-credentials response for missing, inactive, or wrong-password users.
- Login sets an HTTP-only cookie and returns the existing user response shape.
- Logout only clears the auth cookie and returns the existing `{ ok: true }` shape.
- `loadUser` ignores missing, invalid, inactive, or stale tokens and protected routes still require `req.authUser`.
- The current schema has no tenant/account columns, so true tenant/account context cannot be enforced without schema support.

## Manual Test Cases

1. Request a protected route without a valid session and confirm it returns `{ error: "Authentication required" }`.
2. Request `/voice/parse` without `use_voice_mode` and confirm it returns `403`.
3. As an assigned-location user, call `/voice/parse` custom mode with only assigned-location item IDs and confirm the existing parse response shape is unchanged.
4. As an assigned-location user, call `/voice/parse` custom mode with another location's item ID and confirm the parser does not return that unauthorized item.
5. As an assigned-location user, call `/voice/parse` custom mode with mixed allowed and unauthorized item IDs and confirm only allowed items can be returned.
6. As an admin or `view_all_locations` user, call `/voice/parse` custom mode with valid item IDs from multiple locations and confirm matching still works.
7. Confirm `/voice/transcribe` and `/voice/speak` preserve their existing success and error response shapes.
8. Confirm `/auth/login`, `/auth/logout`, `/auth/me`, and `/auth/change-password` preserve their existing response shapes.
9. Confirm command, scan, import, restock, warehouse, orders, items, history, dashboard, and users routes remain behind authentication.
10. Confirm public health and login routes remain reachable without an authenticated session.

## Remaining Risk

The application still lacks tenant/account columns and a dedicated locations table. Recent PRs enforce the available assigned-location boundary, but true tenant isolation requires schema support.
