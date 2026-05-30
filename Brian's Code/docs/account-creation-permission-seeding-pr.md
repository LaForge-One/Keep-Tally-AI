# Account Creation Permission Seeding

## Summary

New account creation paths now seed a complete account-scoped `role_permissions` matrix as part of account setup. This keeps future accounts aligned with the backfill added in `0004_account_scoped_role_permissions` while preserving the existing global/null permission fallback.

## Account Creation Paths

- `artifacts/api-server/src/lib/auth-helpers.ts`
  - `seedDefaultData` creates the default account during API bootstrap.
  - The default account now receives missing account-scoped role permission rows whether it already existed or was just created.
- `scripts/src/seed.ts`
  - `ensureDefaultAccount` creates the default account for demo seed data.
  - It now seeds missing account-scoped role permission rows before returning the account.
- `scripts/src/import-csv.ts`
  - `ensureDefaultAccount` creates the default account for CSV imports.
  - It now seeds missing account-scoped role permission rows before import work begins.

## Compatibility

- No route behavior changes.
- No UI changes.
- No API response shape changes.
- No `NOT NULL` constraints are added.
- Null/global role permission fallback remains in place.
- Legacy string location fallback is untouched.

## Coverage

- `scripts/src/report-tenant-links.ts` already blocks on account-scoped role permission matrix gaps for every account, so any account creation path that bypasses seeding remains visible before stricter enforcement.
- There is no first-party test runner in this repo yet; validation is through type checking/build CI.

## Validation

- Run `pnpm run ci`.
