import {
  accountsTable,
  db,
  historyTable,
  itemsTable,
  locationsTable,
  seedAccountRolePermissions,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

type SeedProduct = {
  name: string;
  category: string;
  barcode: string | null;
};

type SeedItem = SeedProduct & {
  quantity: number;
  parLevel: number;
  minQuantity: number;
  maxQuantity: number;
  location: string;
};

const DEFAULT_TARGET_ITEM_COUNT = 600;

const LOCATIONS = [
  "Carvana North",
  "Carvana South",
  "Carvana 1305",
  "Mesa Warehouse",
];

const PRODUCT_GROUPS = [
  {
    category: "Beverages",
    brands: [
      "Coca-Cola",
      "Coke Zero",
      "Diet Coke",
      "Pepsi",
      "Pepsi Zero",
      "Mountain Dew",
      "Dr Pepper",
      "Sprite",
      "Fanta Orange",
      "A&W Root Beer",
      "Red Bull",
      "Monster Energy",
      "Gatorade",
      "Powerade",
      "Pure Leaf Tea",
      "Arizona Green Tea",
      "Starbucks Frappuccino",
      "Bottled Water",
    ],
    variants: ["Classic", "Cherry", "Vanilla", "Zero Sugar", "Lemon", "Berry"],
    sizes: ["12oz", "16oz", "20oz"],
  },
  {
    category: "Candy",
    brands: [
      "Snickers",
      "Twix",
      "Kit Kat",
      "Reese's Cups",
      "M&M's Peanut",
      "M&M's Milk Chocolate",
      "Skittles",
      "Starburst",
      "Milky Way",
      "3 Musketeers",
      "PayDay",
      "Butterfinger",
      "Almond Joy",
      "Hershey's Milk Chocolate",
      "Sour Patch Kids",
    ],
    variants: ["Standard", "King Size", "Share Size", "Minis"],
    sizes: ["1.5oz", "1.74oz", "2.0oz"],
  },
  {
    category: "Chips",
    brands: [
      "Doritos",
      "Lay's",
      "Cheetos",
      "Fritos",
      "Ruffles",
      "Sun Chips",
      "Takis",
      "Pringles",
      "PopCorners",
      "Kettle Chips",
      "Funyuns",
      "Tostitos",
    ],
    variants: ["Nacho Cheese", "Cool Ranch", "Classic", "BBQ", "Flamin Hot", "Sea Salt", "Jalapeno"],
    sizes: ["1oz", "1.5oz", "2oz"],
  },
  {
    category: "Snacks",
    brands: [
      "Clif Bar",
      "Nature Valley",
      "Nutri-Grain",
      "Cheez-It",
      "Goldfish",
      "Chex Mix",
      "Gardetto's",
      "Slim Jim",
      "Jack Link's",
      "Trail Mix",
      "Planters Peanuts",
      "Kind Bar",
      "Quest Bar",
      "Rice Krispies Treats",
    ],
    variants: ["Chocolate Chip", "Peanut Butter", "Oats Honey", "Original", "Spicy", "Sweet Salty", "Protein"],
    sizes: ["1.2oz", "1.5oz", "2oz", "2.4oz"],
  },
  {
    category: "Pastries",
    brands: [
      "Pop-Tarts",
      "Hostess Donettes",
      "Hostess CupCakes",
      "Little Debbie",
      "Mrs. Freshley's",
      "Grandma's Cookies",
      "Oreo",
      "Nutter Butter",
      "Chips Ahoy",
    ],
    variants: ["Strawberry", "Chocolate", "Blueberry", "Cinnamon", "Glazed", "Fudge", "Vanilla"],
    sizes: ["2ct", "3oz", "3.5oz", "4oz"],
  },
];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "location";
}

function targetItemCount(): number {
  const raw = Number.parseInt(process.env.SEED_ITEM_COUNT ?? "", 10);
  if (!Number.isFinite(raw)) return DEFAULT_TARGET_ITEM_COUNT;
  return Math.max(1, Math.min(raw, 5000));
}

function shouldResetSeed(): boolean {
  return process.env.SEED_RESET === "true";
}

function barcodeFor(index: number): string | null {
  if (index % 37 === 0) return null;
  return String(700000000000 + index).padStart(12, "0");
}

