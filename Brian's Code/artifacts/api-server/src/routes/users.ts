import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  accountMembershipsTable,
  db,
  historyTable,
  locationsTable,
  PERMISSION_KEYS,
  rolePermissionsTable,
  userLocationAssignmentsTable,
  USER_ROLES,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth-helpers";
import { requireAccount, requireActiveMembership } from "../middleware/auth";

const router: IRouter = Router();

function getParam(req: { params: Record<string, string | string[] | undefined> }, key: string): string | null {
  const value = req.params[key];
  return typeof value === "string" ? value : null;
}

function parseParamId(req: { params: Record<string, string | string[] | undefined> }, key: string): number | null {
  const value = getParam(req, key);
  if (!value) return null;

  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

function requireAccountAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!req.account || !req.membership) { res.status(403).json({ error: "Account context required" }); return; }
  if (req.membership.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; }
  next();
}

async function validateAssignedLocations(
  accountId: number,
  locations: string[],
  allowedLocationIds: number[],
): Promise<{ ok: true; locations: string[]; locationIds: number[] } | { ok: false }> {
  const normalized = [...new Set(locations.map((location) => location.trim()).filter(Boolean))];
  if (normalized.length === 0) return { ok: true, locations: [], locationIds: [] };

  const rows = await db
    .select({ id: locationsTable.id, name: locationsTable.name })
    .from(locationsTable)
    .where(and(eq(locationsTable.accountId, accountId), eq(locationsTable.status, "active")));

  const locationByName = new Map(rows.map((row) => [row.name, row.id]));
  const locationIds = normalized.map((location) => locationByName.get(location));
  const allowedLocationIdSet = new Set(allowedLocationIds);

  return locationIds.every((locationId) => locationId !== undefined && allowedLocationIdSet.has(locationId))
    ? { ok: true, locations: normalized, locationIds: locationIds as number[] }
    : { ok: false };
}

async function syncAccountMembership(args: {
  accountId: number;
  userId: number;
  role: string;
  active: boolean;
}) {
  const [membership] = await db
    .select({ id: accountMembershipsTable.id })
    .from(accountMembershipsTable)
    .where(
      and(
        eq(accountMembershipsTable.accountId, args.accountId),
        eq(accountMembershipsTable.userId, args.userId),
      ),
    )
    .limit(1);

  if (membership) {
    await db
      .update(accountMembershipsTable)
      .set({ role: args.role, active: args.active, updatedAt: new Date() })
      .where(eq(accountMembershipsTable.id, membership.id));
    return;
  }

  await db.insert(accountMembershipsTable).values({
    accountId: args.accountId,
    userId: args.userId,
    role: args.role,
    active: args.active,
  });
}

async function syncUserLocationAssignments(accountId: number, userId: number, locationIds: number[]) {
  await db
    .delete(userLocationAssignmentsTable)
    .where(
      and(
        eq(userLocationAssignmentsTable.accountId, accountId),
        eq(userLocationAssignmentsTable.userId, userId),
      ),
    );

  if (locationIds.length === 0) return;

  await db.insert(userLocationAssignmentsTable).values(
    locationIds.map((locationId) => ({
      accountId,
      userId,
      locationId,
    })),
  );
}

async function auditUserSecurityChange(args: {
  actor: NonNullable<Request["authUser"]>;
  accountId: number;
  targetUsername: string;
  field: string;
  previousValue: string | null;
  newValue: string | null;
}) {
  await db.insert(historyTable).values({
    accountId: args.accountId,
    itemName: `User ${args.targetUsername}`,
    action: "user_security_updated",
    field: args.field,
    previousValue: args.previousValue,
    newValue: args.newValue,
    note: `${args.field} changed for user ${args.targetUsername}`,
    source: "user_management",
    performedBy: args.actor.displayName || args.actor.username,
    performedByRole: args.actor.role,
  });
}

function formatLocations(locations: string[]): string {
  return locations.length ? locations.join(", ") : "None";
}

router.use(requireAccount, requireActiveMembership, requireAccountAdmin);

