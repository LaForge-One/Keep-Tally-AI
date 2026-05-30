import type { Request, Response, NextFunction } from "express";

const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) {
  console.error(
    "[auth] API_SECRET environment variable is not set. All protected routes will reject requests.",
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!API_SECRET) {
    res.status(503).json({ error: "Service not configured: missing API_SECRET" });
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token || token !== API_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
