import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const username = process.env.DEV_ADMIN_USERNAME ?? "admin";
const password = process.env.INITIAL_ADMIN_PASSWORD ?? "admin1234";
process.env.DATABASE_URL ??=
  "postgresql://la-forge.fox@localhost:5432/keep_tally_brian_code";

if (password.length < 6) {
  throw new Error("INITIAL_ADMIN_PASSWORD must be at least 6 characters.");
}

const passwordHash = await bcrypt.hash(password, 12);
const { db, pool, usersTable } = await import("@workspace/db");
try {
  const [updated] = await db
    .update(usersTable)
    .set({
      passwordHash,
      active: true,
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.username, username))
    .returning({ id: usersTable.id, username: usersTable.username });

  if (!updated) {
    console.error(`No user found for username "${username}".`);
    process.exitCode = 1;
  } else {
    console.log(`Reset local admin password for ${updated.username}.`);
    console.log(`Login: ${updated.username} / ${password}`);
  }
} finally {
  await pool.end();
}
