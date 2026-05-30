function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  const headers = rows.shift() ?? [];
  return {
    headers,
    rows: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))),
  };
}

const STORE_ITEM_ALIASES = ["name", "product name", "item name", "product description", "description", "product", "item", "sku name"];
const STORE_BARCODE_ALIASES = ["barcode", "upc", "sku", "ean", "gtin", "product code", "item code", "item number"];
const STORE_QTY_ALIASES = ["quantity", "qty", "count", "sold", "units sold", "sales count", "number sold", "amount"];

const WAREHOUSE_ALIASES: Record<string, string[]> = {
  name: ["name", "item name", "product name", "item description", "product description", "description", "sku name", "product", "item"],
  quantity: ["quantity", "qty", "stock", "current qty", "on hand", "count", "current stock", "inventory"],
  caseCost: ["case cost", "cost", "price", "unit price", "case price", "purchase price"],
  costPerUnit: ["cost per unit", "unit cost", "each cost", "per unit cost", "unit price", "item price"],
};

function findStoreColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map((header) => header.toLowerCase().trim());
  for (const alias of aliases) {
    const exact = normalized.findIndex((header) => header === alias);
    if (exact !== -1) return headers[exact] ?? null;
  }
  for (const alias of aliases) {
    const partial = normalized.findIndex((header) => {
      if ((alias === "item" || alias === "product") && /\b(cost|price)\b/.test(header)) return false;
      return header.includes(alias);
    });
    if (partial !== -1) return headers[partial] ?? null;
  }
  return null;
}

function detectWarehouseColumn(headers: string[], field: string): string | null {
  const aliases = WAREHOUSE_ALIASES[field] ?? [];
  const normalized = headers.map((header) => header.toLowerCase().trim());
  for (const alias of aliases) {
    const exact = normalized.findIndex((header) => header === alias);
    if (exact !== -1) return headers[exact] ?? null;
  }
  for (const alias of aliases) {
    const partial = normalized.findIndex((header) => {
      if ((alias === "item" || alias === "product") && /\b(cost|price)\b/.test(header)) return false;
      if (field === "name" && /\b(cost|price|sales|tax|fee|profit|margin|total)\b/.test(header)) return false;
      return header.includes(alias);
    });
    if (partial !== -1) return headers[partial] ?? null;
  }
  return null;
}

function parseNonNegativeInteger(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Math.max(0, Number.isFinite(parsed) ? parsed : fallback);
}

function normalizeBarcode(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function checkStoreImportFixtures(): void {
  const valid = parseCSV(`Name,Item Cost,Item Price,Count,UPC\nTotals,1.48,2.50,255,\nString Cheese,0.75,1.50,14,041716231104\nString Cheese,0.75,1.50,3,041716231104\nBad Quantity,1.00,2.00,not-a-number,000000000000\n`);
  const itemCol = findStoreColumn(valid.headers, STORE_ITEM_ALIASES);
  const barcodeCol = findStoreColumn(valid.headers, STORE_BARCODE_ALIASES);
  const qtyCol = findStoreColumn(valid.headers, STORE_QTY_ALIASES);

  assert(itemCol === "Name", `Expected store item column Name, got ${itemCol}`);
  assert(barcodeCol === "UPC", `Expected store barcode column UPC, got ${barcodeCol}`);
  assert(qtyCol === "Count", `Expected store qty column Count, got ${qtyCol}`);

  const totals = valid.rows.find((row) => row[itemCol!] === "Totals");
  assert(Boolean(totals), "Expected Totals fixture row");
  assert(!totals![barcodeCol!], "Totals row should not have a barcode");

  const duplicateRows = valid.rows.filter((row) => normalizeBarcode(row[barcodeCol!] ?? "") === "041716231104");
  const duplicateQty = duplicateRows.reduce((sum, row) => sum + parseNonNegativeInteger(row[qtyCol!]), 0);
  assert(duplicateQty === 17, `Expected duplicate barcode quantity to aggregate to 17, got ${duplicateQty}`);

  const malformed = valid.rows.find((row) => row[itemCol!] === "Bad Quantity");
  assert(parseNonNegativeInteger(malformed?.[qtyCol!]) === 0, "Malformed quantity should normalize to 0 for review");

  const missingRequired = parseCSV(`Item Cost,Item Price,Count\n1.48,2.50,255\n`);
  assert(!findStoreColumn(missingRequired.headers, STORE_ITEM_ALIASES) && !findStoreColumn(missingRequired.headers, STORE_BARCODE_ALIASES), "Missing store item/barcode columns should be detectable");
}

function checkWarehouseImportFixtures(): void {
  const fixture = parseCSV(`Name,Item Cost,Item Price,Quantity,Barcode,Category\nTotals,1.48,2.50,255,,\nBeef Steak Original,0.99,1.99,-238,017082873514,Jerky\nProtein Bar,1.20,2.50,7,123456789012,Snack\n,,,,,\n`);
  const nameCol = detectWarehouseColumn(fixture.headers, "name");
  const qtyCol = detectWarehouseColumn(fixture.headers, "quantity");
  const caseCostCol = detectWarehouseColumn(fixture.headers, "caseCost");
  const costPerUnitCol = detectWarehouseColumn(fixture.headers, "costPerUnit");

  assert(nameCol === "Name", `Expected warehouse name column Name, got ${nameCol}`);
  assert(qtyCol === "Quantity", `Expected warehouse qty column Quantity, got ${qtyCol}`);
  assert(caseCostCol === "Item Cost", `Expected Item Cost to map to cost, got ${caseCostCol}`);
  assert(costPerUnitCol === "Item Price", `Expected Item Price to map to unit price, got ${costPerUnitCol}`);

  const preview = fixture.rows
    .map((row) => ({ name: row[nameCol!] ?? "", quantity: parseNonNegativeInteger(row[qtyCol!]) }))
    .filter((row) => row.name && row.name.toLowerCase() !== "totals");

  assert(preview.length === 2, `Expected totals and blank rows skipped, got ${preview.length} rows`);
  assert(preview[0]?.name === "Beef Steak Original", `Expected first warehouse item name, got ${preview[0]?.name}`);
  assert(preview[0]?.quantity === 0, `Expected negative warehouse quantity clamped to 0, got ${preview[0]?.quantity}`);
  assert(preview[1]?.quantity === 7, `Expected normal warehouse quantity preserved, got ${preview[1]?.quantity}`);
}

checkStoreImportFixtures();
checkWarehouseImportFixtures();
console.log("Import fixture checks passed");
