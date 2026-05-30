import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

type Check = { name: string; ok: boolean; detail: string; warn?: boolean };

const root = path.resolve(import.meta.dirname, "../..");
const checks: Check[] = [];

function add(name: string, ok: boolean, detail: string, warn = false) {
  checks.push({ name, ok, detail, warn });
}

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function isLocalSecret(value: string) {
  return /local-development|change-before-production|admin1234|dev-placeholder/i.test(value);
}

function requiredEnv(name: string) {
  const value = env(name);
  add(`env:${name}`, Boolean(value), value ? "set" : "missing");
  return value;
}

const nodeEnv = env("NODE_ENV") || "development";
const port = requiredEnv("PORT");
const databaseUrl = requiredEnv("DATABASE_URL");
const sessionSecret = requiredEnv("SESSION_SECRET");
const corsOrigin = requiredEnv("CORS_ORIGIN");

add("env:NODE_ENV", nodeEnv === "production", `value=${nodeEnv}`, nodeEnv !== "production");
add("env:PORT numeric", /^\d+$/.test(port), port || "missing");
add(
  "env:SESSION_SECRET production value",
  Boolean(sessionSecret) && sessionSecret.length >= 32 && !isLocalSecret(sessionSecret),
  sessionSecret ? `length=${sessionSecret.length}` : "missing",
);
add(
  "env:CORS_ORIGIN explicit",
  Boolean(corsOrigin) && !corsOrigin.includes("localhost"),
  corsOrigin || "missing",
  Boolean(corsOrigin) && corsOrigin.includes("localhost"),
);

const openAiBaseUrl = env("AI_INTEGRATIONS_OPENAI_BASE_URL");
const openAiKey = env("AI_INTEGRATIONS_OPENAI_API_KEY");
const selfHostedAi = env("AI_SELF_HOSTED_ENABLED") === "true" || /localai|ollama/i.test(openAiBaseUrl);
add(
  "ai:credentials",
  Boolean(openAiBaseUrl && openAiKey && openAiKey !== "dev-placeholder"),
  openAiKey && openAiKey !== "dev-placeholder"
    ? selfHostedAi
      ? `configured via self-hosted endpoint: ${openAiBaseUrl}`
      : "configured"
    : "pending; offline voice fallback expected",
  true,
);
if (selfHostedAi) {
  add("ai:self-hosted mode", true, openAiBaseUrl || "enabled");
}

const webDist = env("WEB_DIST_DIR") || path.join(root, "artifacts/keep-tally/dist/public");
add("build:web dist", existsSync(path.join(webDist, "index.html")), webDist);
add(
  "build:api dist",
  existsSync(path.join(root, "artifacts/api-server/dist/index.mjs")),
  "artifacts/api-server/dist/index.mjs",
);

const migrationsDir = path.join(root, "lib/db/migrations");
const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort()
  : [];
add("db:migration files", migrationFiles.length > 0, `${migrationFiles.length} sql files`);
add("db:latest lookup index migration", migrationFiles.includes("0006_lookup_indexes.sql"), "0006_lookup_indexes.sql");

if (databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: Number(process.env.DEPLOY_PREFLIGHT_DB_TIMEOUT_MS ?? 5000),
    idleTimeoutMillis: 1000,
    max: 1,
  });

  try {
    const client = await pool.connect();
    try {
      const started = Date.now();
      const ping = await client.query("select current_database() as db, current_user as user");
      add("db:connect", true, `${ping.rows[0].db} as ${ping.rows[0].user} (${Date.now() - started}ms)`);

      const counts = await client.query(`
        select
          (select count(*)::int from users) as users,
          (select count(*)::int from locations) as locations,
          (select count(*)::int from items) as items
      `);
      add(
        "db:seed data",
        counts.rows[0].users > 0 && counts.rows[0].locations > 0,
        `users=${counts.rows[0].users}, locations=${counts.rows[0].locations}, items=${counts.rows[0].items}`,
      );

      const indexes = await client.query(
        `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
        order by indexname
        `,
        [[
          "items_account_location_name_idx",
          "items_account_legacy_location_name_idx",
          "user_location_assignments_account_location_idx",
        ]],
      );
      add("db:lookup indexes", indexes.rowCount === 3, indexes.rows.map((row) => row.indexname).join(", ") || "missing");
    } finally {
      client.release();
    }
  } catch (error) {
    add("db:connect", false, error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

for (const check of checks) {
  const label = check.ok ? "OK" : check.warn ? "WARN" : "FAIL";
  console.log(`${label} ${check.name}: ${check.detail}`);
}

const failures = checks.filter((check) => !check.ok && !check.warn);
if (failures.length > 0) {
  console.error(`Preflight failed: ${failures.length} blocking check(s).`);
  process.exit(1);
}

console.log("Preflight passed with no blocking failures.");
