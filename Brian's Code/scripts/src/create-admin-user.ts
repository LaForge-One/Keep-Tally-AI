import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

const username = (process.env.DEV_ADMIN_USERNAME ?? "admin").trim().toLowerCase();
const displayName = process.env.DEV_ADMIN_DISPLAY_NAME ?? "Admin";
const password = process.env.INITIAL_ADMIN_PASSWORD ?? "admin1234";
const accountSlug = process.env.DEV_ACCOUNT_SLUG ?? "default";
const accountName = process.env.DEV_ACCOUNT_NAME ?? "Default Account";

process.env.DATABASE_URL ??=
  "postgresql://la-forge.fox@localhost:5432/keep_tally_brian_code";

if (!username) {
  throw new Error("DEV_ADMIN_USERNAME cannot be empty.");
}

if (password.length < 6) {
  throw new Error("INITIAL_ADMIN_PASSWORD must be at least 6 characters.");
}

const {
  accountMembershipsTable,
  accountsTable,
  db,
  pool,
  seedAccountRolePermissions,
  usersTable,
} = await import("@workspace/db");

async function ensureDefaultAccount() {
  const [existing] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.slug, accountSlug))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(accountsTable)
    .values({
      name: accountName,
      slug: accountSlug,
      status: "active",
      plan: "legacy",
      active: true,
    })
    .returning();

  if (!created) {
    throw new Error(`Failed to create account "${accountSlug}".`);
  }

  return created;
}

try {
  const account = await ensureDefaultAccount();
  const seededPermissions = await seedAccountRolePermissions(account.id);
  const passwordHash = await bcrypt.hash(password, 12);

  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  const [user] = existingUser
    ? await db
        .update(usersTable)
        .set({
          accountId: account.id,
          displayName,
          passwordHash,
          role: "admin",
          assignedLocations: [],
          active: true,
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existingUser.id))
        .returning({ id: usersTable.id, username: usersTable.username })
    : await db
        .insert(usersTable)
        .values({
          accountId: account.id,
          username,
          displayName,
          passwordHash,
          role: "admin",
          assignedLocations: [],
          active: true,
          mustChangePassword: false,
        })
        .returning({ id: usersTable.id, username: usersTable.username });

  if (!user) {
    throw new Error(`Failed to upsert admin user "${username}".`);
  }

  const [membership] = await db
    .select({ id: accountMembershipsTable.id })
    .from(accountMembershipsTable)
    .where(
      and(
        eq(accountMembershipsTable.accountId, account.id),
        eq(accountMembershipsTable.userId, user.id),
      ),
    )
    .limit(1);

  if (membership) {
    await db
      .update(accountMembershipsTable)
      .set({ role: "admin", active: true, updatedAt: new Date() })
      .where(eq(accountMembershipsTable.id, membership.id));
  } else {
    await db.insert(accountMembershipsTable).values({
      accountId: account.id,
      userId: user.id,
      role: "admin",
      active: true,
    });
  }

  console.log(`Admin user ready: ${user.username}`);
  console.log(`Account: ${account.slug} (${account.id})`);
  console.log(`Seeded missing role permissions: ${seededPermissions}`);
  console.log(`Login: ${user.username} / ${password}`);
} finally {
  await pool.end();
}
