import { Router } from "express";
import { z } from "zod";
import { signToken } from "../lib/auth-helpers";
import { authenticateUser, changeUserPassword } from "../services/auth-service";
import { requireAuth } from "../middleware/auth";

const router = Router();
const COOKIE_NAME = "kt_token";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/* ── POST /auth/login ── */
router.post("/auth/login", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Username and password required" }); return; }

  const { username, password } = parsed.data;
  const user = await authenticateUser(username, password);
  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = signToken(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

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
router.post("/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
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
    newPassword: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const result = await changeUserPassword(
    req.authUser!.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (result === "not_found") { res.status(404).json({ error: "User not found" }); return; }
  if (result === "invalid_current_password") { res.status(401).json({ error: "Current password is incorrect" }); return; }

  res.json({ ok: true });
});

export default router;
