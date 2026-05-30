import { drizzle } from "drizzle-orm/node-postgres";
import { eq, isNull } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

type PermissionSeedRow = {
  accountId: number;
  role: string;
  permissionKey: string;
  enabled: boolean;
};

function permissionMatrixDefaults(): PermissionSeedRow[] {
  const rows: PermissionSeedRow[] = [];
  for (const role of schema.USER_ROLES) {
    const enabledKeys = schema.DEFAULT_PERMISSIONS[role] ?? [];
    for (const permissionKey of schema.PERMISSION_KEYS) {
      rows.push({
        accountId: 0,
        role,
        permissionKey,
        enabled: enabledKeys.includes(permissionKey),
      });
    }
  }
  return rows;
}

export async function seedAccountRolePermissions(accountId: number): Promise<number> {
  const existingRows = await db
    .select({
      role: schema.rolePermissionsTable.role,
      permissionKey: schema.rolePermissionsTable.permissionKey,
    })
    .from(schema.rolePermissionsTable)
    .where(eq(schema.rolePermissionsTable.accountId, accountId));

  const existingKeys = new Set(
    existingRows.map((row) => `${row.role}:${row.permissionKey}`),
  );

  const globalRows = await db
    .select({
      id: schema.rolePermissionsTable.id,
      role: schema.rolePermissionsTable.role,
      permissionKey: schema.rolePermissionsTable.permissionKey,
      enabled: schema.rolePermissionsTable.enabled,
    })
    .from(schema.rolePermissionsTable)
    .where(isNull(schema.rolePermissionsTable.accountId));

  const globalEnabledByKey = new Map<string, { id: number; enabled: boolean }>();
  for (const row of globalRows) {
    const key = `${row.role}:${row.permissionKey}`;
    const current = globalEnabledByKey.get(key);
    if (current === undefined || row.id > current.id) {
      globalEnabledByKey.set(key, { id: row.id, enabled: row.enabled });
    }
  }

  const rows = permissionMatrixDefaults()
    .map((row) => {
      const key = `${row.role}:${row.permissionKey}`;
      return {
        ...row,
        accountId,
        enabled: globalEnabledByKey.get(key)?.enabled ?? row.enabled,
      };
    })
    .filter((row) => !existingKeys.has(`${row.role}:${row.permissionKey}`));

  if (rows.length === 0) return 0;

  await db.insert(schema.rolePermissionsTable).values(rows);
  return rows.length;
}

export * from "./schema";
