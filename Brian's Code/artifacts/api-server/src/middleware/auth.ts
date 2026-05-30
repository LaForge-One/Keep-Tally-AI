import type { Request, Response, NextFunction } from "express";
import { verifyToken, getPermissionsForRole } from "../lib/auth-helpers";
import {
  accountMembershipsTable,
  accountsTable,
  db,
  locationsTable,
  userLocationAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { AccountMembershipRow, AccountRow, PermissionKey, UserRole } from "@workspace/db";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  assignedLocations: string[];
  permissions: Set<PermissionKey>;
};

// Extend Express Request to carry the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      account?: AccountRow;
      membership?: AccountMembershipRow;
      permissions?: Set<PermissionKey>;
      allowedLocationIds?: number[];
    }
  }
}

function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.["kt_token"];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) { next(); return; }

  const payload = verifyToken(token);
  if (!payload) { next(); return; }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.sub))
    .limit(1);

  if (!user || !user.active) { next(); return; }

  const permissions = await getPermissionsForRole(user.role as Parameters<typeof getPermissionsForRole>[0]);

  req.authUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    assignedLocations: user.assignedLocations,
    permissions,
  };

  next();
}

async function getActiveMembership(userId: number, accountId?: number | null) {
  if (accountId) {
    const [membership] = await db
      .select()
      .from(accountMembershipsTable)
      .where(
        and(
          eq(accountMembershipsTable.userId, userId),
          eq(accountMembershipsTable.accountId, accountId),
          eq(accountMembershipsTable.active, true),
        ),
      )
      .limit(1);
    return membership;
  }

  const [membership] = await db
    .select()
    .from(accountMembershipsTable)
    .where(and(eq(accountMembershipsTable.userId, userId), eq(accountMembershipsTable.active, true)))
    .limit(1);
  return membership;
}

async function getAllowedLocationIds(req: Request, accountId: number): Promise<number[]> {
  const user = req.authUser;
  if (!user) return [];

  if (user.role === "admin" || req.permissions?.has("view_all_locations")) {
    const rows = await db
      .select({ id: locationsTable.id })
      .from(locationsTable)
      .where(and(eq(locationsTable.accountId, accountId), eq(locationsTable.status, "active")));
    return rows.map((row) => row.id);
  }

  const rows = await db
    .select({ locationId: userLocationAssignmentsTable.locationId })
    .from(userLocationAssignmentsTable)
    .where(
      and(
        eq(userLocationAssignmentsTable.accountId, accountId),
        eq(userLocationAssignmentsTable.userId, user.id),
      ),
    );
  return rows.map((row) => row.locationId);
}

export async function loadAccountContext(req: Request, _res: Response, next: NextFunction) {
  if (!req.authUser) {
    next();
    return;
  }

  const [user] = await db
    .select({ accountId: usersTable.accountId })
    .from(usersTable)
    .where(eq(usersTable.id, req.authUser.id))
    .limit(1);

  const membership = await getActiveMembership(req.authUser.id, user?.accountId);
  if (!membership) {
    req.permissions = req.authUser.permissions;
    req.allowedLocationIds = [];
    next();
    return;
  }

  const [account] = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, membership.accountId), eq(accountsTable.active, true)))
    .limit(1);

  if (!account) {
    req.permissions = req.authUser.permissions;
    req.allowedLocationIds = [];
    next();
    return;
  }

  const permissions = await getPermissionsForRole(membership.role as UserRole, account.id);

  req.account = account;
  req.membership = membership;
  req.permissions = permissions;
  req.allowedLocationIds = await getAllowedLocationIds(req, account.id);

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
  if (req.authUser.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; }
  next();
}

export function requirePermission(key: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
    const permissions = req.permissions ?? req.authUser.permissions;
    if (!permissions.has(key)) {
      res.status(403).json({ error: `Permission denied: ${key}` });
      return;
    }
    next();
  };
}

export function requireAccount(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!req.account) { res.status(403).json({ error: "Account context required" }); return; }
  next();
}

export function requireActiveMembership(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!req.membership || !req.membership.active) {
    res.status(403).json({ error: "Active account membership required" });
    return;
  }
  next();
}

export function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!req.account) { res.status(403).json({ error: "Account context required" }); return; }
  if (!req.account.active || req.account.status !== "active") {
    res.status(402).json({ error: "Active subscription required" });
    return;
  }
  next();
}

export function canAccessLocation(req: Request, location: string): boolean {
  const user = req.authUser;
  if (!user) return false;
  const permissions = req.permissions ?? user.permissions;
  if (user.role === "admin" || permissions.has("view_all_locations")) return true;
  return user.assignedLocations.includes(location);
}

export function canViewAllLocations(req: Request): boolean {
  const user = req.authUser;
  const permissions = req.permissions ?? user?.permissions;
  return Boolean(user && (user.role === "admin" || permissions?.has("view_all_locations")));
}

export function assertLocationAccess(
  req: Request,
  res: Response,
  location: string,
  message = "Permission denied for this location",
): boolean {
  if (canAccessLocation(req, location)) return true;
  res.status(403).json({ error: message });
  return false;
}
