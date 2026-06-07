#!/usr/bin/env node

import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const baseUrl = (process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3100"}`).replace(/\/$/, "");
const username = process.env.DEV_ADMIN_USERNAME ?? "admin";
const password = process.env.DEV_ADMIN_PASSWORD ?? process.env.INITIAL_ADMIN_PASSWORD ?? "admin1234";
const loadConcurrency = numberEnv("AUDIT_LOAD_CONCURRENCY", 8);
const loadRequests = numberEnv("AUDIT_LOAD_REQUESTS", 80);
const slowMs = numberEnv("AUDIT_SLOW_MS", 3000);
const timeoutMs = numberEnv("AUDIT_TIMEOUT_MS", 12000);
const runMutationWorkflow = boolEnv("AUDIT_RUN_MUTATION_WORKFLOW", false);
const runPreflight = boolEnv("AUDIT_RUN_PREFLIGHT", false);
const runRegression = boolEnv("AUDIT_RUN_REGRESSION", true);
const startedAt = new Date();
const results = [];
const timings = [];
let cookie = "";

function numberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function section(title) {
  console.log("");
  console.log(`== ${title} ==`);
}

function record(name, ok, detail = "", meta = {}) {
  results.push({ name, ok, detail, ...meta });
  console.log(`${ok ? "OK" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function request(label, method, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (cookie && options.auth !== false && !headers.has("cookie")) headers.set("cookie", cookie);
  if (options.json !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");

  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const started = performance.now();
  let res;
  let body = null;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      signal: AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
    });
    const contentType = res.headers.get("content-type") ?? "";
    body = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");
    const ms = Math.round(performance.now() - started);
    timings.push({ label, method, path, status: res.status, ms });
    return { ok: true, res, body, ms };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    timings.push({ label, method, path, status: 0, ms, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, res: null, body: null, ms, error };
  }
}

async function expect(label, method, path, options = {}) {
  const expected = options.expected ?? [200];
  const result = await request(label, method, path, options);
  if (!result.ok) {
    record(label, false, result.error instanceof Error ? result.error.message : String(result.error));
    return result;
  }
  const ok = expected.includes(result.res.status);
  const slow = result.ms > slowMs;
  const detail = `${method} ${path} -> ${result.res.status} (${result.ms}ms)${slow ? ` SLOW>${slowMs}ms` : ""}`;
  record(label, ok && !slow, detail, { slow, status: result.res.status, ms: result.ms });
  if (!ok && result.body) {
    const text = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    console.log(text.slice(0, 600));
  }
  return result;
}

async function command(label, file, args, options = {}) {
  const started = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: 1024 * 1024 * 16,
    });
    const ms = Math.round(performance.now() - started);
    record(label, true, `${ms}ms`);
    if (options.printOutput) {
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.error(stderr.trim());
    }
    return { ok: true, stdout, stderr, ms };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const stderr = error?.stderr ? String(error.stderr) : "";
    const stdout = error?.stdout ? String(error.stdout) : "";
    record(label, false, `${ms}ms ${error instanceof Error ? error.message : String(error)}`);
    if (stdout.trim()) console.log(stdout.trim().slice(-4000));
    if (stderr.trim()) console.error(stderr.trim().slice(-4000));
    return { ok: false, stdout, stderr, ms, error };
  }
}

async function login() {
  const result = await expect("auth: login", "POST", "/api/auth/login", {
    auth: false,
    expected: [200],
    json: { username, password },
  });
  cookie = result.res?.headers.get("set-cookie")?.split(";")[0] ?? "";
  const setCookie = result.res?.headers.get("set-cookie") ?? "";
  record("auth: cookie issued", Boolean(cookie), cookie ? "kt_token received" : "missing Set-Cookie");
  record("auth: cookie HttpOnly", /httponly/i.test(setCookie), /httponly/i.test(setCookie) ? "HttpOnly set" : "HttpOnly missing");
  record("auth: cookie SameSite", /samesite=/i.test(setCookie), /samesite=/i.test(setCookie) ? setCookie.match(/samesite=[^;]+/i)?.[0] ?? "" : "SameSite missing");
}

async function runSecurityChecks() {
  section("Security and Access Control Probes");
  await expect("security: unauth /auth/me denied", "GET", "/api/auth/me", { auth: false, expected: [401] });
  await expect("security: unauth items denied", "GET", "/api/items", { auth: false, expected: [401] });
  await expect("security: bad login denied", "POST", "/api/auth/login", {
    auth: false,
    expected: [401],
    json: { username, password: "wrong-password-for-audit" },
  });
  await expect("security: oversized JSON rejected", "POST", "/api/agents/conversation", {
    expected: [400, 413],
    json: { message: "x".repeat(1200) },
  });
  await expect("security: invalid voice parse schema rejected", "POST", "/api/voice/parse", {
    expected: [400],
    json: { transcript: "Coke Zero five", items: [{ id: 1, name: "Bad Item" }] },
  });
}

async function runFunctionalChecks() {
  section("Functional Route and API Regression Probes");
  const pages = [
    "/",
    "/inventory",
    "/warehouse",
    "/scan",
    "/voice-check",
    "/agents",
    "/reports",
    "/transfers",
    "/settings",
  ];
  for (const page of pages) {
    await expect(`page: ${page}`, "GET", page, { expected: [200] });
  }

  const reads = [
    ["/api/auth/me", "api: current user"],
    ["/api/locations", "api: locations"],
    ["/api/items", "api: store items"],
    ["/api/warehouse", "api: warehouse items"],
    ["/api/dashboard/summary", "api: dashboard summary"],
    ["/api/history", "api: history"],
    ["/api/agents/housekeeping", "api: agent housekeeping"],
    ["/api/ai/status", "api: ai status"],
    ["/api/ai/connectivity", "api: ai connectivity"],
  ];
  for (const [path, label] of reads) {
    await expect(label, "GET", path, { expected: [200, 304] });
  }

  const itemsResult = await expect("api: item context for voice parse", "GET", "/api/items", { expected: [200, 304] });
  const items = Array.isArray(itemsResult.body) ? itemsResult.body.slice(0, 20) : [];
  const voiceItems = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category ?? undefined,
    barcode: item.barcode ?? null,
    parLevel: item.parLevel ?? 0,
    minQuantity: item.minQuantity ?? undefined,
    maxQuantity: item.maxQuantity ?? undefined,
  }));
  if (voiceItems.length > 0) {
    await expect("ai: voice parse simple count", "POST", "/api/voice/parse", {
      expected: [200],
      json: { transcript: `${voiceItems[0].name} five`, items: voiceItems, mode: "custom" },
    });
  } else {
    record("ai: voice parse simple count", false, "no store items available for voice context");
  }

  await expect("ai: agent conversation", "POST", "/api/agents/conversation", {
    expected: [200],
    json: { message: "Give me a concise restock priority summary." },
    timeoutMs: 20000,
  });
}

async function runLoadChecks() {
  section("Bounded Load and Bandwidth Probes");
  const targets = [
    ["/api/healthz", "health"],
    ["/api/items", "items"],
    ["/api/warehouse", "warehouse"],
    ["/api/agents/housekeeping", "agents"],
  ];
  const tasks = Array.from({ length: loadRequests }, (_, index) => {
    const [path, label] = targets[index % targets.length];
    return { path, label: `load:${label}` };
  });
  const latencies = [];
  let failures = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const result = await request(task.label, "GET", task.path, { expected: [200, 304] });
      latencies.push(result.ms);
      if (!result.ok || ![200, 304].includes(result.res?.status ?? 0)) failures += 1;
    }
  }

  await Promise.all(Array.from({ length: loadConcurrency }, () => worker()));
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = Math.max(0, ...latencies);
  const ok = failures === 0 && p95 <= slowMs;
  record(
    "load: bounded concurrent read traffic",
    ok,
    `requests=${loadRequests}, concurrency=${loadConcurrency}, failures=${failures}, p50=${p50}ms, p95=${p95}ms, max=${max}ms`,
    { p50, p95, max, failures },
  );
}

async function runLocalRegressionSuites() {
  section("Local Regression Suites");
  if (!runRegression) {
    record("regression: skipped", true, "AUDIT_RUN_REGRESSION=false");
    return;
  }
  await command("regression: voice count", "corepack", ["pnpm", "run", "test:voice-count"]);
  await command("regression: warehouse voice add item", "corepack", ["pnpm", "run", "test:warehouse-voice-add-item"]);
  await command("regression: mobile scanner risks", "corepack", ["pnpm", "run", "test:mobile-scanner-risks"]);
}

async function runOptionalMutationWorkflow() {
  section("Optional Mutation Workflow");
  if (!runMutationWorkflow) {
    record("mutation workflow: skipped", true, "set AUDIT_RUN_MUTATION_WORKFLOW=true to run create/update/delete API workflow");
    return;
  }
  await command("mutation workflow: dev-workflow-test", "node", ["scripts/dev-workflow-test.mjs"], {
    env: { BASE_URL: baseUrl, DEV_ADMIN_USERNAME: username, INITIAL_ADMIN_PASSWORD: password },
    timeoutMs: 180000,
  });
}

async function runOptionalPreflight() {
  section("Optional Deploy Preflight");
  if (!runPreflight) {
    record("deploy preflight: skipped", true, "set AUDIT_RUN_PREFLIGHT=true to run deploy:preflight");
    return;
  }
  await command("deploy preflight", "corepack", ["pnpm", "run", "deploy:preflight"], {
    env: { DEPLOY_PREFLIGHT_MIN_ITEMS: process.env.DEPLOY_PREFLIGHT_MIN_ITEMS ?? "600" },
    timeoutMs: 180000,
  });
}

function printTimingSummary() {
  section("Timing Summary");
  const slow = timings.filter((timing) => timing.ms > slowMs).sort((a, b) => b.ms - a.ms).slice(0, 15);
  const all = timings.map((timing) => timing.ms);
  console.log(`requests observed: ${timings.length}`);
  console.log(`p50=${percentile(all, 50)}ms p95=${percentile(all, 95)}ms max=${Math.max(0, ...all)}ms slow-threshold=${slowMs}ms`);
  if (slow.length > 0) {
    console.log("slowest calls:");
    for (const timing of slow) {
      console.log(`- ${timing.method} ${timing.path} -> ${timing.status} ${timing.ms}ms (${timing.label})`);
    }
  }
}

function printFinalSummary() {
  section("Final Surgical Analysis");
  const failures = results.filter((result) => !result.ok);
  const slowResults = results.filter((result) => result.slow);
  console.log(`environment: ${baseUrl}`);
  console.log(`started: ${startedAt.toISOString()}`);
  console.log(`checks: ${results.length - failures.length}/${results.length} passed`);
  console.log(`failures: ${failures.length}`);
  console.log(`slow checks: ${slowResults.length}`);
  if (failures.length > 0) {
    console.log("");
    console.log("failed checks:");
    for (const failure of failures) {
      console.log(`- ${failure.name}: ${failure.detail}`);
    }
  }
  console.log("");
  console.log("recommended next read:");
  console.log("- Security failures: inspect API route auth middleware and cookie/proxy settings.");
  console.log("- Slow AI failures: inspect OpenAI latency, fallback path, and prompt/token size.");
  console.log("- Slow DB/list failures: inspect query plans, indexes, pagination, and account/location filters.");
  console.log("- Functional failures: run the named endpoint manually with curl and compare server logs by request time.");
  process.exit(failures.length === 0 ? 0 : 1);
}

section("KeepTally VPS Dev Surgical Audit");
console.log(`baseUrl=${baseUrl}`);
console.log(`loadRequests=${loadRequests}`);
console.log(`loadConcurrency=${loadConcurrency}`);
console.log(`slowMs=${slowMs}`);

if (password === "YOUR_DEV_ADMIN_PASSWORD") {
  console.error("");
  console.error("Refusing to run authenticated audit with the literal placeholder password.");
  console.error("Set DEV_ADMIN_PASSWORD to the real dev admin password, or use INITIAL_ADMIN_PASSWORD if this database still uses the bootstrap password.");
  console.error("");
  console.error("Example:");
  console.error("BASE_URL=http://127.0.0.1:3100 DEV_ADMIN_USERNAME=admin DEV_ADMIN_PASSWORD='real-password' corepack pnpm run audit:dev");
  process.exit(1);
}

await expect("bootstrap: web root", "GET", "/", { auth: false, expected: [200, 302] });
await expect("bootstrap: health", "GET", "/api/healthz", { auth: false, expected: [200, 302] });
await login();
await runSecurityChecks();
await runFunctionalChecks();
await runLoadChecks();
await runLocalRegressionSuites();
await runOptionalMutationWorkflow();
await runOptionalPreflight();
printTimingSummary();
printFinalSummary();
