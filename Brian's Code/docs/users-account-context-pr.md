# Users and Permissions Account Context

## Scope

- User list, create, update, password reset, and delete routes now require active account context.
- Permission list and update routes now read and write `role_permissions` for the current account.
- User role and active state updates are mirrored into `account_memberships`.
- User assigned location strings are preserved for compatibility and mirrored into `user_location_assignments`.

## Manual Test Cases

1. Cross-account user access
   - Sign in as an account admin.
   - Request, update, reset, or delete a user whose `account_id` belongs to another account.
   - Expect the existing not-found shape for user-specific routes and no mutation.

2. Invalid location assignment
   - Create or update a user with an `assignedLocations` value that does not map to an active location in the current account.
   - Expect `{ "error": "Invalid assigned location" }`.

3. Permission escalation
   - Attempt to change `admin` role permissions through `PATCH /permissions/admin/:key`.
   - Expect `{ "error": "Admin permissions cannot be changed" }`.

4. Non-admin user management attempt
   - Sign in as an active account member whose membership role is not `admin`.
   - Request `/users` or `/permissions`.
   - Expect `{ "error": "Admin access required" }`.

5. Account-scoped permission changes
   - Change a permission for a non-admin role.
   - Confirm only the current account's `role_permissions` row changes.
   - Confirm another account's role permission value is unchanged.

6. Legacy compatibility
   - Create or update a user with valid assigned locations.
   - Confirm the response still includes the legacy `assignedLocations` array.
   - Confirm matching `user_location_assignments` rows are written for the same account.
