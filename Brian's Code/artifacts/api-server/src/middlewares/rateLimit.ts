import type { Request, Response, NextFunction } from "express";

interface WindowEntry {
  count: number;
  resetAt: number;
}

function getClientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress ?? "unknown";
  return ip;
}

function createRateLimit(windowMs: number, maxRequests: number, storeKey: string) {
  const store = new Map<string, WindowEntry>();
  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = storeKey + ":" + getClientKey(req);
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, maxRequests - entry.count);
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
    if (entry.count > maxRequests) {
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
      return;
    }
    next();
  };
}

export const commandRateLimit = createRateLimit(60000, 20, "cmd");
export const voiceRateLimit = createRateLimit(60000, 60, "voice");
export const loginRateLimit = createRateLimit(300000, 10, "login");
