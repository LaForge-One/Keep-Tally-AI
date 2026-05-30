import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
const commandRequiresDatabase = process.argv.some((arg) =>
  ["migrate", "push", "push-force", "studio"].includes(arg),
);

if (!databaseUrl && commandRequiresDatabase) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl ?? "postgresql://user:password@localhost:5432/keeptally",
  },
});
