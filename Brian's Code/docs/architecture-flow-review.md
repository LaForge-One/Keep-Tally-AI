# Architecture and Flow Review

## Current Shape

KeepTally is a pnpm monorepo with these main parts:

- `artifacts/keep-tally`: React/Vite frontend.
- `artifacts/api-server`: Express API.
- `lib/db`: Drizzle/Postgres schema, migrations, and database client.
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`: OpenAPI, generated Zod types, and generated React API client.
- `lib/integrations-openai-ai-server`: OpenAI/audio/image/batch helpers.
- `scripts`: seed, import, and reporting utilities.

The original local app flow was:

1. Browser loads Vite frontend.
2. Frontend calls `/api/*`.
3. Vite proxies `/api` to the Express API.
4. Express authenticates the request, loads account/membership/location scope, checks permissions, then calls Drizzle.
5. Drizzle writes to Postgres.
6. History/audit rows record inventory changes.

The implemented local development flow now uses one origin:

1. `corepack pnpm run dev` builds the React app.
2. The Express API starts on `http://localhost:3000`.
3. Express serves `/api/*` routes and the built React files from the same process.
4. SPA navigation falls back to `index.html`; API failures stay under `/api/*`.

This removes the previous Vite-proxy/API split during local testing and avoids the common failure mode where the browser is open on one port while the API is dead on another.

## Main Design Friction

### 1. Local Runtime Is Too Manual

The app needs Postgres, migrations, seed data, API env vars, API server, and frontend server. Right now those are separate manual steps. That is why the browser can easily end up at "site can't be reached" after one process dies.

Recommended fix:

- Add one local startup script that checks Postgres, runs migrations, seeds if empty, starts API, and serves web from the same process.
- Add `.env.example`.
- Add `pnpm dev` at the root that serves both API and web from `http://localhost:3000`.
- Add a health/status script that prints:
  - frontend URL
  - API health
  - database connection
  - current admin/dev credentials if seeded locally
- Add a smoke script that verifies frontend, API health, login, and authenticated `/auth/me`.
- Add an explicit local admin reset command so credential drift can be fixed without reseeding the whole database.

### 2. API Build Bundling Is Fragile

The API uses esbuild to bundle a large Express server and several runtime-heavy dependencies. Some packages, especially file upload and SDK packages, are awkward to bundle and can slow or stall builds.

Recommended fix:

- Prefer externalizing runtime-heavy packages such as `openai`, `multer`, database drivers, and logging transports.
- Consider running API TypeScript through `tsx` in development and reserving bundling for deploy builds.
- Add a build smoke test that starts the built API and hits `/api/healthz`.

### 3. AI Integration Is Mixed Into Route Handlers

Voice and command AI logic currently lives close to routes. That works for a prototype, but as agents grow it will make permission checks, evals, latency tuning, and fallbacks harder to reason about.

Recommended fix:

- Create `artifacts/api-server/src/services/ai/*`.
- Move command parsing, voice parsing, transcription, TTS, and future agent planning into service modules.
- Keep route files focused on request validation, permission checks, service calls, and responses.
- Add deterministic parsers before AI model calls for common cases.
- Add eval fixtures for command parsing, voice parsing, and CSV mapping.

### 4. Permissions Are Strong But Repeated

The app has good account, membership, permission, and location-scope concepts. The friction is that similar helpers exist across many route files.

Recommended fix:

- Centralize common route patterns:
  - parse ID
  - assert account
  - assert item access
  - resolve location by name
  - merge location-scoped query results
- Add route-level integration tests for admin, warehouse, stocker, and no-location users.

### 5. Frontend Uses Both Generated and Hand-Written Fetch Paths

Some screens use generated API hooks, while others hand-roll `fetch`. That makes auth, errors, loading states, and cache invalidation uneven.

Recommended fix:

- Standardize on one API client wrapper.
- Make every mutation invalidate the right React Query keys.
- Put common toast/error handling in one helper.
- Keep hand-written fetch only for file upload/download and streaming.

### 6. Data Model Is Migrating From Legacy Location Strings

The schema supports durable `accountId` and `locationId`, but some compatibility paths still use location strings. This is sensible during migration, but it adds branching in route code.

Recommended fix:

- Finish location-ID-first flows.
- Keep legacy string fields as display/backfill compatibility only.
- Add a data repair/report command that must pass before enforcing stricter constraints.

### 7. Voice UX Should Move Toward Realtime

The current voice flow records audio, uploads it, transcribes it, parses it, then plays back TTS. That is straightforward and reliable, but not the fastest possible hands-free experience.

Recommended fix:

- Keep current flow as fallback.
- Add a Realtime/WebRTC proof of concept for one voice count mode.
- Use backend-issued ephemeral credentials.
- Expose only safe backend tools to the voice agent.
- Require confirmation for destructive or bulk operations.

## Recommended Core Design Direction

Move toward a layered architecture:

```text
Frontend screens
  -> API client hooks
    -> Express route adapters
      -> service modules
        -> repositories/database helpers
          -> Drizzle/Postgres
```

For AI and agents:

```text
Frontend AI panel or voice session
  -> API route
    -> AI service/orchestrator
      -> deterministic parser first
      -> model call when needed
      -> proposed action
      -> permission-checked domain service
      -> audit history
```

This keeps AI powerful but contained. The model should propose, classify, explain, and plan. The app should validate, authorize, write, and audit.

## Best Improvement Sequence

### Step 1: Local Runtime Reliability

Highest leverage because it removes daily friction.

- Root `dev` script serves web and API from one process.
- Local env example documents the local admin password and stable development session secret.
- API/web health check is available with `corepack pnpm run health`.
- DB-aware status check is available with `corepack pnpm run status`.
- Login smoke test is available with `corepack pnpm run smoke`.
- Broad workflow battery is available with `corepack pnpm run workflow:test`.
- Local admin reset is available with `corepack pnpm run dev:reset-admin`.

### Step 2: API Service Layer

Clean separation before adding more agents.

- Extract inventory item service.
- Extract warehouse service.
- Extract AI parsing service.
- Extract shared location-access helpers.

### Step 3: Test Harness

Needed before larger rewrites.

- Add API route smoke tests.
- Add AI parser eval fixtures.
- Add CSV import fixtures as tests.
- Add build smoke test.

### Step 4: AI Agent Features

Build on the cleaned service layer.

- Restock suggestion agent.
- Import mapping agent.
- Shrinkage anomaly watcher.
- Realtime voice count proof of concept.

## Prep Checks Before Implementation

Run these before the next code pass:

```bash
corepack pnpm install
corepack pnpm run typecheck:api
corepack pnpm run typecheck:web
corepack pnpm run build:web
corepack pnpm run build:api
corepack pnpm run health
corepack pnpm run status
corepack pnpm run smoke
corepack pnpm run workflow:test
corepack pnpm audit --audit-level moderate
```

Local runtime checks:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
curl -s http://localhost:3000/api/healthz
```

Database checks:

```bash
psql -h localhost -d keep_tally_brian_code -c 'select count(*) from users;'
psql -h localhost -d keep_tally_brian_code -c 'select count(*) from items;'
```

Manual browser checks:

- Login works.
- Store Inventory loads.
- Add Item opens.
- Quantity adjustment writes history.
- Warehouse page loads.
- Pick list page loads.
- Voice page gracefully handles missing AI credentials.

## Implementation Definition of Done

- One command starts local web + API on the same origin.
- Health check reports useful status.
- Typecheck passes.
- Production build passes.
- Audit has no known production vulnerabilities.
- Existing login/inventory workflow still works.
- Any new AI feature has:
  - permission checks
  - account/location scoping
  - deterministic fallback or graceful failure
  - audit trail for writes
  - documented env vars
