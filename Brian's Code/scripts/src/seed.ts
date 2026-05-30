import {
  accountsTable,
  db,
  historyTable,
  itemsTable,
  locationsTable,
  seedAccountRolePermissions,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "location";
}

async function ensureDefaultAccount() {
  const [existing] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.slug, "default"))
    .limit(1);
  if (existing) {
    await seedAccountRolePermissions(existing.id);
    return existing;
  }

  const [created] = await db
    .insert(accountsTable)
    .values({ name: "Default Account", slug: "default", status: "active", plan: "legacy", active: true })
    .returning();
  if (!created) throw new Error("Failed to create default account");
  await seedAccountRolePermissions(created.id);
  return created;
}

async function ensureLocation(accountId: number, name: string) {
  const [existing] = await db
    .select()
    .from(locationsTable)
    .where(and(eq(locationsTable.accountId, accountId), eq(locationsTable.name, name)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(locationsTable)
    .values({ accountId, name, slug: slugify(name), status: "active" })
    .returning();
  if (!created) throw new Error(`Failed to create location: ${name}`);
  return created;
}

async function main() {
  const account = await ensureDefaultAccount();
  const existing = await db.select().from(itemsTable).where(eq(itemsTable.accountId, account.id));
  if (existing.length > 0) {
    console.log(`Skipping seed: ${existing.length} items already present.`);
    process.exit(0);
  }

  const items = [
    { name: "Coke Zero 12oz", category: "Beverages", quantity: 18, parLevel: 24, location: "Mesa Warehouse" },
    { name: "Diet Coke 12oz", category: "Beverages", quantity: 30, parLevel: 24, location: "Mesa Warehouse" },
    { name: "Sprite 20oz", category: "Beverages", quantity: 6, parLevel: 12, location: "Tempe Hub" },
    { name: "Bottled Water 16oz", category: "Beverages", quantity: 48, parLevel: 36, location: "Mesa Warehouse" },
    { name: "Snickers Bar", category: "Candy", quantity: 22, parLevel: 30, location: "Route 3" },
    { name: "Twix Bar", category: "Candy", quantity: 14, parLevel: 24, location: "Route 3" },
    { name: "M&M Peanut", category: "Candy", quantity: 9, parLevel: 18, location: "Route 7" },
    { name: "Doritos Nacho Cheese", category: "Chips", quantity: 12, parLevel: 24, location: "Route 3" },
    { name: "Lay's Classic", category: "Chips", quantity: 0, parLevel: 18, location: "Tempe Hub" },
    { name: "Cheetos Crunchy", category: "Chips", quantity: 27, parLevel: 24, location: "Route 7" },
    { name: "Clif Bar Chocolate Chip", category: "Snacks", quantity: 15, parLevel: 20, location: "Mesa Warehouse" },
    { name: "Pop-Tarts Strawberry", category: "Snacks", quantity: 8, parLevel: 12, location: "Route 7" },
  ];

  const locations = new Map<string, Awaited<ReturnType<typeof ensureLocation>>>();
  for (const name of [...new Set(items.map((item) => item.location))]) {
    locations.set(name, await ensureLocation(account.id, name));
  }

  const inserted = await db.insert(itemsTable).values(
    items.map((item) => ({
      ...item,
      accountId: account.id,
      locationId: locations.get(item.location)!.id,
    })),
  ).returning();
  console.log(`Seeded ${inserted.length} items.`);

  await db.insert(historyTable).values(
    inserted.map((item) => ({
      accountId: account.id,
      locationId: item.locationId,
      itemId: item.id,
      itemName: item.name,
      action: "create",
      field: null,
      previousValue: null,
      newValue: `${item.quantity} @ ${item.location}`,
      note: "Initial seed",
      source: "ui",
      location: item.location,
    })),
  );
  console.log(`Seeded ${inserted.length} history entries.`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
