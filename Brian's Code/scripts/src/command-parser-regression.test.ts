import assert from "node:assert/strict";
import test from "node:test";
import type { ItemRow } from "@workspace/db";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:8080/v1";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";

function item(
  id: number,
  name: string,
  location: string,
  category = "Drinks",
): ItemRow {
  return {
    id,
    accountId: 1,
    productId: null,
    locationId: location === "Mesa" ? 10 : 20,
    name,
    category,
    quantity: 0,
    parLevel: 0,
    minQuantity: 0,
    maxQuantity: 0,
    location,
    barcode: null,
    lastUpdated: new Date(),
    createdAt: new Date(),
  };
}

const { findBestItem } = await import("../../artifacts/api-server/src/lib/commandParser");

test("command item matcher resolves common brand shorthand", () => {
  const items = [
    item(1, "Coca-Cola Zero Sugar 20oz", "Mesa"),
    item(2, "Coca-Cola Classic 20oz", "Mesa"),
  ];

  const match = findBestItem(items, "coke zero", "Mesa");
  assert.equal(match?.id, 1);
});

test("command item matcher tolerates voice transcription misspellings", () => {
  const items = [
    item(1, "Celsius Arctic Vibe", "Mesa"),
    item(2, "Red Bull Energy Drink", "Mesa"),
  ];

  const match = findBestItem(items, "selsius arctic", "Mesa");
  assert.equal(match?.id, 1);
});

test("command item matcher uses category context to break ties", () => {
  const items = [
    item(1, "Kind Almond Bar", "Mesa", "Snacks"),
    item(2, "Kind Kids Smoothie", "Mesa", "Drinks"),
  ];

  const match = findBestItem(items, "kind", "Mesa", "snacks");
  assert.equal(match?.id, 1);
});

test("command item matcher abstains on ambiguous low-gap matches", () => {
  const items = [
    item(1, "Fiji Water 16oz", "Mesa"),
    item(2, "Vitamin Water Power-C", "Mesa"),
    item(3, "Smartwater 20oz", "Mesa"),
  ];

  const match = findBestItem(items, "water", "Mesa");
  assert.equal(match, null);
});

test("command item matcher avoids wrong-location false positives", () => {
  const items = [
    item(1, "Coca-Cola Zero Sugar 20oz", "Mesa"),
    item(2, "Coca-Cola Zero Sugar 20oz", "Chandler"),
  ];

  const match = findBestItem(items, "coke zero", "Chandler");
  assert.equal(match?.id, 2);
});

test("command item matcher rejects low-confidence unrelated hints", () => {
  const items = [
    item(1, "Coca-Cola Zero Sugar 20oz", "Mesa"),
    item(2, "Snickers Bar", "Mesa", "Snacks"),
  ];

  const match = findBestItem(items, "paper towels", "Mesa");
  assert.equal(match, null);
});
