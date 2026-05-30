const port = process.env.PORT ?? "3000";
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const username = process.env.DEV_ADMIN_USERNAME ?? "admin";
const password = process.env.INITIAL_ADMIN_PASSWORD ?? "admin1234";

async function request(name, url, init) {
  const started = Date.now();
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5000),
  });
  console.log(`${name}: ${res.status} ${res.statusText} (${Date.now() - started}ms)`);
  return res;
}

try {
  const web = await request("web", baseUrl);
  if (!web.ok) throw new Error("frontend did not return OK");

  const health = await request("api health", `${baseUrl}/api/healthz`);
  if (!health.ok) throw new Error("API health did not return OK");

  const aiStatus = await request("ai status", `${baseUrl}/api/ai/status`);
  if (!aiStatus.ok) throw new Error("AI status did not return OK");

  const login = await request("login", `${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) {
    const detail = await login.text().catch(() => "");
    throw new Error(`login failed: ${detail || login.statusText}`);
  }

  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login did not set an auth cookie");

  const me = await request("auth me", `${baseUrl}/api/auth/me`, {
    headers: { cookie },
  });
  if (!me.ok) throw new Error("authenticated /auth/me did not return OK");

  const locations = await request("locations", `${baseUrl}/api/locations`, {
    headers: { cookie },
  });
  if (!locations.ok) throw new Error("authenticated /locations did not return OK");

  const body = await me.json();
  console.log(`authenticated user: ${body.user?.username ?? "unknown"}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
