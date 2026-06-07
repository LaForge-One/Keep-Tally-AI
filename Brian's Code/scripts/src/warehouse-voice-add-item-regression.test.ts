import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildWarehouseItemCreatePayloadFromVoiceDraft,
  isCompleteWarehouseVoiceAddItemDraft,
  parseWarehouseVoiceAddItemConfirmation,
  warehouseVoiceAddItemDraftSummary,
  type WarehouseVoiceAddItemDraft,
} from "../../artifacts/keep-tally/src/lib/warehouse-voice-add-item";

const completeDraft: WarehouseVoiceAddItemDraft = {
  name: "Coke Zero 20oz",
  category: "Drinks",
  quantity: 12,
  minQuantity: 6,
  maxQuantity: 24,
  barcode: "049000042566",
  location: "Warehouse",
};

test("warehouse voice add-item accepts clear verbal affirmations", () => {
  const affirmations = [
    "yes",
    "yep create it",
    "confirm",
    "confirmed",
    "affirmative",
    "approved",
    "save it",
    "do it",
    "go ahead",
  ];

  for (const phrase of affirmations) {
    assert.equal(parseWarehouseVoiceAddItemConfirmation(phrase), "yes", phrase);
  }
});

test("warehouse voice add-item rejects cancellation and negative phrases", () => {
  const rejections = [
    "no",
    "nope",
    "cancel",
    "stop",
    "negative",
    "do not create",
    "don't save",
    "skip",
  ];

  for (const phrase of rejections) {
    assert.equal(parseWarehouseVoiceAddItemConfirmation(phrase), "no", phrase);
  }
});

test("warehouse voice add-item treats unclear confirmation as unknown", () => {
  for (const phrase of ["", "maybe", "quantity five", "Coke Zero", "not sure"]) {
    assert.equal(parseWarehouseVoiceAddItemConfirmation(phrase), "unknown", phrase);
  }
});

test("warehouse voice add-item requires a complete valid min/max draft", () => {
  assert.equal(isCompleteWarehouseVoiceAddItemDraft(completeDraft), true);

  assert.equal(isCompleteWarehouseVoiceAddItemDraft({ ...completeDraft, name: null }), false);
  assert.equal(isCompleteWarehouseVoiceAddItemDraft({ ...completeDraft, category: null }), false);
  assert.equal(isCompleteWarehouseVoiceAddItemDraft({ ...completeDraft, quantity: null }), false);
  assert.equal(isCompleteWarehouseVoiceAddItemDraft({ ...completeDraft, minQuantity: null }), false);
  assert.equal(isCompleteWarehouseVoiceAddItemDraft({ ...completeDraft, maxQuantity: null }), false);
  assert.equal(isCompleteWarehouseVoiceAddItemDraft({ ...completeDraft, minQuantity: 25, maxQuantity: 24 }), false);
});

test("warehouse voice add-item maps confirmed draft into warehouse create payload", () => {
  assert.deepEqual(buildWarehouseItemCreatePayloadFromVoiceDraft(completeDraft), {
    name: "Coke Zero 20oz",
    barcode: "049000042566",
    category: "Drinks",
    quantity: 12,
    minPar: 6,
    maxPar: 24,
    reorderPoint: 6,
    unitsPerCase: 1,
  });
});

test("warehouse voice add-item uses blank barcode when barcode is optional", () => {
  const payload = buildWarehouseItemCreatePayloadFromVoiceDraft({ ...completeDraft, barcode: null });

  assert.equal(payload.barcode, "");
});

test("warehouse voice add-item refuses to build payload from incomplete draft", () => {
  assert.throws(
    () => buildWarehouseItemCreatePayloadFromVoiceDraft({ ...completeDraft, maxQuantity: null }),
    /incomplete/i,
  );
});

test("warehouse voice add-item summary is spoken in operational order", () => {
  assert.equal(
    warehouseVoiceAddItemDraftSummary(completeDraft),
    "Coke Zero 20oz, category Drinks, quantity 12, minimum 6, maximum 24, barcode 049000042566",
  );
});

test("regression guard keeps add-item voice creation warehouse-only", () => {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const voiceRoute = readFileSync(resolve(repoRoot, "artifacts/api-server/src/routes/voice.ts"), "utf8");
  const storeVoicePage = readFileSync(resolve(repoRoot, "artifacts/keep-tally/src/pages/voice-check.tsx"), "utf8");
  const warehouseVoicePage = readFileSync(resolve(repoRoot, "artifacts/keep-tally/src/pages/warehouse-voice.tsx"), "utf8");

  assert.match(voiceRoute, /\/voice\/warehouse\/add-item\/draft/);
  assert.doesNotMatch(voiceRoute, /router\.post\(\s*["']\/voice\/add-item\/draft/);
  assert.doesNotMatch(storeVoicePage, /Add Item by Voice/);
  assert.match(warehouseVoicePage, /Add Warehouse Item by Voice/);
  assert.match(warehouseVoicePage, /\/api\/warehouse/);
});
