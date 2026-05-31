import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

function isExpectedRuntimeEnv(value: string) {
  return value === "test" || value === "production";
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

add(
  "env:NODE_ENV",
  isExpectedRuntimeEnv(nodeEnv),
  `value=${nodeEnv}`,
  nodeEnv === "development",
);
add("env:PORT numeric", /^\d+$/.test(port), port || "missing");
add(
  "env:SESSION_SECRET strong value",
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

try {
  const ffmpegPath = execFileSync("sh", ["-lc", "command -v ffmpeg"], { encoding: "utf8" }).trim();
  add("voice:ffmpeg runtime", Boolean(ffmpegPath), ffmpegPath || "missing");
} catch {
  add("voice:ffmpeg runtime", false, "missing; browser WebM audio cannot be converted for transcription");
}

const migrationsDir = path.join(root, "lib/db/migrations");
const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort()
  : [];
add("db:migration files", migrationFiles.length > 0, `${migrationFiles.length} sql files`);
add("db:latest lookup index migration", migrationFiles.includes("0006_lookup_indexes.sql"), "0006_lookup_indexes.sql");
add("db:store min/max migration", migrationFiles.includes("0008_store_min_max_stock.sql"), "0008_store_min_max_stock.sql");
add(
  "db:phase one relational index migration",
  migrationFiles.includes("0007_phase_one_relational_indexes.sql"),
  "0007_phase_one_relational_indexes.sql",
);

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

      const requiredIndexes = [
        "items_account_location_name_idx",
        "items_account_legacy_location_name_idx",
        "user_location_assignments_account_location_idx",
        "user_location_assignments_account_user_idx",
        "history_account_item_created_idx",
        "scan_log_account_item_created_idx",
        "order_items_account_item_idx",
        "route_sheet_stops_account_location_created_idx",
        "route_sheet_stop_items_account_item_idx",
        "warehouse_purchases_account_item_created_idx",
        "warehouse_transfers_account_warehouse_item_created_idx",
        "warehouse_transfers_account_store_item_created_idx",
      ];
      const indexes = await client.query(
        `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
        order by indexname
        `,
        [requiredIndexes],
      );
      const presentIndexes = new Set(indexes.rows.map((row) => row.indexname as string));
      const missingIndexes = requiredIndexes.filter((indexName) => !presentIndexes.has(indexName));
      add(
        "db:relational lookup indexes",
        missingIndexes.length === 0,
        missingIndexes.length === 0 ? `${requiredIndexes.length} present` : `missing=${missingIndexes.join(", ")}`,
      );

      const relationalHealth = await client.query(`
        select 'history orphan item_id' as check_name, count(*)::int as count
        from history h
        where h.item_id is not null
          and not exists (select 1 from items i where i.id = h.item_id)
        union all
        select 'scan_log orphan item_id', count(*)::int
        from scan_log s
        where s.item_id is not null
          and not exists (select 1 from items i where i.id = s.item_id)
        union all
        select 'warehouse_purchases orphan warehouse_item_id', count(*)::int
        from warehouse_purchases wp
        where not exists (select 1 from warehouse_items wi where wi.id = wp.warehouse_item_id)
        union all
        select 'warehouse_transfers orphan warehouse_item_id', count(*)::int
        from warehouse_transfers wt
        where not exists (select 1 from warehouse_items wi where wi.id = wt.warehouse_item_id)
        union all
        select 'warehouse_transfers orphan store_item_id', count(*)::int
        from warehouse_transfers wt
        where wt.store_item_id is not null
          and not exists (select 1 from items i where i.id = wt.store_item_id)
        union all
        select 'items missing location_id', count(*)::int
        from items
        where location_id is null
        union all
        select 'orders missing location_id', count(*)::int
        from orders
        where location_id is null
        union all
        select 'history missing location_id', count(*)::int
        from history
        where location is not null and location_id is null
        union all
        select 'scan_log missing location_id', count(*)::int
        from scan_log
        where location is not null and location_id is null
        union all
        select 'warehouse_transfers missing store_location_id', count(*)::int
        from warehouse_transfers
        where store_location_id is null
      `);
      const relationalIssues = relationalHealth.rows
        .filter((row) => Number(row.count) > 0)
        .map((row) => `${row.check_name}=${row.count}`);
      add(
        "db:relational health",
        relationalIssues.length === 0,
        relationalIssues.length === 0 ? "no orphan references or missing normalized locations" : relationalIssues.join(", "),
        relationalIssues.length > 0,
      );

      const adminHealth = await client.query(`
        with admin_permissions(permission_key) as (
          values
            ('manage_users'),
            ('delete_items'),
            ('edit_settings'),
            ('view_costs'),
            ('view_all_reports'),
            ('edit_warehouse'),
            ('receive_purchases'),
            ('transfer_inventory'),
            ('view_warehouse'),
            ('edit_store_inventory'),
            ('scan_barcodes'),
            ('use_voice_mode'),
            ('mark_adjustments'),
            ('view_all_locations')
        )
        select 'active admin users' as check_name, count(*)::int as count
        from users
        where username = 'admin'
          and role = 'admin'
          and active = true
        union all
        select 'active admin memberships', count(*)::int
        from users u
        join account_memberships am on am.user_id = u.id and am.account_id = u.account_id
        where u.username = 'admin'
          and u.role = 'admin'
          and u.active = true
          and am.role = 'admin'
          and am.active = true
        union all
        select 'enabled admin permissions', count(*)::int
        from users u
        join role_permissions rp on rp.account_id = u.account_id
        join admin_permissions ap on ap.permission_key = rp.permission_key
        where u.username = 'admin'
          and rp.role = 'admin'
          and rp.enabled = true
        union all
        select 'unsupported user roles', count(*)::int
        from users
        where role not in ('admin', 'warehouse', 'stocker')
        union all
        select 'unsupported membership roles', count(*)::int
        from account_memberships
        where role not in ('admin', 'warehouse', 'stocker')
        union all
        select 'duplicate usernames', count(*)::int
        from (
          select lower(username)
          from users
          group by lower(username)
          having count(*) > 1
        ) duplicates
      `);
      const adminRows = new Map(adminHealth.rows.map((row) => [row.check_name as string, Number(row.count)]));
      add(
        "auth:active admin user",
        (adminRows.get("active admin users") ?? 0) === 1,
        `count=${adminRows.get("active admin users") ?? 0}`,
      );
      add(
        "auth:active admin membership",
        (adminRows.get("active admin memberships") ?? 0) === 1,
        `count=${adminRows.get("active admin memberships") ?? 0}`,
      );
      add(
        "auth:admin permission matrix",
        (adminRows.get("enabled admin permissions") ?? 0) === 14,
        `enabled=${adminRows.get("enabled admin permissions") ?? 0}/14`,
      );
      const authIssues = [
        ["unsupported user roles", adminRows.get("unsupported user roles") ?? 0],
        ["unsupported membership roles", adminRows.get("unsupported membership roles") ?? 0],
        ["duplicate usernames", adminRows.get("duplicate usernames") ?? 0],
      ].filter(([, count]) => count > 0);
      add(
        "auth:role and username integrity",
        authIssues.length === 0,
        authIssues.length === 0
          ? "roles valid and usernames unique"
          : authIssues.map(([name, count]) => `${name}=${count}`).join(", "),
      );

      const edgeCaseHealth = await client.query(`
        select 'items negative quantity' as check_name, count(*)::int as count
        from items
        where quantity < 0
        union all
        select 'items negative par_level', count(*)::int
        from items
        where par_level < 0
        union all
        select 'items negative min_quantity', count(*)::int
        from items
        where min_quantity < 0
        union all
        select 'items negative max_quantity', count(*)::int
        from items
        where max_quantity < 0
        union all
        select 'items invalid min/max range', count(*)::int
        from items
        where max_quantity < min_quantity
        union all
        select 'items below minimum', count(*)::int
        from items
        where quantity < min_quantity
        union all
        select 'items duplicate account/location/name', count(*)::int
        from (
          select account_id, location_id, lower(name) as normalized_name
          from items
          group by account_id, location_id, lower(name)
          having count(*) > 1
        ) duplicates
        union all
        select 'items duplicate account/location/barcode', count(*)::int
        from (
          select account_id, location_id, barcode
          from items
          where barcode is not null and trim(barcode) <> ''
          group by account_id, location_id, barcode
          having count(*) > 1
        ) duplicates
        union all
        select 'warehouse_items negative quantity', count(*)::int
        from warehouse_items
        where quantity < 0
        union all
        select 'warehouse_items duplicate account/warehouse/name', count(*)::int
        from (
          select account_id, warehouse_id, lower(name) as normalized_name
          from warehouse_items
          group by account_id, warehouse_id, lower(name)
          having count(*) > 1
        ) duplicates
        union all
        select 'active users without active membership', count(*)::int
        from users u
        where u.active = true
          and not exists (
            select 1
            from account_memberships am
            where am.user_id = u.id
              and am.account_id = u.account_id
              and am.active = true
          )
        union all
        select 'assigned location names without rows', count(*)::int
        from users u
        cross join lateral unnest(u.assigned_locations) as assigned_location(name)
        where u.account_id is not null
          and not exists (
            select 1
            from user_location_assignments ula
            join locations l on l.id = ula.location_id
            where ula.account_id = u.account_id
              and ula.user_id = u.id
              and l.name = assigned_location.name
          )
      `);
      const edgeIssues = edgeCaseHealth.rows
        .filter((row) => row.check_name !== "items below minimum")
        .filter((row) => Number(row.count) > 0)
        .map((row) => `${row.check_name}=${row.count}`);
      add(
        "db:edge-case health",
        edgeIssues.length === 0,
        edgeIssues.length === 0 ? "no duplicate keys, negative counts, or access drift detected" : edgeIssues.join(", "),
        edgeIssues.length > 0,
      );
      const belowMinimum = edgeCaseHealth.rows.find((row) => row.check_name === "items below minimum");
      add(
        "db:store min/max stock model",
        true,
        `below_minimum=${belowMinimum?.count ?? 0}`,
        true,
      );
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
