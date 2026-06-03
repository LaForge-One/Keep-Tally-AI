# KeepTally Dev To Test Promotion Checklist

Date: 2026-06-02

Status: Ready for promotion planning

Audience: Business owner, implementation team, test coordinator

## Purpose

This checklist prepares the latest KeepTally development updates to be promoted into the test environment for user access testing.

The goal is to move verified development changes into test without carrying over development-only configuration, test secrets, or unstable environment assumptions.

## Development Updates Included

The current development promotion includes:

- Dedicated KeepTally dev environment setup.
- Voice count session and event audit trail.
- Spoken confirmation requirement before voice count saves.
- Voice workflow diagnostics and logging.
- Admin user creation script for empty databases.
- Voice count regression tests.
- Inventory lookup performance improvements.
- Scan and command lookup consolidation.
- Order count and warehouse import lookup optimization.
- AI insights conversation direction.
- Business documentation for dev changes and product identifier lifecycle planning.

## Business Justification

These updates should move to test because they improve the application's readiness for controlled user testing.

The most important business improvements are:

- Better traceability for voice counts.
- Lower risk of accidental inventory changes.
- Faster item lookup behavior.
- Cleaner environment separation between development and test.
- Better support for future AI-assisted inventory operations.

## Promotion Rule

Promote only committed code from `main`.

Do not copy development environment files directly into test. The test lane should keep its own:

- `.env.vps-test`
- `.env.ai` if still used
- Postgres database
- public HTTPS origin
- Cloudflare/Webuzo routing

## Pre-Promotion Checks

Run these checks from the local workstation before relying on the update:

```bash
cd "/Users/la-forge.fox/Documents/Keep Tally Brians Code/Brian's Code"

corepack pnpm run test:voice-count
corepack pnpm run test:mobile-scanner-risks
```

Expected:

- Voice count regression tests pass.
- Mobile native scanner risk tests pass.
- No code changes are left unstaged except local environment files that should not be committed.
- `HEAD` matches `origin/main` after the promotion commit is pushed.

Important:

- The outer folder is the Git repository root.
- The runnable Node workspace is inside `Brian's Code`.
- Run `pnpm install`, `pnpm run`, and `corepack pnpm run` commands from `Brian's Code`, not from the outer folder.

## Scanner Promotion Gate

Scanner changes must pass both automated and manual checks before they are promoted from dev to test.

Automated command:

```bash
cd "/Users/la-forge.fox/Documents/Keep Tally Brians Code/Brian's Code"

corepack pnpm run test:mobile-scanner-risks
```

Expected:

- Native camera deep links can prefill lookup but cannot write inventory.
- Native scanner input cannot bypass authentication.
- Scanner input without a selected location cannot write inventory.
- External URLs and unsupported QR payloads are rejected.
- Duplicate action IDs do not write twice.
- UPC normalization handles formatting differences.

Manual mobile checks:

- iPhone native Camera opens a KeepTally scan link but does not write inventory automatically.
- Android native Camera opens a KeepTally scan link but does not write inventory automatically.
- External or spoofed scan URLs are rejected.
- In-app mobile scanner works over HTTPS.
- If camera permission is denied, manual barcode entry still works.
- Repeated scans do not create duplicate inventory updates.

Reference document:

```text
docs/mobile-native-scanner-risk-test-battery.md
```

## VPS Test Promotion Commands

Run these commands on the VPS in the test application directory:

```bash
cd "/root/Keep-Tally-AI/Brian's Code"

git pull origin main
```

Confirm the expected files are present:

```bash
ls -l \
  docs/dev-change-summary-and-justification.md \
  docs/product-identifier-lifecycle-change-request.md \
  docs/dev-to-test-promotion-checklist.md
```

## VPS Stack Start And Stop Helper

The repo includes a helper script for common dev and test container actions:

```bash
./scripts/vps-stack.sh <dev|test> <start|stop|restart|status|logs|health> [--with-ai]
```

Dev stack examples:

```bash
./scripts/vps-stack.sh dev start
./scripts/vps-stack.sh dev status
./scripts/vps-stack.sh dev health
./scripts/vps-stack.sh dev logs
./scripts/vps-stack.sh dev stop
```

Test stack examples:

```bash
./scripts/vps-stack.sh test start
./scripts/vps-stack.sh test status
./scripts/vps-stack.sh test health
./scripts/vps-stack.sh test logs
./scripts/vps-stack.sh test stop
```

If the test stack is using the LocalAI compose file, include `--with-ai`:

```bash
./scripts/vps-stack.sh test start --with-ai
./scripts/vps-stack.sh test restart --with-ai
./scripts/vps-stack.sh test logs --with-ai
```

Important:

