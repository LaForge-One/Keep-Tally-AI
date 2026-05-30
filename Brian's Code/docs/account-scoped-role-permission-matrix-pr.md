# Account-Scoped Role Permission Matrix

## Summary

This PR adds the next migration-readiness step for strict tenant enforcement: every account gets a complete account-scoped role permission matrix while the current null/global fallback remains available for compatibility.

## Scope

- Adds an idempotent `0004_account_scoped_role_permissions` migration.
- Inserts missing `role_permissions` rows for every account, role, and permission key.
- Copies null/global fallback values when available, otherwise uses the current default role permissions.
- Adds migration safety checks for duplicate account-scoped rows, unsupported active membership roles, and incomplete account-scoped permission matrices.
- Extends the tenant-link report with the same permission matrix readiness checks.

## Compatibility

- No route behavior changes.
- No UI changes.
- No response shape changes.
- No `NOT NULL` constraints are added.
- Null/global role permission fallback is intentionally preserved for now.
- Legacy string location fallback is untouched.

## Validation

- Run `pnpm run ci`.
