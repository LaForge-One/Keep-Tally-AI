import assert from "node:assert/strict";
import test from "node:test";
import {
  decideVoiceCountSave,
  parseVoiceCountConfirmation,
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
