# Users and Permissions Security PR Notes

This PR is intentionally limited to user-management and permission hardening. It does not change schema, UI, login behavior, or unrelated route groups.

## Security Behavior

- User and permission management routes remain admin-only through the existing `requireAdmin` middleware.
- User create and update requests validate `assignedLocations` before saving them.
- Assigned locations are normalized, deduplicated, and checked against known store inventory locations.
- Admin users cannot change their own role, assigned locations, or active status through the user update route.
- Admin users still cannot delete their own account.
- Admin role permissions remain immutable.
- Role, permission, and assigned-location changes write audit rows to the existing `history` table.
- New access or validation denials use the existing `{ error: string }` response shape.

## Tenant/Account Limitation

The current schema has no tenant/account columns and no dedicated locations table. Because of that, this PR cannot add true cross-tenant database scoping without a schema change. In this schema, users and permissions are global. Location assignment validation uses the set of existing store inventory locations as the safest available boundary.

## Manual Test Cases

1. Sign in as an admin and confirm `GET /users` returns the same `{ users }` response shape.
2. Sign in as a non-admin user and confirm `GET /users`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id`, `GET /permissions`, and `PATCH /permissions/:role/:key` return `403`.
3. As an admin, create a user with valid assigned locations and confirm the existing `201 { user }` response shape.
4. As an admin, create a user with an unknown assigned location and confirm it returns `{ error: string }` without creating the user.
5. As an admin, update another user's assigned locations with valid locations and confirm the existing `{ user }` response shape.
6. As an admin, update another user's assigned locations with an unknown location and confirm it returns `{ error: string }` without changing assignments.
7. As an admin, attempt to change your own role and confirm it returns `{ error: string }`.
8. As an admin, attempt to change your own assigned locations and confirm it returns `{ error: string }`.
9. As an admin, attempt to disable your own account and confirm it returns `{ error: string }`.
10. As an admin, attempt to change admin role permissions and confirm the existing `{ error: string }` rejection remains.
11. As an admin, change a non-admin role permission and confirm the existing `{ ok: true }` response shape.
12. Confirm role, permission, and assigned-location changes create `history` audit rows.
13. Confirm failed authorization or invalid location validation does not create or mutate users, role permissions, or location assignments.