router.get("/users", async (req, res) => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      role: usersTable.role,
      assignedLocations: usersTable.assignedLocations,
      active: usersTable.active,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.accountId, req.account!.id))
    .orderBy(usersTable.createdAt);

  res.json({ users });
});

router.post("/users", async (req, res) => {
  const schema = z.object({
    username: z.string().min(2).max(50).regex(/^[a-z0-9_.-]+$/i, "Username may only contain letters, numbers, _ . -"),
    displayName: z.string().min(1).max(80),
    password: z.string().min(6),
    role: z.enum(USER_ROLES),
    assignedLocations: z.array(z.string()).default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { username, displayName, password, role, assignedLocations } = parsed.data;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username.toLowerCase()))
    .limit(1);
  if (existing) { res.status(409).json({ error: "Username already taken" }); return; }

  const validatedLocations = await validateAssignedLocations(
    req.account!.id,
    assignedLocations,
    req.allowedLocationIds ?? [],
  );
  if (!validatedLocations.ok) { res.status(400).json({ error: "Invalid assigned location" }); return; }

  const passwordHash = await hashPassword(password);
  const [inserted] = await db.insert(usersTable).values({
    accountId: req.account!.id,
    username: username.toLowerCase(),
    displayName,
    passwordHash,
    role,
    assignedLocations: validatedLocations.locations,
    active: true,
    mustChangePassword: true,
  }).returning();

  await syncAccountMembership({
    accountId: req.account!.id,
    userId: inserted!.id,
    role: inserted!.role,
    active: inserted!.active,
  });
  await syncUserLocationAssignments(req.account!.id, inserted!.id, validatedLocations.locationIds);

  await auditUserSecurityChange({
    actor: req.authUser!,
    accountId: req.account!.id,
    targetUsername: inserted!.username,
    field: "role",
    previousValue: null,
    newValue: inserted!.role,
  });
  if (inserted!.assignedLocations.length > 0) {
    await auditUserSecurityChange({
      actor: req.authUser!,
      accountId: req.account!.id,
      targetUsername: inserted!.username,
      field: "assignedLocations",
      previousValue: null,
      newValue: formatLocations(inserted!.assignedLocations),
    });
  }

  res.status(201).json({
    user: {
      id: inserted!.id,
      username: inserted!.username,
      displayName: inserted!.displayName,
      role: inserted!.role,
      assignedLocations: inserted!.assignedLocations,
      active: inserted!.active,
      mustChangePassword: inserted!.mustChangePassword,
    },
  });
});

router.patch("/users/:id", async (req, res) => {
  const id = parseParamId(req, "id");
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const schema = z.object({
    displayName: z.string().min(1).max(80).optional(),
    role: z.enum(USER_ROLES).optional(),
    assignedLocations: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [before] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.accountId, req.account!.id)))
    .limit(1);
  if (!before) { res.status(404).json({ error: "User not found" }); return; }

  if (req.authUser?.id === id && parsed.data.role !== undefined && parsed.data.role !== before.role) {
    res.status(400).json({ error: "Cannot change your own role" });
    return;
  }
  if (req.authUser?.id === id && parsed.data.assignedLocations !== undefined) {
    res.status(400).json({ error: "Cannot change your own assigned locations" });
    return;
  }
  if (req.authUser?.id === id && parsed.data.active === false) {
    res.status(400).json({ error: "Cannot disable your own account" });
    return;
  }

  let locationIds: number[] | undefined;
  const updates = { ...parsed.data };
  if (updates.assignedLocations !== undefined) {
    const validatedLocations = await validateAssignedLocations(
      req.account!.id,
      updates.assignedLocations,
      req.allowedLocationIds ?? [],
    );
    if (!validatedLocations.ok) { res.status(400).json({ error: "Invalid assigned location" }); return; }
    updates.assignedLocations = validatedLocations.locations;
    locationIds = validatedLocations.locationIds;
  }

  const [updated] = await db.update(usersTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(usersTable.id, id), eq(usersTable.accountId, req.account!.id)))
    .returning();

  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  if (updates.role !== undefined || updates.active !== undefined) {
    await syncAccountMembership({
      accountId: req.account!.id,
      userId: updated.id,
      role: updated.role,
      active: updated.active,
    });
  }
  if (locationIds !== undefined) {
    await syncUserLocationAssignments(req.account!.id, updated.id, locationIds);
  }

  if (updates.role !== undefined && updates.role !== before.role) {
    await auditUserSecurityChange({
      actor: req.authUser!,
      accountId: req.account!.id,
      targetUsername: before.username,
      field: "role",
      previousValue: before.role,
      newValue: updates.role,
    });
  }
  if (
    updates.assignedLocations !== undefined &&
    formatLocations(updates.assignedLocations) !== formatLocations(before.assignedLocations)
  ) {
    await auditUserSecurityChange({
      actor: req.authUser!,
      accountId: req.account!.id,
      targetUsername: before.username,
      field: "assignedLocations",
      previousValue: formatLocations(before.assignedLocations),
      newValue: formatLocations(updates.assignedLocations),
    });
  }

  res.json({ user: updated });
});

