import {
  Router,
  type CookieOptions,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { signToken } from "../lib/auth-helpers";
import { authenticateUser, changeUserPassword } from "../services/auth-service";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();
const COOKIE_NAME = "kt_token";

function shouldUseSecureCookies(req: Request): boolean {
  const mode = process.env.AUTH_COOKIE_SECURE ?? "auto";
  if (mode === "true") return true;
  if (mode === "false") return false;
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function cookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: shouldUseSecureCookies(req),
    path: "/",
  };
}

export function requirePasswordNotExpired(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = req.authUser;
  if (!user) {
    next();
    return;
  }
  if (
    (user as unknown as { mustChangePassword?: boolean }).mustChangePassword ===
    true
  ) {
    res.status(403).json({
      error: "Password change required before continuing",
      code: "MUST_CHANGE_PASSWORD",
    });
    return;
  }
  next();
}

/* ── POST /auth/login ── */
router.post("/auth/login", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const { username, password } = parsed.data;
  const user = await authenticateUser(username, password);
  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = signToken(user.id);
  res.cookie(COOKIE_NAME, token, cookieOptions(req));

  res.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      assignedLocations: user.assignedLocations,
      mustChangePassword: user.mustChangePassword,
      permissions: Array.from(user.permissions),
    },
  });
});

/* ── POST /auth/logout ── */
router.post("/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(req),
    path: "/",
  });
  res.json({ ok: true });
});

/* ── GET /auth/me ── */
router.get("/auth/me", requireAuth, async (req, res) => {
  const u = req.authUser!;
  res.json({
    user: {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      assignedLocations: u.assignedLocations,
      permissions: Array.from(u.permissions),
    },
  });
});

/* ── POST /auth/change-password ── */
router.post("/auth/change-password", requireAuth, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(10, "New password must be at least 10 characters"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const result = await changeUserPassword(
    req.authUser!.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (result === "not_found") {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (result === "invalid_current_password") {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  res.json({ ok: true });
});

export default router;
