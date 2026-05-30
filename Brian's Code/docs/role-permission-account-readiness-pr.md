# Role Permission Account Scoping Readiness

## Summary

This audit documents the remaining global/null `role_permissions.account_id` fallback behavior before making role permissions strictly account-scoped. It does not change schema nullability, route behavior, API response shapes, UI behavior, or the current fallback chain.

## Current Fallback Behavior

Role permissions are loaded through `getPermissionsForRole(role, accountId?)`.

Current resolution order:

1. If an `accountId` is supplied, load rows where `role_permissions.account_id = accountId` and `role` matches.
2. If account-scoped rows exist, use those rows.
3. Otherwise, load global fallback rows where `role_permissions.account_id IS NULL` and `role` matches.
4. If no database rows exist for that role, fall back to `DEFAULT_PERMISSIONS` from the shared schema.

This means `role_permissions.account_id` cannot safely become required until every account has a complete permission matrix and runtime no longer depends on global/null rows as a compatibility fallback.

## Read Locations

- `artifacts/api-server/src/lib/auth-helpers.ts`
  - `getPermissionsForRole` reads account-scoped rows first, then null/global rows, then `DEFAULT_PERMISSIONS`.
- `artifacts/api-server/src/middleware/auth.ts`
  - `loadUser` calls `getPermissionsForRole(user.role)` before account context exists, so it can still use global/default fallback permissions.
  - `loadAccountContext` calls `getPermissionsForRole(membership.role, account.id)` after resolving the active account.
  - `requirePermission`, `canAccessLocation`, and `canViewAllLocations` consume `req.permissions` or fallback `req.authUser.permissions`.
- `artifacts/api-server/src/routes/auth.ts`
  - Login response calls `getPermissionsForRole(user.role)` before account context is attached.
  - `/auth/me` returns the permissions already loaded by `loadUser`.
- `artifacts/api-server/src/routes/users.ts`
  - `/users/permissions` reads account-scoped rows only.
  - `/users/permissions/:role/:key` creates or updates account-scoped rows only.

## Seed Locations

- `artifacts/api-server/src/lib/auth-helpers.ts`
  - `seedDefaultData` creates the default account and first admin user.
  - It seeds role permissions only when the `role_permissions` table has no rows.
  - New seed rows are account-scoped to the default account.
- `lib/db/migrations/0001_foundational_multi_tenant.sql`
  - Adds nullable `role_permissions.account_id`.
  - Backfills existing role permission rows to the default account.
- `lib/db/migrations/0002_legacy_multi_tenant_backfill.sql`
  - Re-runs a default-account backfill for null `role_permissions.account_id`.
- `lib/db/migrations/0003_multi_tenant_repair_checks.sql`
  - Re-runs the same repair for null `role_permissions.account_id`.
- `scripts/src/report-tenant-links.ts`
  - Reports null `role_permissions.account_id` rows as a readiness warning/blocker for strict account scoping.

## What Would Break If Required Today

Making `role_permissions.account_id` required immediately would be risky because:

- Login and initial `loadUser` permission loading can happen before account context exists.
- Any account without a full account-scoped permission matrix would lose customized permissions and fall through to `DEFAULT_PERMISSIONS` only if code still allows fallback.
- Existing null/global rows would fail a `NOT NULL` migration unless backfilled or deleted first.
- New accounts may not automatically receive all role/permission rows unless account creation also seeds them.
- Permission reads would need a clear behavior for users without active membership or before membership resolution.

## No-Behavior-Change Plan

1. Keep the current fallback chain in place.
   - Do not remove null/global fallback yet.
   - Do not change login or middleware permission loading yet.

2. Add an idempotent account-scoped permission seed migration.
   - For every account, insert every `USER_ROLES x PERMISSION_KEYS` row.
   - Prefer existing account-scoped values when present.
   - If account-scoped row is missing, copy from null/global fallback row for that role/key.
   - If no null/global row exists, use `DEFAULT_PERMISSIONS`.

3. Add account creation seeding.
   - Any future account creation path should seed a full account-scoped permission matrix during account setup.
   - This should be done before disabling fallback.

4. Add safety checks.
   - Every account must have one row for every supported role/permission pair.
   - No duplicate account/role/permission rows should exist.
   - Every active membership role must have a complete permission matrix for its account.
   - Null/global rows may still exist during compatibility, but no runtime path should require them after the next phase.

5. Update runtime permission loading in a later PR.
   - Keep `loadUser` compatibility until account context is available.
   - Prefer account-scoped permissions after membership resolution.
   - Once account-scoped seeding is complete everywhere, make missing account-scoped rows a server-side configuration error instead of falling back silently.

6. Enforce `role_permissions.account_id` only after fallback is retired.
   - Delete or archive null/global rows.
   - Add a `DO $$` safety check for null account IDs.
   - Alter `role_permissions.account_id` to `NOT NULL`.

## Migration Readiness Status

Not ready for `NOT NULL` yet.

Safe next migration:

- Add idempotent account-scoped permission matrix seeding for every account.

Unsafe right now:

- Making `role_permissions.account_id` required.
- Removing null/global permission fallback.
- Removing `DEFAULT_PERMISSIONS` fallback during bootstrap.

## Validation

- Run `pnpm run ci`.

## Recommended PR Title

Document role permission account scoping readiness
