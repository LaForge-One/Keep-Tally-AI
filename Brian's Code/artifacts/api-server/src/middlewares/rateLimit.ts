import type { Request, Response, NextFunction } from "express";

interface WindowEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, WindowEntry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

function getClientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.socket.remoteAddress ?? "unknown";
  return ip;
}

export function commandRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = getClientKey(req);
  const now = Date.now();

  let entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }

  entry.count += 1;

  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

  res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > MAX_REQUESTS) {
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      error: "Too many requests. Please slow down and try again shortly.",
    });
    return;
  }

  next();
}
