import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const port = process.env.PORT ?? "3000";
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://la-forge.fox@localhost:5432/keep_tally_brian_code";
const devUsername = process.env.DEV_ADMIN_USERNAME ?? "admin";
const devPassword = process.env.INITIAL_ADMIN_PASSWORD ?? "admin1234";

async function httpStatus(name, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return {
      name,
      ok: res.ok,
      detail: `${res.status} ${res.statusText} (${Date.now() - started}ms)`,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function psqlValue(sql) {
  const { stdout } = await execFileAsync("psql", [
    databaseUrl,
    "-At",
    "-c",
    sql,
  ]);
  return stdout.trim();
}

async function databaseStatus() {
  try {
    const [users, items, admin] = await Promise.all([
      psqlValue("select count(*) from users;"),
      psqlValue("select count(*) from items;"),
      psqlValue(
        "select concat(username, ':', active, ':', must_change_password) from users where username = 'admin' limit 1;",
      ),
    ]);

    return {
      name: "database",
      ok: true,
      detail: `users=${users || 0}, items=${items || 0}, admin=${admin || "missing"}`,
    };
  } catch (error) {
    return {
      name: "database",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const checks = await Promise.all([
  httpStatus("web", baseUrl),
  httpStatus("api", `${baseUrl}/api/healthz`),
  databaseStatus(),
]);

for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`);
}

console.log(`local url: ${baseUrl}`);
console.log(`local admin: ${devUsername} / ${devPassword}`);
console.log("reset admin: corepack pnpm run dev:reset-admin");

process.exit(checks.every((check) => check.ok) ? 0 : 1);
