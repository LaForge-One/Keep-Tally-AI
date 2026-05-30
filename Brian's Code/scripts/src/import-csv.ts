import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import {
  accountsTable,
  db,
  historyTable,
  itemsTable,
  locationsTable,
  seedAccountRolePermissions,
} from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";

type Row = Record<string, string>;
type ParsedItem = {
  name: string;
  category: string;
  quantity: number;
  parLevel: number;
  location: string;
};

function clean(s: string | undefined): string {
  return (s ?? "").replace(/^\uFEFF/, "").trim();
}

function toFloat(v: string | undefined, fallback = 0): number {
  const n = Number.parseFloat(clean(v));
  return Number.isFinite(n) ? n : fallback;
}

function toInt(v: string | undefined, fallback = 0): number {
  const n = Number.parseInt(clean(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

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

async function resolveLocations(accountId: number, items: ParsedItem[]) {
  const locations = new Map<string, Awaited<ReturnType<typeof ensureLocation>>>();
  for (const name of [...new Set(items.map((item) => item.location))]) {
    locations.set(name, await ensureLocation(accountId, name));
  }
  return locations;
}

/**
 * Parse a row from the "full" format (Carvana South):
 *   columns: Qty / Hand, Min, Max, Location
 */
function parseFullFormat(r: Row, defaultLocation: string) {
  const name = clean(r["Name"]);
  if (!name) return null;
  const category = clean(r["Category 1"]) || "Uncategorized";
  const qty = Math.max(0, toInt(r["Qty / Hand"], 0));
  const max = toInt(r["Max"], 0);
  const min = toInt(r["Min"], 0);
  const parLevel = max > 0 ? max : min > 0 ? min : Math.max(qty, 1);
  const location = clean(r["Location"]) || defaultLocation;
  return { name, category, quantity: qty, parLevel, location };
}

/**
 * Parse a row from the "compact" format (Carvana North / 1305):
 *   columns: Percent of Par (no absolute qty, no min/max)
 *
 * Strategy: assume a sensible default par of 12 per slot and derive
 * qty = round(percentOfPar * 12), clamped to [0, 99].
 */
function parseCompactFormat(r: Row, defaultLocation: string) {
  const name = clean(r["Name"]);
  if (!name) return null;
  const category = clean(r["Category 1"]) || "Uncategorized";
  const percentOfPar = toFloat(r["Percent of Par"], 0);
  const DEFAULT_PAR = 12;
  const quantity = Math.max(0, Math.min(99, Math.round(percentOfPar * DEFAULT_PAR)));
  const parLevel = DEFAULT_PAR;
  const location = defaultLocation;
  return { name, category, quantity, parLevel, location };
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0];
  const defaultLocation = args[1] ?? "Unknown";
  const append = args.includes("--append");

  if (!filePath) {
    console.error("Usage: import-csv <path-to-csv> <location-name> [--append]");
    process.exit(1);
  }

  const account = await ensureDefaultAccount();
  const defaultLocationRow = await ensureLocation(account.id, defaultLocation);
  const absPath = resolve(filePath);
  const raw = readFileSync(absPath, "utf8");
  const rows = parse(raw, {
    columns: (header: string[]) => header.map((h) => clean(h)),
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  }) as Row[];

  console.log(`Parsed ${rows.length} rows from ${absPath}`);

  // Detect format by presence of "Qty / Hand" column
  const firstRow = rows[0] ?? {};
  const isFullFormat = "Qty / Hand" in firstRow;
  console.log(`Format detected: ${isFullFormat ? "full (South)" : "compact (North/1305)"}`);

  if (append) {
    // Clear only this location's items so we can re-import cleanly
    const existing = await db
      .select({ id: itemsTable.id })
      .from(itemsTable)
      .where(
        and(
          or(eq(itemsTable.accountId, account.id), isNull(itemsTable.accountId)),
          or(eq(itemsTable.locationId, defaultLocationRow.id), eq(itemsTable.location, defaultLocation)),
        ),
      );
    if (existing.length > 0) {
      console.log(`Clearing ${existing.length} existing items for "${defaultLocation}"...`);
      await db
        .delete(itemsTable)
        .where(
          and(
            or(eq(itemsTable.accountId, account.id), isNull(itemsTable.accountId)),
            or(eq(itemsTable.locationId, defaultLocationRow.id), eq(itemsTable.location, defaultLocation)),
          ),
        );
    }
  } else {
    await db.delete(historyTable).where(or(eq(historyTable.accountId, account.id), isNull(historyTable.accountId)));
    await db.delete(itemsTable).where(or(eq(itemsTable.accountId, account.id), isNull(itemsTable.accountId)));
    console.log("Cleared existing default-account and legacy-unlinked items/history.");
  }

  const items = rows
    .map((r) =>
      isFullFormat ? parseFullFormat(r, defaultLocation) : parseCompactFormat(r, defaultLocation),
    )
    .filter((x): x is NonNullable<typeof x> => x !== null);

  console.log(`Prepared ${items.length} items for insert into "${defaultLocation}".`);
  const locations = await resolveLocations(account.id, items);

  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const out = await db.insert(itemsTable).values(
      slice.map((item) => ({
        ...item,
        accountId: account.id,
        locationId: locations.get(item.location)!.id,
      })),
    ).returning();
    await db.insert(historyTable).values(
      out.map((it) => ({
        accountId: account.id,
        locationId: it.locationId,
        itemId: it.id,
        itemName: it.name,
        action: "create",
        field: null,
        previousValue: null,
        newValue: `${it.quantity} @ ${it.location}`,
        note: "CSV import",
        source: "ui",
        location: it.location,
      })),
    );
    inserted += out.length;
  }

  console.log(`Imported ${inserted} items with history.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
