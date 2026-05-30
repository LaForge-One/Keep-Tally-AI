# Production Readiness

This project is a pnpm workspace with a Vite static frontend, an Express API, and PostgreSQL via Drizzle ORM. Replit files are still kept for current development workflows, but production should be able to run without relying on Replit runtime services.

## Production Shape

- Build the frontend from `artifacts/keep-tally` and serve `artifacts/keep-tally/dist/public` as static assets.
- Build the API from `artifacts/api-server` and run `artifacts/api-server/dist/index.mjs` as a Node service.
- Use managed PostgreSQL for `DATABASE_URL`.
- Store all secrets in the platform secret manager, not in source-controlled files.

## Required Environment Variables

- `NODE_ENV=production`
- `PORT`
- `DATABASE_URL`
- `SESSION_SECRET`
- `INITIAL_ADMIN_PASSWORD` for first-admin bootstrap on an empty production database
- `CORS_ORIGIN`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- Optional AI tuning:
  - `AI_TEXT_MODEL`
  - `AI_COMMAND_MODEL`
  - `AI_VOICE_PARSE_MODEL`
  - `AI_AGENT_MODEL`
  - `AI_AUDIO_CHAT_MODEL`
  - `AI_TTS_MODEL`
  - `AI_TRANSCRIBE_MODEL`
  - `AI_COMMAND_MAX_OUTPUT_TOKENS`
  - `AI_VOICE_PARSE_MAX_OUTPUT_TOKENS`

Optional:

- `LOG_LEVEL`
- `REPLIT_DEV_DOMAIN` and `REPLIT_DEPLOYMENT_DOMAIN` for Replit deployments only
- `BASE_PATH` for frontend preview/static routing

## CI Guardrails

The minimum production gate should run:

```sh
pnpm install --frozen-lockfile
pnpm run ci
```

`pnpm run ci` currently performs workspace typechecking, API build, and frontend build. It intentionally does not apply database migrations or seed data.

Drizzle migration checks are available through `pnpm run db:check`, but they are not blocking CI yet. Enable them in CI only after they pass in a real pnpm environment with the checked-in migration metadata.

## Database Migrations

The database package now uses Drizzle migrations under `lib/db/migrations`.

Important: `lib/db/migrations/0000_baseline.sql` is for brand-new, empty databases only. Do not apply it to an existing Replit, staging, or production database that already contains KeepTally tables.

Use these commands:

```sh
pnpm run db:check
pnpm run db:generate
DATABASE_URL=postgresql://... pnpm run db:migrate
```

- `db:check` validates the checked-in migration files. It should be verified in a real pnpm environment before it is promoted to a blocking CI step.
- `db:generate` creates future migration files from Drizzle schema changes.
- `db:migrate` applies checked-in migrations and requires `DATABASE_URL`.

The first migration is a baseline for clean databases. If adopting an existing database that already has these tables, do not blindly apply the baseline migration. Instead, follow the adoption process in `lib/db/migrations/README.md`.

## Deployment Checklist

- Confirm `SESSION_SECRET` is long, random, and unique per environment.
- Confirm `INITIAL_ADMIN_PASSWORD` is temporary and rotated after first login.
- Confirm `CORS_ORIGIN` is the exact production frontend origin.
- Confirm PostgreSQL backups are enabled.
- Run `pnpm run db:check` before deployment after it has been verified in the target toolchain.
- Run `DATABASE_URL=... pnpm run db:migrate` during deployment after backups are confirmed.
- Confirm API health check is wired to `/api/healthz`.
- Confirm frontend routes rewrite to `index.html`.
- Confirm OpenAI usage limits and billing alerts are configured outside the app.

## Out Of Scope For This Foundation PR

- Inventory behavior changes
- Auth flow behavior changes
- Replit file removal
- OpenAPI regeneration
- New product features
