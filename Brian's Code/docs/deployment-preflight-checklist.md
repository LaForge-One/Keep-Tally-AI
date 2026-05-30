# Deployment Preflight Checklist

Date: 2026-05-29

## Local Build Checks

Run before building the Docker image:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm run db:check
corepack pnpm run build:api
corepack pnpm run build:web
corepack pnpm --filter @workspace/keep-tally exec tsc -p tsconfig.json --noEmit
corepack pnpm audit --audit-level moderate
```

Expected:

- Drizzle migration metadata is valid.
- API bundle is created at `artifacts/api-server/dist/index.mjs`.
- Web bundle is created at `artifacts/keep-tally/dist/public/index.html`.
- No moderate-or-higher known dependency vulnerabilities.

## VPS Database Checks

Before running the container:

```sh
psql "$DATABASE_URL" -c "select current_database(), current_user;"
psql "$DATABASE_URL" -c "\\dt"
psql "$DATABASE_URL" -c "\\di"
```

Required lookup indexes:

- `locations_account_name_idx`
- `items_account_location_idx`
- `items_account_location_name_idx`
- `items_account_legacy_location_name_idx`
- `user_location_assignments_account_user_location_idx`
- `user_location_assignments_account_location_idx`

## App Preflight

Run:

```sh
corepack pnpm run deploy:preflight
```

Blocking failures:

- Missing `PORT`.
- Missing `DATABASE_URL`.
- Missing or weak `SESSION_SECRET`.
- Missing `CORS_ORIGIN`.
- Missing build artifacts.
- Cannot connect to Postgres.
- Missing database lookup indexes.

Warnings allowed before API credentials:

- `NODE_ENV` not production in local dry runs.
- `CORS_ORIGIN` using localhost in local dry runs.
- AI credentials pending.

## Container Smoke Test

```sh
docker compose build
docker compose run --rm keeptally corepack pnpm run deploy:preflight
docker compose run --rm keeptally corepack pnpm run db:migrate
docker compose up -d
curl -i http://127.0.0.1:3000/api/healthz
curl -i http://127.0.0.1:3000/api/ai/status
```

Expected:

- `/api/healthz` returns `200`.
- `/api/ai/status` returns `200`.
- Before credentials, AI status reports `configured: false`.

## Browser Acceptance Checks

After reverse proxy/TLS:

1. Open the HTTPS site.
2. Login as admin.
3. Confirm dashboard loads.
4. Open Voice Inventory.
5. Confirm locations come from the database, not hardcoded names.
6. Pick a location with items.
7. Confirm `Next` activates quickly.
8. Confirm AI warning appears until credentials are installed.

## Hold Points

Do not call the test VPS ready for operators until:

- TLS is enabled.
- Admin password has been changed.
- Postgres backup/restore has been tested.
- `deploy:preflight` passes in the container.
- Workflow smoke checks pass against the public test URL.
