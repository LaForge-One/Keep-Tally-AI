# Archive Retention Lifecycle

## Purpose

KeepTally keeps current operational reads fast by keeping recent records in live tables and moving old, closed, or resolved records into archive tables.

## Phase 1 Scope

This phase adds the database foundation and a safe batch archive runner.

Live tables added:

- `stockout_events`

Archive tables added:

- `history_archive`
- `count_sessions_archive`
- `count_session_events_archive`
- `stockout_events_archive`

## Default Retention Windows

- `history`: archive records older than 90 days.
- `count_sessions`: archive non-active sessions older than 90 days.
- `count_session_events`: archive with the parent non-active count session.
- `stockout_events`: archive resolved stockouts 180 days after resolution.

Current inventory, products, identifiers, warehouse inventory, and open stockouts stay live.

## Safe Dry Run

The archive script defaults to dry-run mode.

```bash
corepack pnpm run archive:retention
```

The output shows eligible records without moving data.

## Live Archive Run

Use this only after reviewing dry-run output.

```bash
ARCHIVE_DRY_RUN=false corepack pnpm run archive:retention
```

## Tunable Settings

```bash
ARCHIVE_HISTORY_DAYS=90
ARCHIVE_COUNT_SESSION_DAYS=90
ARCHIVE_STOCKOUT_RESOLVED_DAYS=180
ARCHIVE_BATCH_SIZE=5000
ARCHIVE_DRY_RUN=true
```

Example:

```bash
ARCHIVE_DRY_RUN=false ARCHIVE_BATCH_SIZE=1000 corepack pnpm run archive:retention
```

## Promotion Checks

`deploy:preflight` now checks for the archive migration, archive tables, and archive indexes.

## Next Phase

Phase 2 should wire `stockout_events` into inventory writes so stockout opening and resolution are recorded directly instead of reconstructed from quantity history.
