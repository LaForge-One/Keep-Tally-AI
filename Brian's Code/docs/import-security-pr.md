# Import Security PR Notes

This PR is intentionally limited to import route location-scope and audit hardening. It does not change schema, redesign import workflows, or change successful preview/apply response shapes.

## Location-Scope Behavior

- Admins can preview and apply imports for all locations.
- Users with `view_all_locations` can preview and apply imports for all locations.
- Location-limited users can preview and apply imports only for assigned locations.
- Import preview rejects CSV rows with an inaccessible detected location.
- Import apply validates access to all existing submitted items before mutating inventory.
- Import apply writes history rows only for actual quantity or par-level changes.
- New access denials use the existing `{ error: string }` response shape.

## Manual Test Cases

1. Sign in as an admin and confirm import preview/apply works for multiple locations.
2. Sign in as a user with `view_all_locations` and confirm import preview/apply works for multiple locations.
3. Sign in as a location-limited user and confirm preview/apply works for assigned-location items.
4. As a location-limited user, preview a CSV with a detected location column containing another location and confirm it returns `403` with `{ error: string }`.
5. As a location-limited user, apply an import containing an inaccessible existing `itemId` and confirm it returns `403` before any inventory changes.
6. Confirm deduct-mode apply writes a history row for each item whose quantity actually changes.
7. Confirm par-mode apply writes a history row for each item whose par level actually changes.
8. Confirm unchanged quantity or par values do not create history rows.
9. Confirm invalid request validation does not mutate inventory.
10. Confirm successful preview still returns `headers`, `detectedColumns`, `totalRows`, `matched`, and `unmatched`.
11. Confirm successful apply still returns `mode`, `applied`, and `results`.
