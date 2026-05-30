import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { loadAccountContext, loadUser } from "./middleware/auth";
import { seedDefaultData } from "./lib/auth-helpers";
import { errorBody, getErrorMessage } from "./lib/http-errors";

const app: Express = express();

const ALLOWED_ORIGINS: string[] = [];

if (process.env.REPLIT_DEV_DOMAIN) {
  ALLOWED_ORIGINS.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
}
if (process.env.REPLIT_DEPLOYMENT_DOMAIN) {
  ALLOWED_ORIGINS.push(`https://${process.env.REPLIT_DEPLOYMENT_DOMAIN}`);
}
if (process.env.CORS_ORIGIN) {
  ALLOWED_ORIGINS.push(...process.env.CORS_ORIGIN.split(",").map((o) => o.trim()));
}

// Allow any Replit-hosted origin (covers all deployment domains automatically)
const REPLIT_ORIGIN_RE = /^https:\/\/[\w-]+(\.[\w-]+)*\.(replit\.app|repl\.co|replit\.dev)$/;

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (REPLIT_ORIGIN_RE.test(origin)) return true;
  return false;
}

function resolveWebDistDir(): string | null {
  const candidates = [
    process.env.WEB_DIST_DIR,
    path.resolve(process.cwd(), "artifacts/keep-tally/dist/public"),
    path.resolve(process.cwd(), "../keep-tally/dist/public"),
    path.resolve(process.cwd(), "dist/public"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }

  return null;
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" is not allowed`));
      }
    },
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load authenticated user on every request
app.use(loadUser);
app.use(loadAccountContext);

app.use("/api", router);

const webDistDir = resolveWebDistDir();
if (webDistDir) {
  logger.info({ webDistDir }, "Serving web app from API server");
  app.use(express.static(webDistDir, { index: false }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") {
      next();
      return;
    }

    if (req.path.startsWith("/api")) {
      next();
      return;
    }

    if (!req.accepts("html")) {
      next();
      return;
    }

    res.sendFile(path.join(webDistDir, "index.html"));
  });
} else {
  logger.warn(
    "Web build not found; API-only mode. Run the web build or set WEB_DIST_DIR to serve the frontend.",
  );
}

// Seed default data (admin user + role permissions) on startup
seedDefaultData().catch((err) => {
  logger.error({ err }, "Failed to seed default data");
  if (process.env.NODE_ENV === "production") {
    throw err;
  }
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = typeof req.id === "string" ? req.id : undefined;

  if (err.message.startsWith("CORS:")) {
    logger.warn({ err, requestId, origin: req.headers.origin }, "Blocked CORS request");
    res.status(403).json(errorBody("Forbidden: cross-origin request not allowed", requestId));
    return;
  }

  logger.error({ err, requestId }, "Unhandled API error");
  res.status(500).json(
    errorBody(
      process.env.NODE_ENV === "production" ? "Internal server error" : getErrorMessage(err),
      requestId,
    ),
  );
});

export default app;
