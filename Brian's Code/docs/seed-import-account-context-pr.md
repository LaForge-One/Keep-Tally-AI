# Seed and import account context PR

## Summary

This PR updates local seed and CSV import scripts to resolve the default account and location records before inserting inventory data. Inserted items and history rows now include `accountId` and `locationId` while preserving legacy string `location` fields.

## Manual test cases

- Running the seed script creates or reuses the default account.
- Running the seed script creates or reuses location records for seeded item locations.
- Seeded items include `accountId`, `locationId`, and legacy `location`.
- Seeded history rows include `accountId`, `locationId`, and legacy `location`.
- Running CSV import creates or reuses the default account and requested/default locations.
- CSV imported items include `accountId`, `locationId`, and legacy `location`.
- CSV imported history rows include `accountId`, `locationId`, and legacy `location`.
- Non-append CSV imports only clear default-account and legacy-unlinked items/history, not other account data.
- Existing script command names and output style remain compatible.

## Notes

- No route behavior changes are included.
- No UI changes are included.
- Legacy string location compatibility is preserved.
