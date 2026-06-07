import assert from "node:assert/strict";
import test from "node:test";
import {
  decideVoiceCountSave,
  parseSpokenNumber,
  parseVoiceCountConfirmation,
  parseVoiceInventoryCommand,
} from "../../artifacts/keep-tally/src/lib/voice-count-workflow";

test("voice count confirmation accepts clear verbal affirmations", () => {
  const affirmations = [
    "yes",
    "yeah save it",
    "confirmed",
    "confirm",
    "affirmative",
    "agreed",
    "approved",
    "okay proceed",
    "that's right",
    "do it",
  ];

  for (const phrase of affirmations) {
    assert.equal(parseVoiceCountConfirmation(phrase), "yes", phrase);
  }
});

test("voice count confirmation rejects clear negative or retry commands", () => {
  const rejections = [
    "no",
    "nope",
    "cancel",
    "wrong",
    "incorrect",
    "retry",
    "try again",
    "do not save",
    "skip this item",
  ];

  for (const phrase of rejections) {
    assert.equal(parseVoiceCountConfirmation(phrase), "no", phrase);
  }
});

test("voice count confirmation treats unclear responses as unknown", () => {
  const unclear = ["", "maybe", "I am not sure", "five", "coke zero"];

  for (const phrase of unclear) {
    assert.equal(parseVoiceCountConfirmation(phrase), "unknown", phrase);
  }
});

test("voice count save decision never writes without affirmative confirmation", () => {
  assert.deepEqual(decideVoiceCountSave(5, 5, "no"), {
    shouldSave: false,
    action: null,
    status: "skipped",
  });

  assert.deepEqual(decideVoiceCountSave(5, 8, "unknown"), {
    shouldSave: false,
    action: null,
    status: "skipped",
  });
});

test("voice count save decision verifies matching counts after affirmation", () => {
  assert.deepEqual(decideVoiceCountSave(5, 5, "yes"), {
    shouldSave: true,
    action: "verify",
    status: "verified",
  });
});

test("voice count save decision updates changed counts after affirmation", () => {
  assert.deepEqual(decideVoiceCountSave(5, 8, "yes"), {
    shouldSave: true,
    action: "adjust",
    status: "updated-higher",
  });

  assert.deepEqual(decideVoiceCountSave(5, 3, "yes"), {
    shouldSave: true,
    action: "adjust",
    status: "updated-lower",
  });
});

const voiceItems = [
  { id: 1, name: "Coke Zero", quantity: 4 },
  { id: 2, name: "Coke Classic", quantity: 6 },
  { id: 3, name: "Red Bull", quantity: 8 },
  { id: 4, name: "Red Bull Zero", quantity: 2 },
];

test("spoken number parser handles compact inventory phrases", () => {
  assert.equal(parseSpokenNumber("only two left"), 2);
  assert.equal(parseSpokenNumber("about twelve"), 12);
  assert.equal(parseSpokenNumber("two dozen"), 24);
  assert.equal(parseSpokenNumber("twenty one"), 21);
});

test("voice inventory parser matches item then quantity", () => {
  const result = parseVoiceInventoryCommand("Coke Zero five", voiceItems);
  assert.equal(result.status, "match");
  if (result.status !== "match") return;
  assert.equal(result.item.name, "Coke Zero");
  assert.equal(result.quantity, 5);
});

test("voice inventory parser matches quantity then item", () => {
  const result = parseVoiceInventoryCommand("three Red Bull", voiceItems);
  assert.equal(result.status, "match");
  if (result.status !== "match") return;
  assert.equal(result.item.name, "Red Bull");
  assert.equal(result.quantity, 3);
});

test("voice inventory parser handles count wording", () => {
  const result = parseVoiceInventoryCommand("Coke Zero count is five", voiceItems);
  assert.equal(result.status, "match");
  if (result.status !== "match") return;
  assert.equal(result.item.name, "Coke Zero");
  assert.equal(result.quantity, 5);
});

test("voice inventory parser asks for clarification on ambiguous names", () => {
  const result = parseVoiceInventoryCommand("Red Bull three", voiceItems);
  assert.equal(result.status, "ambiguous");
  if (result.status !== "ambiguous") return;
  assert.deepEqual(
    result.candidates.map((item) => item.name),
    ["Red Bull", "Red Bull Zero"],
  );
});
