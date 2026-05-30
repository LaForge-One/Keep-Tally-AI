const port = process.env.PORT ?? "3000";
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

async function check(name, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const ms = Date.now() - started;
    console.log(`${name}: ${res.status} ${res.statusText} (${ms}ms)`);
    return res.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${name}: failed (${message})`);
    return false;
  }
}

const checks = await Promise.all([
  check("web", baseUrl),
  check("api", `${baseUrl}/api/healthz`),
]);

process.exit(checks.every(Boolean) ? 0 : 1);
