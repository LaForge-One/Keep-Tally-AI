# VPS Docker Deployment Plan

Date: 2026-05-29

## Goal

Prepare KeepTally for a test VPS deployment where:

- The web app is built once and served by the API server.
- The API runs inside a Docker container.
- PostgreSQL is already installed on the VPS host.
- The container connects to that host PostgreSQL database.
- OpenAI/API credentials can be added later without blocking the base deployment.

## Target Architecture

```mermaid
flowchart LR
  User["Browser"] --> Proxy["Nginx or Caddy TLS proxy"]
  Proxy --> App["KeepTally Docker container 127.0.0.1:3000"]
  App --> Web["Static React build"]
  App --> API["Express API"]
  API --> DB["Host PostgreSQL"]
  API -. pending .-> OpenAI["OpenAI APIs"]
```

The first test environment should use one application container and one host-managed PostgreSQL service. This keeps database files under normal VPS backup/restore procedures and avoids mixing persistent database storage into early application container testing.

## Build And Runtime Shape

The app now has a `Dockerfile` that:

- Installs workspace dependencies with pnpm.
- Builds `artifacts/keep-tally/dist/public`.
- Builds `artifacts/api-server/dist/index.mjs`.
- Runs `node --enable-source-maps artifacts/api-server/dist/index.mjs`.
- Serves the frontend from `WEB_DIST_DIR`.

The app exposes:

- `GET /api/healthz`
- `GET /api/ai/status`
- `GET /api/locations`

For the VPS test environment, publish the container only on localhost and let the public HTTPS proxy handle all outside traffic. See [secure-vps-test-access.md](secure-vps-test-access.md).

## Required VPS Environment

Minimum:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://keeptally:CHANGE_ME@host.docker.internal:5432/keeptally_test
CORS_ORIGIN=https://test.your-domain.example
SESSION_SECRET=generate-a-long-random-secret-at-least-32-chars
INITIAL_ADMIN_PASSWORD=temporary-bootstrap-password
WEB_DIST_DIR=/app/artifacts/keep-tally/dist/public
AUTH_COOKIE_SECURE=auto
TRUST_PROXY=true
```

AI credentials are intentionally optional for this pre-credential phase:

```env
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
AI_INTEGRATIONS_OPENAI_API_KEY=
AI_REALTIME_ENABLED=false
```

Until credentials are present, `/api/ai/status` should report `configured: false`, and voice custom mode should use local/offline matching.

## PostgreSQL Setup

On the VPS host:

```sh
sudo -u postgres createuser keeptally
sudo -u postgres createdb keeptally_test --owner keeptally
sudo -u postgres psql -c "alter user keeptally with encrypted password 'CHANGE_ME';"
```

Recommended PostgreSQL access pattern for the test VPS:

- Bind PostgreSQL to localhost or a private interface only.
- If Docker connects to host Postgres, use `host.docker.internal` with `host-gateway`.
- Restrict `pg_hba.conf` to the Docker bridge subnet and the application user.
- Do not expose Postgres directly to the public internet.

## Migration Plan

For a brand-new empty VPS database:

```sh
DATABASE_URL=postgresql://... corepack pnpm run db:migrate
```

The migration set includes the current lookup/index hardening:

- `0006_lookup_indexes.sql`
- `items(account_id, location_id, name)`
- `items(account_id, location, name)`
- `user_location_assignments(account_id, location_id)`

For an existing database, follow [lib/db/migrations/README.md](../lib/db/migrations/README.md). Do not run the baseline blindly against data-bearing production databases.

## Docker Compose Test Run

Use the included example:

```sh
cp docker-compose.vps.example.yml docker-compose.yml
cp .env.example .env.production
# edit .env.production for VPS values
docker compose build
docker compose run --rm keeptally corepack pnpm run deploy:preflight
docker compose run --rm keeptally corepack pnpm run db:migrate
docker compose up -d
docker compose logs -f keeptally
```

## Optional Self-Hosted AI Overlay

If we want to test AI without OpenAI credentials, use the LocalAI/Ollama overlay:

```sh
cp .env.ai.example .env.ai
# edit LOCALAI_API_KEY and model names
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --env-file .env.production \
  --env-file .env.ai \
  up -d keeptally localai
```

For the admin model UI and optional workflow automation:

```sh
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --env-file .env.production \
  --env-file .env.ai \
  --profile ai-ui \
  --profile automation \
  up -d
```

Details are in [self-hosted-ai-stack.md](./self-hosted-ai-stack.md).

## Reverse Proxy

Use Nginx or Caddy in front of the app container.

Proxy requirements:

- Terminate TLS.
- Forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`.
- Proxy `/` and `/api/*` to the same app container.
- Keep `CORS_ORIGIN` aligned to the public HTTPS origin.

For direct HTTP testing on `http://SERVER_IP:3000`, use:

```env
AUTH_COOKIE_SECURE=false
TRUST_PROXY=false
```

When the app is behind HTTPS through a reverse proxy, use:

```env
AUTH_COOKIE_SECURE=auto
TRUST_PROXY=true
```

`AUTH_COOKIE_SECURE=auto` sets secure cookies only when the request is actually
HTTPS. Browsers do not store `Secure` cookies over plain HTTP, so forcing secure
cookies before TLS is active makes sign-in look broken even when the login API
returns success.

## Preflight Checks

Run locally or inside the container:

```sh
NODE_ENV=production \
PORT=3000 \
DATABASE_URL=postgresql://... \
CORS_ORIGIN=https://test.your-domain.example \
SESSION_SECRET=... \
corepack pnpm run deploy:preflight
```

The preflight checks:

- Required production environment variables.
- Web/API build artifacts.
- Migration file presence.
- Database connectivity.
- Seed data presence.
- Required lookup indexes.
- AI credential readiness as a warning only.

## Known Pre-Credential Behavior

Without OpenAI credentials:

- AI command endpoints should fail gracefully or fall back where implemented.
- Voice parse can return controlled unavailable responses.
- Voice count setup and item matching remain usable through local logic.
- `/api/ai/status` is the UI source of truth for AI readiness.

## Security Notes Before Public Test

- Replace `INITIAL_ADMIN_PASSWORD` after first login.
- Use a long `SESSION_SECRET`; never use the local development value.
- Keep Postgres off the public internet.
- Configure firewall to allow only `22`, `80`, and `443` publicly.
- Use HTTPS before testing microphone workflows, because browser mic access is limited on insecure origins.
- Back up Postgres before every migration test.

## Next Steps After API Credentials Arrive

1. Add `AI_INTEGRATIONS_OPENAI_API_KEY` through VPS secrets or `.env.production`.
2. Re-run `deploy:preflight`.
3. Verify `/api/ai/status` reports `configured: true`.
4. Run real voice transcription and TTS checks.
5. Enable realtime voice only after fallback voice is stable.
