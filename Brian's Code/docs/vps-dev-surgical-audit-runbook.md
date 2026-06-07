# KeepTally VPS Dev Surgical Audit Runbook

## Purpose

This audit battery checks the dev environment from four angles:

- Security posture: unauthenticated access denial, bad login handling, cookie flags, schema rejection, and oversized request rejection.
- Functional regression: login, core pages, primary read APIs, Agent Insights, AI connectivity, and voice parse behavior.
- Performance and load: bounded concurrent traffic against health, inventory, warehouse, and agent snapshot endpoints.
- Local regression suites: voice count, warehouse voice add item, and mobile scanner risk tests.

The script is designed for the dev stack first. It is intentionally bounded by default so it does not accidentally flood the VPS, Cloudflare, OpenAI, or PostgreSQL.

## VPS Command

Run from the repo root on the VPS:

```bash
cd "/root/Keep-Tally-AI/Brian's Code"

BASE_URL=http://127.0.0.1:3100 \
DEV_ADMIN_USERNAME=admin \
DEV_ADMIN_PASSWORD='YOUR_DEV_ADMIN_PASSWORD' \
corepack pnpm run audit:dev
```

Replace `YOUR_DEV_ADMIN_PASSWORD` with the actual dev admin password. The audit runner refuses to continue when that placeholder is left in place because every authenticated check would fail with `401`.

If the dev admin password is still the bootstrap value, use:

```bash
BASE_URL=http://127.0.0.1:3100 \
INITIAL_ADMIN_PASSWORD=admin1234 \
corepack pnpm run audit:dev
```

## Heavier Load Pass

Use this only when the dev stack is stable:

```bash
BASE_URL=http://127.0.0.1:3100 \
DEV_ADMIN_USERNAME=admin \
DEV_ADMIN_PASSWORD='YOUR_DEV_ADMIN_PASSWORD' \
AUDIT_LOAD_CONCURRENCY=25 \
AUDIT_LOAD_REQUESTS=500 \
AUDIT_SLOW_MS=3000 \
corepack pnpm run audit:dev
```

## Full Mutation Workflow Pass

This creates, updates, transfers, and cleans up test records through the API. Run it only against dev or an isolated test database.

```bash
BASE_URL=http://127.0.0.1:3100 \
DEV_ADMIN_USERNAME=admin \
DEV_ADMIN_PASSWORD='YOUR_DEV_ADMIN_PASSWORD' \
AUDIT_RUN_MUTATION_WORKFLOW=true \
corepack pnpm run audit:dev
```

## Optional Preflight Pass

```bash
BASE_URL=http://127.0.0.1:3100 \
DEV_ADMIN_USERNAME=admin \
DEV_ADMIN_PASSWORD='YOUR_DEV_ADMIN_PASSWORD' \
AUDIT_RUN_PREFLIGHT=true \
DEPLOY_PREFLIGHT_MIN_ITEMS=600 \
corepack pnpm run audit:dev
```

## How To Read The Output

- `OK`: the check passed within the configured slow threshold.
- `FAIL`: the endpoint, regression suite, security rule, or load threshold failed.
- `SLOW>3000ms`: the request returned, but it exceeded the target latency.
- `Timing Summary`: shows p50, p95, max latency, and the slowest calls.

## Recommended Triage

- Security failures: inspect auth middleware, route permissions, cookie settings, `TRUST_PROXY`, and `AUTH_COOKIE_SECURE`.
- Slow AI failures: inspect OpenAI latency, prompt size, fallback path, and whether the request should use local parsing first.
- Slow DB or list failures: inspect pagination, indexes, account/location filters, and query plans.
- Functional failures: rerun the endpoint with `curl`, then compare the timestamp with container logs.

## Safety Notes

- Default load is `80` requests at concurrency `8`.
- Mutation workflow is off by default.
- Deploy preflight is off by default.
- This script does not attempt destructive security testing, credential spraying, exploit payloads, or network scanning.