function buildProducts(targetCount: number): SeedProduct[] {
  const productTarget = Math.ceil(targetCount / LOCATIONS.length);
  const products: SeedProduct[] = [];
  const seen = new Set<string>();

  for (const group of PRODUCT_GROUPS) {
    for (const brand of group.brands) {
      for (const variant of group.variants) {
        for (const size of group.sizes) {
          const name = `${brand} ${variant} ${size}`;
          if (seen.has(name)) continue;
          seen.add(name);
          products.push({
            name,
            category: group.category,
            barcode: barcodeFor(products.length + 1),
          });
          if (products.length >= productTarget) return products;
        }
      }
    }
  }

  throw new Error(`Could only generate ${products.length} products for target ${productTarget}`);
}

function quantityFor(productIndex: number, locationIndex: number): number {
  if ((productIndex + locationIndex) % 29 === 0) return 0;
  if ((productIndex + locationIndex) % 17 === 0) return 1;
  return ((productIndex * 7 + locationIndex * 11) % 54) + 2;
}

function parFor(productIndex: number, locationIndex: number): number {
  if ((productIndex + locationIndex) % 41 === 0) return 0;
  return [6, 8, 12, 18, 24, 30, 36, 48][(productIndex + locationIndex) % 8] ?? 12;
}

function maxFor(minQuantity: number, productIndex: number, locationIndex: number): number {
  if (minQuantity === 0) return 0;
  const multiplier = [2, 2, 3, 3][(productIndex + locationIndex) % 4] ?? 2;
  return minQuantity * multiplier;
}

function buildSeedItems(targetCount: number): SeedItem[] {
  const products = buildProducts(targetCount);
  const items: SeedItem[] = [];

  for (const [productIndex, product] of products.entries()) {
    for (const [locationIndex, location] of LOCATIONS.entries()) {
      const minQuantity = parFor(productIndex, locationIndex);
      const maxQuantity = maxFor(minQuantity, productIndex, locationIndex);
      items.push({
        ...product,
        quantity: quantityFor(productIndex, locationIndex),
        parLevel: minQuantity,
        minQuantity,
        maxQuantity,
        location,
      });
      if (items.length >= targetCount) return items;
    }
  }

  return items;
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
  const targetCount = targetItemCount();
  const resetSeed = shouldResetSeed();

  if (resetSeed) {
    const existing = await db
      .select({ id: itemsTable.id })
      .from(itemsTable)
      .where(eq(itemsTable.accountId, account.id));
    const existingIds = existing.map((item) => item.id);
    if (existingIds.length > 0) {
      await db.delete(historyTable).where(inArray(historyTable.itemId, existingIds));
      await db.delete(itemsTable).where(inArray(itemsTable.id, existingIds));
      console.log(`Reset seed inventory: removed ${existingIds.length} items and their item history rows.`);
    }
  }

  const existing = await db.select().from(itemsTable).where(eq(itemsTable.accountId, account.id));
  if (existing.length >= targetCount) {
    console.log(`Skipping seed: ${existing.length} items already present, target is ${targetCount}.`);
    process.exit(0);
  }

  const locations = new Map<string, Awaited<ReturnType<typeof ensureLocation>>>();
  for (const name of LOCATIONS) {
    locations.set(name, await ensureLocation(account.id, name));
  }

  const existingKeys = new Set(existing.map((item) => `${item.location}::${item.name}`));
  const seedItems = buildSeedItems(targetCount);
  const missingItems = seedItems
    .filter((item) => !existingKeys.has(`${item.location}::${item.name}`))
    .slice(0, targetCount - existing.length);

  if (missingItems.length === 0) {
    console.log(`Seed found ${existing.length} existing items but no new deterministic items to add.`);
    process.exit(0);
  }

  const inserted = await db
    .insert(itemsTable)
    .values(
      missingItems.map((item) => ({
        ...item,
        accountId: account.id,
        locationId: locations.get(item.location)!.id,
      })),
    )
    .returning();
  console.log(`Seeded ${inserted.length} items; account now targets ${targetCount} inventory rows.`);

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
      note: "VPS test inventory seed",
      source: "seed",
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