- Use `--with-ai` only when intentionally testing the self-hosted LocalAI stack.
- Do not use `--with-ai` when the test lane should use OpenAI at `https://api.openai.com/v1`.
- The LocalAI compose overlay changes `AI_INTEGRATIONS_OPENAI_BASE_URL` to `http://localai:8080/v1`, which can make OpenAI transcription and text-to-speech fail if LocalAI audio models are not configured.

The helper does not modify databases or environment files. It only wraps Docker Compose container actions.

## VPS AI Diagnostic Helper

Use this when voice count reports that the VPS AI or OpenAI service is unavailable:

```bash
./scripts/vps-ai-diagnose.sh test
```

For dev:

```bash
./scripts/vps-ai-diagnose.sh dev
```

For an intentional LocalAI test:

```bash
./scripts/vps-ai-diagnose.sh test --with-ai
```

The diagnostic helper checks:

- Which environment file is being used.
- Whether AI base URL and model settings are present.
- Whether the running container sees the same AI values.
- Whether `/api/ai/status` and `/api/ai/connectivity` work locally on the VPS.

The helper masks API keys in output.

## Test Environment Configuration Check

Confirm the test lane is still using test configuration, not dev configuration:

```bash
grep -nE 'NODE_ENV|DATABASE_URL|CORS_ORIGIN|SESSION_SECRET|AI_INTEGRATIONS_OPENAI_BASE_URL|AI_TTS_MODEL|AI_TTS_VOICE|VITE_VOICE_COUNT' .env.vps-test
```

Expected:

- `DATABASE_URL` points to the test database.
- `CORS_ORIGIN` points to the test HTTPS origin.
- OpenAI credentials are present if OpenAI voice testing is expected.
- Voice confirmation audio flags are enabled when testing AI voice workflow.

## Build And Restart Test

Use the test compose stack, not the dev stack:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  up -d --build --force-recreate keeptally
```

If the test stack also depends on the LocalAI compose file, include it:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  up -d --build --force-recreate keeptally
```

## Run Test Migrations

Run migrations against the test database:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  run --rm keeptally corepack pnpm run db:migrate
```

If the test stack uses `.env.ai`, include it:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm keeptally corepack pnpm run db:migrate
```

## Run Test Preflight

Run preflight with the 600-item expectation:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  run --rm -e DEPLOY_PREFLIGHT_MIN_ITEMS=600 keeptally corepack pnpm run deploy:preflight
```

Expected:

- Database connection passes.
- Active admin user exists.
- Lookup indexes exist.
- Seed inventory meets the minimum item expectation.
- Count session migration is present.
- No blocking failures are reported.

## Public Test Smoke Checks

After restart and migration, confirm the public test URL:

```bash
curl -I https://test.keeptally.ai/api/healthz
curl -sS https://test.keeptally.ai/api/ai/connectivity
```

Expected:

- Health endpoint returns `200`.
- AI connectivity returns configured status.
- If OpenAI is used, the base URL should be `https://api.openai.com/v1`.
- If self-hosted AI is used, the base URL should match the approved internal AI endpoint.

## Browser Acceptance Checks

Complete these checks in the browser:

1. Login through the HTTPS test site.
2. Confirm dashboard loads.
3. Confirm item list loads with the expected test inventory.
4. Open Voice Count.
5. Select a location with known items.
6. Start voice count.
7. Speak an item and quantity.
8. Confirm the app shows the transcript.
9. Confirm the app asks for confirmation before saving.
10. Speak an affirmative response such as `yes`, `confirm`, or `correct`.
11. Confirm the count is saved or marked skipped according to the response.
12. Confirm the session/event history is recorded.
13. Confirm AI voice feedback plays when OpenAI TTS is enabled.

## Hold Points

Do not call the test update successful if any of these occur:

- Login fails.
- Test points to the dev database.
- The app cannot connect to AI when AI testing is expected.
- Voice transcription works but confirmation does not save.
- Voice confirmation saves without an affirmative response.
- The count session audit trail is missing.
- Preflight reports a blocking failure.
- The public HTTPS site returns a 500, 502, or cross-origin error.

## Rollback Plan

If the promoted test update fails:

1. Capture the failing logs.
2. Stop new user testing.
3. Revert the test container to the previous known-good image or commit.
4. Keep the database unchanged unless a migration caused the failure.
5. If a migration caused the failure, restore from the latest test database backup.

Recommended log command:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  logs --tail=200 keeptally
```

## Business Recommendation

Proceed with promotion only after the local regression test and VPS preflight pass.

This promotion is appropriate for user access testing because the recent development updates directly address voice count reliability, auditability, and performance. It should still be treated as a test environment update, not a production release.
