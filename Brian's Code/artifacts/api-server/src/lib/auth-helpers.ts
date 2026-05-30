import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import {
  db,
  accountsTable,
  accountMembershipsTable,
  usersTable,
  rolePermissionsTable,
  PERMISSION_KEYS,
  DEFAULT_PERMISSIONS,
  seedAccountRolePermissions,
  type UserRole,
  type PermissionKey,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET;
const JWT_EXPIRES = "7d";
const ACTIVE_JWT_SECRET = JWT_SECRET ?? randomBytes(32).toString("base64url");

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production");
  }
  console.warn("[auth] SESSION_SECRET is not set; using an unsafe development-only secret");
}

function jwtSecret(): string {
  return ACTIVE_JWT_SECRET;
}

/* ── JWT ─────────────────────────────────────────────────── */

export function signToken(userId: number): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): { sub: number } | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (typeof payload !== "object" || payload === null) {
      return null;
    }

    const subject = (payload as { sub?: unknown }).sub;
    const sub =
      typeof subject === "number"
        ? subject
        : typeof subject === "string"
          ? Number.parseInt(subject, 10)
          : NaN;

    if (!Number.isInteger(sub)) {
      return null;
    }

    return { sub };
  } catch {
    return null;
  }
}

/* ── Password ────────────────────────────────────────────── */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* ── Permission loader ───────────────────────────────────── */

function normalizePermissionKeys(rows: Array<{ enabled: boolean; permissionKey: string }>): Set<PermissionKey> {
  return new Set(
    rows
      .filter((r) => r.enabled)
      .map((r) => r.permissionKey as PermissionKey)
      .filter((k) => (PERMISSION_KEYS as readonly string[]).includes(k)),
  );
}

export async function getPermissionsForRole(role: UserRole, accountId?: number): Promise<Set<PermissionKey>> {
  if (accountId !== undefined) {
    const accountRows = await db
      .select()
      .from(rolePermissionsTable)
      .where(and(eq(rolePermissionsTable.accountId, accountId), eq(rolePermissionsTable.role, role)));

    if (accountRows.length > 0) {
      return normalizePermissionKeys(accountRows);
    }
  }

  const rows = await db
    .select()
    .from(rolePermissionsTable)
    .where(and(isNull(rolePermissionsTable.accountId), eq(rolePermissionsTable.role, role)));

  if (rows.length === 0) {
    // Fall back to defaults (role_permissions table not yet seeded for this role)
    return new Set(DEFAULT_PERMISSIONS[role] ?? []);
  }

  return normalizePermissionKeys(rows);
}

/* ── Seed default admin user and role permissions ────────── */

export async function seedDefaultData() {
  let [defaultAccount] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.slug, "default"))
    .limit(1);

  if (!defaultAccount) {
    [defaultAccount] = await db
      .insert(accountsTable)
      .values({
        name: "Default Account",
        slug: "default",
        status: "active",
        plan: "legacy",
        active: true,
      })
      .returning();
  }
  if (!defaultAccount) {
    throw new Error("Failed to initialize default account");
  }
  const seededPermissions = await seedAccountRolePermissions(defaultAccount.id);
  if (seededPermissions > 0) {
    console.log(`[auth] Seeded ${seededPermissions} default account role permissions`);
  }

  // Seed default admin user if no users exist
  const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existing.length === 0) {
    const bootstrapPassword = process.env.INITIAL_ADMIN_PASSWORD;
    if (!bootstrapPassword) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("INITIAL_ADMIN_PASSWORD is required to bootstrap the first admin user");
      }
      console.warn("[auth] INITIAL_ADMIN_PASSWORD is not set; generating a development-only admin password");
    }

    const generatedPassword = bootstrapPassword ?? randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(generatedPassword);
    await db.insert(usersTable).values({
      username: "admin",
      displayName: "Admin",
      passwordHash,
      role: "admin",
      accountId: defaultAccount.id,
      assignedLocations: [],
      active: true,
      mustChangePassword: true,
    });
    console.log("[auth] Created default admin user (username: admin)");
    if (!bootstrapPassword) {
      console.log(`[auth] Development admin password: ${generatedPassword}`);
    }
  }

  const users = await db.select().from(usersTable);
  for (const user of users) {
    if (!user.accountId) continue;
    const [membership] = await db
      .select({ id: accountMembershipsTable.id })
      .from(accountMembershipsTable)
      .where(
        and(
          eq(accountMembershipsTable.accountId, user.accountId),
          eq(accountMembershipsTable.userId, user.id),
        ),
      )
      .limit(1);

    if (!membership) {
      await db.insert(accountMembershipsTable).values({
        accountId: user.accountId,
        userId: user.id,
        role: user.role,
        active: user.active,
      });
    }
  }
}
