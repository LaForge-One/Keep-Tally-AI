# VPS Development Environment Setup

Generated: 2026-06-01

## Goal

Create a separate KeepTally development lane on the VPS so new code can be built, migrated, seeded, and tested before it is promoted to the existing test environment.

This dev lane should have:

- A separate container project.
- A separate port.
- A separate PostgreSQL database.
- A separate `.env.vps-dev` file.
- A separate public or private origin, such as `https://dev.keeptally.ai`.
- No dependency on `.env.production` or the current test container.

## Files Added

- `docker-compose.vps-dev.yml`
- `.env.vps-dev.example`

The dev compose file runs one app container named through the compose project and binds the app to localhost port `3100` by default.

## Recommended VPS Layout

Use the same repo directory:

```bash
cd "/root/Keep-Tally-AI/Brian's Code"
```

Keep these environment files separate:

```text
.env.vps-dev   # development lane
.env.vps-test  # user access testing lane
.env.ai        # only if using a shared LocalAI stack
```

## 1. Create The Dev Database

Run as the PostgreSQL admin user from the VPS:

```bash
PGPASSWORD='POSTGRES_ROOT_PASSWORD' psql -U postgres -h 127.0.0.1 -d postgres -c "CREATE USER keeptally_dev WITH PASSWORD 'CHANGE_ME_DEV_DB_PASSWORD';"
PGPASSWORD='POSTGRES_ROOT_PASSWORD' psql -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE keeptally_dev OWNER keeptally_dev;"
```

If the user or database already exists:

```bash
PGPASSWORD='POSTGRES_ROOT_PASSWORD' psql -U postgres -h 127.0.0.1 -d postgres -c "ALTER USER keeptally_dev WITH PASSWORD 'CHANGE_ME_DEV_DB_PASSWORD';"
```

## 2. Create The Dev Environment File

```bash
cp .env.vps-dev.example .env.vps-dev
nano .env.vps-dev
```

Set at minimum:

```text
DATABASE_URL=postgresql://keeptally_dev:CHANGE_ME_DEV_DB_PASSWORD@host.docker.internal:5432/keeptally_dev
CORS_ORIGIN=https://dev.keeptally.ai
SESSION_SECRET=<openssl rand -hex 32 output>
AI_INTEGRATIONS_OPENAI_API_KEY=<dev OpenAI key>
```

Generate a secret:

```bash
openssl rand -hex 32
```

## 3. Build And Start Dev

Use a separate compose project name so dev containers do not collide with test containers:

```bash
docker compose \
  -p keeptally-dev \
  -f docker-compose.vps-dev.yml \
  --env-file .env.vps-dev \
  up -d --build --force-recreate
```

Check status:

```bash
docker compose \
  -p keeptally-dev \
  -f docker-compose.vps-dev.yml \
  --env-file .env.vps-dev \
  ps
```

## 4. Run Migrations And Seed Dev

```bash
docker compose \
  -p keeptally-dev \
  -f docker-compose.vps-dev.yml \
  --env-file .env.vps-dev \
  run --rm keeptally-dev corepack pnpm run db:migrate
```

Seed dev with test inventory:

```bash
docker compose \
  -p keeptally-dev \
  -f docker-compose.vps-dev.yml \
  --env-file .env.vps-dev \
  run --rm -e SEED_ITEM_COUNT=600 keeptally-dev corepack pnpm --filter @workspace/scripts run seed
```

## 5. Run Dev Preflight

```bash
docker compose \
  -p keeptally-dev \
  -f docker-compose.vps-dev.yml \
  --env-file .env.vps-dev \
  run --rm -e DEPLOY_PREFLIGHT_MIN_ITEMS=600 keeptally-dev corepack pnpm run deploy:preflight
```

Expected:

- Health checks pass.
- Database connects to `keeptally_dev`.
- Migrations include the new count-session audit tables.
- Seed inventory meets the 600-item expectation.

## 6. Local VPS Health Checks

```bash
curl -I http://127.0.0.1:3100/api/healthz
curl -sS http://127.0.0.1:3100/api/ai/connectivity
```

## 7. Optional HTTPS Dev Domain

Recommended domain:

```text
dev.keeptally.ai
```

Point it through Cloudflare Access or Webuzo/nginx reverse proxy to:

```text
http://127.0.0.1:3100
```

Then set:

```text
CORS_ORIGIN=https://dev.keeptally.ai
AUTH_COOKIE_SECURE=true
TRUST_PROXY=true
```

## 8. Promotion Rule

Only promote dev to the test lane after:

- Dev container builds.
- Dev migrations apply.
- Dev seed/preflight passes.
- Login works.
- Agent Insights conversation works.
- Voice count creates `count_sessions` and `count_session_events`.
- No blocking TypeScript or build failures remain.

## Useful Cleanup Commands

Stop dev only:

```bash
docker compose \
  -p keeptally-dev \
  -f docker-compose.vps-dev.yml \
  --env-file .env.vps-dev \
  down
```

View dev logs:

```bash
docker compose \
  -p keeptally-dev \
  -f docker-compose.vps-dev.yml \
  --env-file .env.vps-dev \
  logs --tail=160 keeptally-dev
```
