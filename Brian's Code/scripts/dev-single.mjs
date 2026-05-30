import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apiEntry = path.join(root, "artifacts/api-server/src/index.ts");
const packageManager = "corepack";
const packageManagerArgs = ["pnpm"];

function runStep(label, command, args, options = {}) {
  console.log(`\n[dev] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runStep("Building web app", packageManager, [...packageManagerArgs, "run", "build:web"]);

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: process.env.PORT ?? "3000",
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://la-forge.fox@localhost:5432/keep_tally_brian_code",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD ?? "admin1234",
  SESSION_SECRET:
    process.env.SESSION_SECRET ??
    "local-development-session-secret-change-before-production",
  AI_INTEGRATIONS_OPENAI_BASE_URL:
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "http://localhost:9999",
  AI_INTEGRATIONS_OPENAI_API_KEY:
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dev-placeholder",
  WEB_DIST_DIR:
    process.env.WEB_DIST_DIR ??
    path.join(root, "artifacts/keep-tally/dist/public"),
};

console.log(`\n[dev] Starting single-server app at http://localhost:${env.PORT}`);
console.log("[dev] API health will be at /api/healthz");

const child = spawn("node", ["--import", "tsx", apiEntry], {
  cwd: root,
  stdio: "inherit",
  env,
});

function shutdown(signal) {
  child.kill(signal);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
