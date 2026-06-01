# Current Edge Case Recommendations

Generated: 2026-06-01

This document reconfirms the major edge cases discovered during VPS testing, voice workflow testing, database preflight work, and the TypeScript cleanup pass. It is written as a practical recommendation list for the next stabilization cycle.

## Current Safety Baseline

The application now has several important protections in place:

- Deployment preflight checks required environment variables, strong session secrets, CORS origin, build artifacts, migrations, database connection, seed data, lookup indexes, ffmpeg availability, admin user health, permission matrix health, duplicate inventory keys, negative quantities, min/max stock ranges, and orphan references.
- The VPS test environment is intended to run with `NODE_ENV=test`, not as a production environment.
- Voice mode now has visible browser-side diagnostics for microphone opening, recording, transcription, parsing, speaking, matching, confirmation, and save steps.
- Voice writes do not announce success until the inventory write succeeds.
- Store inventory now has a min/max stock model, which is better aligned to replenishment workflows than the original par-only design.
- The TypeScript project is now split into buildable project references, which makes repeated checks much faster and easier to isolate.
- The secure test URL is protected behind Cloudflare Access, with Webuzo panel TLS handled separately from the KeepTally application TLS.

## Highest Priority Edge Cases

### 1. Voice Count Session Audit Trail

Current state:

- Store voice count can transcribe, parse, confirm, and write inventory changes.
- The durable record is still mostly the final `history` row from verification or adjustment.
- The full spoken session is not yet persisted as an accounting-grade audit trail.

Risk:

- A user can see that a quantity changed, but the system cannot fully prove the spoken workflow that led to that change.
- Failed transcriptions, skipped items, ambiguous matches, and confirmations are not grouped into a durable session record.

Recommendation:

- Add `count_sessions` and `count_session_events`.
- Create one session row when voice count starts.
- Add event rows for transcript received, item matched, confirmation requested, confirmation accepted/rejected, save attempted, save succeeded, save failed, skipped item, and session completed.
- Store transcript text and confidence when available, but do not store raw audio unless there is a written retention policy.

Suggested priority: Phase 1.

### 2. Voice Audio Source Verification

Current state:

- The frontend logs whether speech came from OpenAI, browser speech synthesis, browser fallback, or no audio.
- The Docker build now passes Vite voice flags into the frontend bundle.

Risk:

- Browser fallback can sound robotic and can hide OpenAI TTS failures unless logs are reviewed.
- A stale frontend bundle can make the UI behave like old code even when the server was updated.

Recommendation:

- Add a small visible voice diagnostics panel with the latest speech source, last TTS status, last transcription status, and frontend build version.
- Add a deployment preflight check that scans the built frontend for the expected voice TTS feature flags.
- Add an admin-only endpoint, such as `GET /api/voice/diagnostics`, that reports configured models, TTS voice, transcription model, ffmpeg path, and whether the last TTS call used OpenAI or fallback.

Suggested priority: Phase 1.

### 3. End-of-Utterance and Spoken Completion Commands

Current state:

- The browser uses silence detection to stop recording after the user stops speaking.
- Completion words such as done, finish, and stop are handled in custom mode.

Risk:

- Completion words embedded in longer phrases can be misread as part of an item name or quantity.
- Silence detection can stop too early in noisy rooms or too late in quiet rooms.

Recommendation:

- Keep the current local silence detector, but add configurable thresholds through environment variables:
  - `VITE_VOICE_SILENCE_MS`
  - `VITE_VOICE_MIN_RECORD_MS`
  - `VITE_VOICE_MAX_RECORD_MS`
- Keep the current spoken completion logic, but add a fixture test set for phrases such as:
  - `Coke Zero five done`
  - `three Red Bulls finish`
  - `stop`
  - `done with this count`
  - `I am finished`

Suggested priority: Phase 1.

### 4. Empty Location or Missing Items

Current state:

- The UI can show that no countable inventory is loaded for the selected location.
- Preflight confirms seed item volume when `DEPLOY_PREFLIGHT_MIN_ITEMS` is set.

Risk:

- Users can still land on a location that has no items, stale hardcoded frontend names, or filtered results that look like a database failure.

Recommendation:

