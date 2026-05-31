# Secure VPS Test Access

Date: 2026-05-31

## Goal

Keep the VPS test environment usable for invited testers without making the application directly public.

## Recommended Shape

```mermaid
flowchart LR
  Tester["Invited tester"] --> Cloudflare["Cloudflare Access email gate"]
  Cloudflare --> Nginx["Webuzo/Nginx HTTPS reverse proxy"]
  Nginx --> App["KeepTally container on 127.0.0.1:3000"]
  App --> Db["PostgreSQL on VPS localhost/private network"]
  App --> LocalAi["LocalAI on Docker/internal or 127.0.0.1"]
```

Docker is useful isolation, but it is not an access-control boundary for a public test site. Public traffic should reach KeepTally only through HTTPS and an outer access gate.

## Access Rules

- Public tester URL: `https://test.keeptally.ai`
- Direct app port `3000`: localhost only.
- LocalAI port `8080`: localhost or Docker-internal only.
- PostgreSQL port `5432`: localhost or private interface only.
- Keep normal KeepTally login enabled behind the outer gate.
- Create individual KeepTally users for testers instead of sharing the admin account.

## Cloudflare Access Setup

1. Open Cloudflare Zero Trust.
2. Go to `Access` -> `Applications`.
3. Add a self-hosted application.
4. Application domain: `test.keeptally.ai`.
5. Policy action: `Allow`.
6. Include rule: approved tester emails.
7. Session duration: use a short test value, such as 8 to 24 hours.
8. Save and test in a private browser window.

Expected tester flow:

```text
Open https://test.keeptally.ai
Pass Cloudflare email/identity check
See KeepTally login
Sign in with assigned KeepTally test user
```

## VPS Port Check

Run this on the VPS after restart:

```bash
ss -ltnp | grep -E ':3000|:8080|:5432|:80|:443'
```

Expected:

- `:80` and `:443` may be public through Webuzo/Nginx.
- `:3000` should be `127.0.0.1:3000`, not `*:3000`.
- `:8080` should be `127.0.0.1:8080` or Docker-internal only.
- `:5432` should not be publicly exposed.

## Database Seed Verification

For the 600-item VPS test seed, run:

```bash
cd "/root/Keep-Tally-AI/Brian's Code"

docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm -e SEED_ITEM_COUNT=600 keeptally corepack pnpm --filter @workspace/scripts run seed
```

If the test database already contains the older 12-item seed and you want to rebuild the test inventory:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm -e SEED_RESET=true -e SEED_ITEM_COUNT=600 keeptally corepack pnpm --filter @workspace/scripts run seed
```

Then verify item counts:

```bash
psql "postgresql://keeptally:CURRENT_TEST_PASSWORD@127.0.0.1:5432/keeptally_test" \
  -c "select l.name, count(i.id) as items from locations l left join items i on i.location_id = l.id group by l.name order by l.name;"
```

Run preflight with the 600-item expectation:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  run --rm -e DEPLOY_PREFLIGHT_MIN_ITEMS=600 keeptally corepack pnpm run deploy:preflight
```

## API Checks

After signing in and saving a cookie:

```bash
curl -i -sS -c /tmp/kt-cookie.txt \
  -H "Content-Type: application/json" \
  -X POST https://test.keeptally.ai/api/auth/login \
  -d '{"username":"admin","password":"CURRENT_TEST_ADMIN_PASSWORD"}'

curl -sS -b /tmp/kt-cookie.txt https://test.keeptally.ai/api/locations

curl -sS -b /tmp/kt-cookie.txt "https://test.keeptally.ai/api/items?location=Mesa%20Warehouse" | head -c 500

curl -sS -b /tmp/kt-cookie.txt https://test.keeptally.ai/api/ai/connectivity

curl -sS -b /tmp/kt-cookie.txt https://test.keeptally.ai/api/agents/summary
```

The item request should return an array. If it returns an error, the voice count screen now shows the actual server message.
