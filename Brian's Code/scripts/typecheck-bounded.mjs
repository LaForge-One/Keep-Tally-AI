import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 180_000;

const checks = [
  ["scripts", ["--filter", "@workspace/scripts", "run", "typecheck"], 90_000],
  ["api-server", ["--filter", "@workspace/api-server", "run", "typecheck"], DEFAULT_TIMEOUT_MS],
  ["keep-tally-web", ["--filter", "@workspace/keep-tally", "run", "typecheck"], DEFAULT_TIMEOUT_MS],
];

function selectedChecks() {
  const wanted = process.argv.slice(2).filter((arg) => arg !== "--");
  if (wanted.length === 0) return checks;
  const selected = checks.filter(([name]) => wanted.includes(name));
  const known = new Set(checks.map(([name]) => name));
  const unknown = wanted.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    console.error(`Unknown typecheck target(s): ${unknown.join(", ")}`);
    console.error(`Known targets: ${checks.map(([name]) => name).join(", ")}`);
    process.exit(2);
  }
  return selected;
}

function runCheck(name, args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("corepack", ["pnpm", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, Number(process.env.TYPECHECK_TIMEOUT_MS ?? timeoutMs));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const elapsed = Date.now() - started;
      resolve({ name, code, signal, elapsed, stdout, stderr, timedOut });
    });
  });
}

let failed = false;

for (const [name, args, timeoutMs] of selectedChecks()) {
  console.log(`\n[typecheck] ${name}...`);
  const result = await runCheck(name, args, timeoutMs);
  const status = result.signal ? `signal ${result.signal}` : `exit ${result.code}`;
  console.log(`[typecheck] ${name}: ${status} in ${result.elapsed}ms`);
  if (result.timedOut) console.error(`[typecheck] ${name}: timed out`);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (result.code !== 0 || result.signal || result.timedOut) failed = true;
}

process.exit(failed ? 1 : 0);