- Make all location selectors database-driven.
- Remove remaining hardcoded frontend location lists.
- Add an explicit empty-state reason:
  - no location selected
  - no database location exists
  - location exists but has no items
  - user does not have access to that location
  - item request failed

Suggested priority: Phase 1.

### 5. Authentication and Admin Recovery

Current state:

- Preflight checks active admin user, active admin membership, admin permission matrix, valid roles, and unique usernames.
- A reset-admin script exists.

Risk:

- Test users can get blocked if the admin password is reset inconsistently, the account membership is missing, or a deployment points at the wrong database.

Recommendation:

- Add an application-level auth smoke test that logs in with a temporary test credential, calls `/api/auth/me`, verifies permissions, and logs out.
- Keep database-level admin checks in preflight.
- Document one approved recovery command for resetting the test admin password.
- Add a guard that prevents disabling the last active admin during user management.

Suggested priority: Phase 1.

## Database and Inventory Edge Cases

### Min/Max Stock Model

Current state:

- Store items have min/max stock fields.
- Preflight checks negative min/max values and invalid ranges.
- Preflight reports items below minimum as a warning.

Recommendations:

- Treat `quantity < min_quantity` as a reorder signal.
- Treat `quantity > max_quantity` as an overstock signal.
- Do not block deployment when items are below minimum; that is an operational state, not corruption.
- Add dashboard cards for below-minimum and above-maximum counts by location.
- Add warehouse transfer suggestions based on `max_quantity - quantity`, capped by warehouse availability.

Suggested priority: Phase 2.

### Item Classification

Current state:

- Seed data includes categories such as beverages, candy, chips, snacks, and pastries.
- Classification indexes are part of preflight.

Recommendations:

- Keep category values normalized enough for filtering and voice candidate reduction.
- Add optional subcategory and brand fields later if reports need them.
- Use account, location, category, and name indexes for store inventory lookups.
- Use account, warehouse, category, and name indexes for warehouse inventory lookups.

Suggested priority: Phase 2.

### Duplicate and Ambiguous Items

Current state:

- Preflight checks duplicate item names and barcodes within account/location scope.
- Voice mode has ambiguous item handling.

Recommendations:

- Keep duplicate names allowed only when a differentiator exists, such as size, flavor, pack type, or barcode.
- Add UI warnings when a user creates an item whose normalized name is too close to an existing item in the same location.
- In voice mode, require confirmation or clarification when multiple candidates score closely.

Suggested priority: Phase 2.

### Import and Seed Safety

Current state:

- The seed script can top up or reset test inventory.
- The 600-item seed is test data only.

Recommendations:

- Keep reset seed disabled for production-like data.
- Add a confirmation flag, such as `SEED_ALLOW_DESTRUCTIVE=true`, before any reset deletes inventory or history.
- Add import previews that show duplicate barcodes, invalid quantities, missing required fields, and target location before applying.

Suggested priority: Phase 2.

## API, Security, and Deployment Edge Cases

### CORS, Cookies, and Public URL Drift

Current state:

- CORS must match the exact public test origin.
- Cookie-based auth is working when the browser origin and `CORS_ORIGIN` match.

Recommendations:

- Add a preflight check that rejects mismatched `CORS_ORIGIN` and public app URL values.
- Add a smoke test that performs browser-equivalent login through the public HTTPS domain.
- Keep Cloudflare Access in front of the test environment.
- Keep the VPS control panel on its own hostname and service certificate.

Suggested priority: Phase 1.

### Rate Limits and Abuse Controls

Current state:

- Some command routes have rate limiting.
- Voice endpoints are protected by authentication and `use_voice_mode`.

Recommendations:

- Add per-user and per-account rate limits for:
  - `/api/voice/transcribe`
  - `/api/voice/parse`
  - `/api/voice/speak`
  - `/api/command`
  - login attempts
- Return clear retry messages instead of generic failures.
- Log rate-limit hits as security events.

Suggested priority: Phase 2.

### Inactivity Timeout

Current state:

- A session timeout design exists, but implementation should be confirmed separately.

Recommendations:

- Warn after 15 minutes of inactivity.
- Log out after 20 minutes of inactivity.
- Treat active voice recording as activity.
- Do not let a background tab keep a session alive forever.