router.post("/users/:id/reset-password", async (req, res) => {
  const id = parseParamId(req, "id");
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const schema = z.object({ newPassword: z.string().min(6) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Password must be at least 6 characters" }); return; }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const [updated] = await db.update(usersTable)
    .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
    .where(and(eq(usersTable.id, id), eq(usersTable.accountId, req.account!.id)))
    .returning({ id: usersTable.id });

  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ok: true });
});

router.delete("/users/:id", async (req, res) => {
  const id = parseParamId(req, "id");
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  if (req.authUser?.id === id) { res.status(400).json({ error: "Cannot delete your own account" }); return; }

  const [deleted] = await db
    .delete(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.accountId, req.account!.id)))
    .returning({ id: usersTable.id });
  if (!deleted) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ok: true });
});

router.get("/permissions", async (req, res) => {
  const rows = await db
    .select()
    .from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.accountId, req.account!.id));

  const result: Record<string, Record<string, boolean>> = {};
  for (const role of USER_ROLES) {
    result[role] = {};
    for (const key of PERMISSION_KEYS) {
      result[role]![key] = false;
    }
  }
  for (const row of rows) {
    if (result[row.role]) {
      result[row.role]![row.permissionKey] = row.enabled;
    }
  }

  res.json({ permissions: result, permissionKeys: PERMISSION_KEYS });
});

router.patch("/permissions/:role/:key", async (req, res) => {
  const role = getParam(req, "role");
  const key = getParam(req, "key");
  if (!role || !key) { res.status(400).json({ error: "Invalid permission route" }); return; }
  if (!(USER_ROLES as readonly string[]).includes(role)) { res.status(400).json({ error: "Invalid role" }); return; }
  if (!(PERMISSION_KEYS as readonly string[]).includes(key)) { res.status(400).json({ error: "Invalid permission key" }); return; }

  if (role === "admin") { res.status(400).json({ error: "Admin permissions cannot be changed" }); return; }

  const schema = z.object({ enabled: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "enabled (boolean) required" }); return; }

  const existing = await db.select({ id: rolePermissionsTable.id, enabled: rolePermissionsTable.enabled })
    .from(rolePermissionsTable)
    .where(
      and(
        eq(rolePermissionsTable.accountId, req.account!.id),
        eq(rolePermissionsTable.role, role),
        eq(rolePermissionsTable.permissionKey, key),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db.update(rolePermissionsTable)
      .set({ enabled: parsed.data.enabled, updatedAt: new Date() })
      .where(eq(rolePermissionsTable.id, existing[0]!.id));
  } else {
    await db.insert(rolePermissionsTable).values({
      accountId: req.account!.id,
      role,
      permissionKey: key,
      enabled: parsed.data.enabled,
    });
  }

  const previousValue = existing[0]?.enabled ?? false;
  if (previousValue !== parsed.data.enabled) {
    await auditUserSecurityChange({
      actor: req.authUser!,
      accountId: req.account!.id,
      targetUsername: `role:${role}`,
      field: `permission:${key}`,
      previousValue: String(previousValue),
      newValue: String(parsed.data.enabled),
    });
  }

  res.json({ ok: true });
});

export default router;
