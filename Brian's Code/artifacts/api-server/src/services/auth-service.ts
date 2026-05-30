import { db, usersTable, type PermissionKey, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  comparePassword,
  getPermissionsForRole,
  hashPassword,
} from "../lib/auth-helpers";

type AuthenticatedUser = typeof usersTable.$inferSelect & {
  permissions: Set<PermissionKey>;
};

export async function authenticateUser(
  username: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const normalizedUsername = username.toLowerCase().trim();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, normalizedUsername))
    .limit(1);

  if (!user?.active) return null;

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) return null;

  const permissions = await getPermissionsForRole(
    user.role as UserRole,
    user.accountId ?? undefined,
  );

  return { ...user, permissions };
}

export async function changeUserPassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<"ok" | "not_found" | "invalid_current_password"> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return "not_found";

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) return "invalid_current_password";

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  return "ok";
}