Suggested priority: Phase 2.

## AI and Agent Edge Cases

### AI Cost Tracking

Current state:

- A cost tracking design exists.
- AI calls include voice transcription, parse, speech, agent insights, and future reports.

Recommendations:

- Add an `ai_usage_events` table before broad user testing.
- Record workflow, provider, model, account, user, duration, token estimates, audio seconds, status, and cost estimate.
- Do not store prompts or transcripts in cost tables unless retention is intentionally approved.
- Summarize cost by account and workflow.

Suggested priority: Phase 2.

### Agent Middleware Layer

Current state:

- Agent middleware is designed as a layer between frontend workflows and backend data.

Recommendations:

- Start with read-only agents:
  - inventory health agent
  - reorder suggestion agent
  - data quality agent
  - voice failure review agent
- Require explicit human approval before any agent writes inventory changes.
- Cache or precompute expensive agent summaries so they do not slow live voice counts.

Suggested priority: Phase 3.

### OpenAI vs Self-Hosted AI Fallback

Current state:

- OpenAI credentials can be configured.
- LocalAI was useful for connectivity tests, but voice quality and model support were inconsistent.

Recommendations:

- Use OpenAI for the test voice workflow until the product flow is stable.
- Keep LocalAI or self-hosted models as a future cost-control option for non-critical tasks, such as classification, summaries, and low-risk suggestions.
- Do not move live voice transcription or TTS to self-hosted models until latency, quality, and reliability are measured.

Suggested priority: Phase 2.

## TypeScript and Build Edge Cases

Current state:

- Project references reduce repeat type-check time.
- The first uncached frontend type check can still be heavy because of dependency resolution.

Recommendations:

- Keep API, database, integrations, scripts, and web as separate TypeScript projects.
- Continue extracting large page logic, especially voice workflow code, into smaller hooks and helper modules.
- Add focused tests around helpers before moving more UI logic.
- Keep generated build artifacts out of manual edits.

Suggested priority: Ongoing.

## Recommended Next Implementation Order

1. Add durable voice count session tables and write session events.
2. Add voice diagnostics endpoint and visible TTS/transcription source indicators.
3. Normalize all frontend location selectors to database-backed locations.
4. Add public HTTPS auth smoke test and voice endpoint smoke checks.
5. Add admin recovery and last-admin protection.
6. Add AI usage event tracking.
7. Add read-only agent health summaries.
8. Add short-lived API cache for item/location reads after instrumentation confirms query hotspots.

## Implementation Started On 2026-06-01

The first recommendation is now underway:

- Added `count_sessions` for one row per voice count session.
- Added `count_session_events` for the important events inside a count session.
- Added voice API endpoints to start a session, record events, and complete a session.
- Wired the store voice count screen to create an audit session and record transcripts, item matches, confirmations, save successes, save failures, skipped items, and session completion.
- Added deployment preflight checks for the new count-session migration and lookup indexes.

This creates the foundation for accounting-grade review without storing raw audio.

The agent-insights conversation module has also been started:

- Added a read-only `POST /api/agents/conversation` endpoint.
- The endpoint answers from curated housekeeping summaries and recommendations, not raw unrestricted database access.
- If OpenAI credentials are unavailable, the endpoint returns a deterministic fallback answer from the current recommendation snapshot.
- Added an Insights Conversation panel to the Agent Insights page with suggested prompts and a running session thread.

## Quick Verification Commands

Run these from the VPS project directory when validating the test environment:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  run --rm -e DEPLOY_PREFLIGHT_MIN_ITEMS=600 keeptally corepack pnpm run deploy:preflight
```

```bash
curl -I https://test.keeptally.ai/api/healthz
curl -sS https://test.keeptally.ai/api/ai/connectivity
```

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  logs --tail=200 keeptally | grep -iE "voice|transcri|tts|speak|parse|error"
```

## Summary

The core test environment is much stronger than it was at the beginning of the VPS work. The remaining high-value edge cases are mostly about traceability, visibility, and operator confidence: voice sessions need a durable audit trail, voice diagnostics need to be visible without digging through logs, location data should be fully database-driven, and auth checks should be tested through the same public HTTPS path that users will use.
