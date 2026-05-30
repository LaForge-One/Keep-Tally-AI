# Workflow Test Report

Date: 2026-05-29

## Summary

The local single-server app is running at `http://localhost:3000` and the workflow battery passed.

Primary result:

- `corepack pnpm run workflow:test`: 54/54 passed
- Main browser pages checked in the in-app browser: passed
- `corepack pnpm run smoke`: passed
- `corepack pnpm run build:web`: passed
- `corepack pnpm run build:api`: passed
- `corepack pnpm audit --audit-level moderate`: passed
- API direct typecheck: passed

The web TypeScript check did not fail, but it did not complete in a useful time window. Treat this as a tooling performance gap to shore up.

After the AI voice edge-case pass, the workflow battery includes AI status and passes 55/55.

## Workflows Exercised

### Access And Auth

Verified:

- Frontend serves from `GET /`.
- API health responds from `GET /api/healthz`.
- Admin login succeeds with `admin / admin1234`.
- Auth cookie is set.
- Authenticated `GET /api/auth/me` succeeds.
- Main protected pages load without Not Found or login bounce.

Pages checked:

- `/`
- `/inventory`
- `/restock`
- `/history`
- `/voice-check`
- `/orders`
- `/route-sheets`
- `/import`
- `/scan`
- `/warehouse`
- `/warehouse/voice`
- `/warehouse/purchases`
- `/admin/users`
- `/settings`

### Store Inventory

Verified:

- List inventory.
- Create a store item.
- Fetch created item detail.
- Patch item quantity/par level.
- Record an adjustment.
- Record a voice verification event.
- Barcode lookup works.
- Delete the temporary store item.

### Warehouse

Verified:

- Warehouse dashboard loads.
- Warehouse list loads.
- Create warehouse item.
- Fetch warehouse item detail.
- Update warehouse item.
- Receive a purchase.
- Transfer warehouse stock to a store location.
- Warehouse purchase list loads.
- Warehouse inventory CSV export works.
- Warehouse reorder CSV export works.
- Delete the temporary warehouse item.

### Pick Lists / Orders

Verified:

- Order list loads.
- Create a pick/order list from a location.
- Fetch order detail.
- Update order status/notes.
- Delete the temporary order.

### Route Sheets

Verified:

- Route sheet list loads.
- Create a route sheet with a stop and item checklist.
- Fetch route sheet detail.

Gap:

- There is no delete/archive endpoint for route sheets, so automated tests cannot fully clean route-sheet records after creation.

### Import And Scan

Verified:

- Store CSV import preview accepts a valid CSV upload.
- Scan log endpoint loads.

Not fully exercised:

- Physical camera/barcode capture.
- Import apply with destructive writes.

### AI / Voice

Verified:

- AI status endpoint returns the current configured/unconfigured state.
- Command endpoint returns a graceful 200 response.
- Voice parse with unavailable AI credentials returns a controlled 502 rather than a server crash.

Gap:

- Full voice transcription and TTS require real AI/audio credentials and should have separate credentialed integration tests.

## Gaps To Shore Up

### 1. Web Typecheck Performance

Observed behavior:

- API typecheck completed.
- Web production build completed.
- Web `tsc --noEmit` stayed running for several minutes without useful output.

Recommended fix:

- Split frontend typechecking by narrower tsconfig project references.
- Run `tsc --extendedDiagnostics` once to identify the slow dependency or file group.
- Consider `skipLibCheck` if third-party library checking is dominating.
- Add a timeout wrapper around CI typecheck jobs so failures are explicit.

### 2. Route Sheet Lifecycle

Observed behavior:

- Route sheets can be created and read.
- No delete/archive endpoint exists.

Recommended fix:

- Add `PATCH /api/route-sheets/:id` support for `status: archived`, or add `POST /api/route-sheets/:id/archive`.
- Filter archived sheets by default in the UI.
- Keep hard delete optional and admin-only if needed.

### 3. AI Credential Modes

Observed behavior:

- Missing AI credentials are handled gracefully at the route level, but the user experience still depends on which AI feature is being used.

Recommended fix:

- Add a visible AI status endpoint, for example `GET /api/ai/status`.
- Let the frontend disable or label AI-only controls when credentials are absent.
- Keep deterministic parsing first for simple count commands.
- Add credentialed AI tests separately from local offline tests.

### 4. Browser-Level Regression Tests

Observed behavior:

- API workflows are now repeatable.
- Browser checks currently verify page load and basic text only.

Recommended fix:

- Add Playwright tests for:
  - login
  - add item dialog
  - quantity adjustment
  - warehouse receive
  - order creation
  - route sheet creation
- Use seeded test data and cleanup hooks.

### 5. Import Apply Safety

Observed behavior:

- Import preview works.
- Import apply was not run as part of the default battery to avoid adding bulk rows during a broad smoke test.

Recommended fix:

- Add a fixture-backed import apply test inside a transaction or against a disposable test database.
- Report created/updated/skipped counts in the test output.

## Commands

Use this battery locally:

```bash
corepack pnpm run status
corepack pnpm run smoke
corepack pnpm run workflow:test
corepack pnpm run build:web
corepack pnpm run build:api
corepack pnpm audit --audit-level moderate
```

Credential repair:

```bash
corepack pnpm run dev:reset-admin
```

## Recommended Next Implementation Pass

1. Add route sheet archive support and update the route sheet UI to hide archived sheets by default.
2. Add Playwright browser tests for the five highest-value user workflows.
3. Add an AI status endpoint and frontend disabled states for missing credentials.
4. Split or optimize frontend typechecking so it can run reliably in CI.
5. Move import apply tests to a disposable test database so full import flows can be tested safely.
