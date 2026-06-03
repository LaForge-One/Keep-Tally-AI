import assert from "node:assert/strict";
import test from "node:test";

type ScanSource = "keep-tally-camera" | "native-camera" | "manual-entry" | "deep-link";
type CodeKind = "plain-upc" | "keep-tally-token" | "keep-tally-url" | "external-url" | "json" | "unknown";

type ScanRiskInput = {
  source: ScanSource;
  rawValue: string;
  authenticated: boolean;
  selectedLocation: string | null;
  originTrusted: boolean;
  recentlySubmittedActionId?: string | null;
  existingActionIds?: Set<string>;
};

type ScanRiskDecision = {
  kind: CodeKind;
  allowedToLookup: boolean;
  allowedToWrite: boolean;
  reason: string;
  normalizedCode: string | null;
  requiresInAppConfirmation: boolean;
};

function classifyCode(rawValue: string): CodeKind {
  const value = rawValue.trim();
  if (/^https:\/\/(dev\.|test\.)?keeptally\.ai\/scan\?code=/i.test(value)) return "keep-tally-url";
  if (/^https?:\/\//i.test(value)) return "external-url";
  if (/^KT:(PRODUCT|UPC|SKU):[a-z0-9-]+$/i.test(value)) return "keep-tally-token";
  if (/^\{.*\}$/.test(value)) return "json";
  if (/^[0-9a-z][0-9a-z\s-]{3,}$/i.test(value)) return "plain-upc";
  return "unknown";
}

function normalizeScannedCode(rawValue: string): string | null {
  const kind = classifyCode(rawValue);
  if (kind === "keep-tally-url") {
    const url = new URL(rawValue);
    const code = url.searchParams.get("code") ?? "";
    const normalized = code.trim().toLowerCase().replace(/[^0-9a-z]/g, "");
    return normalized || null;
  }
  if (kind === "keep-tally-token") {
    const normalized = rawValue.split(":").at(-1)?.trim().toLowerCase().replace(/[^0-9a-z]/g, "") ?? "";
    return normalized || null;
  }
  if (kind === "plain-upc") {
    const normalized = rawValue.trim().toLowerCase().replace(/[^0-9a-z]/g, "");
    return normalized || null;
  }
  return null;
}

function decideNativeScannerRisk(input: ScanRiskInput): ScanRiskDecision {
  const kind = classifyCode(input.rawValue);
  const normalizedCode = normalizeScannedCode(input.rawValue);

  if (!input.authenticated) {
    return {
      kind,
      allowedToLookup: false,
      allowedToWrite: false,
      reason: "Authentication is required before lookup or inventory write.",
      normalizedCode,
      requiresInAppConfirmation: true,
    };
  }

  if (!input.selectedLocation) {
    return {
      kind,
      allowedToLookup: Boolean(normalizedCode),
      allowedToWrite: false,
      reason: "A selected KeepTally location is required before inventory can be changed.",
      normalizedCode,
      requiresInAppConfirmation: true,
    };
  }

  if (kind === "external-url" || kind === "json" || kind === "unknown") {
    return {
      kind,
      allowedToLookup: false,
      allowedToWrite: false,
      reason: "Unsupported or unsafe native scanner payload.",
      normalizedCode,
      requiresInAppConfirmation: true,
    };
  }

  if ((input.source === "native-camera" || input.source === "deep-link") && !input.originTrusted) {
    return {
      kind,
      allowedToLookup: Boolean(normalizedCode),
      allowedToWrite: false,
      reason: "Native scanner input may prefill lookup only; untrusted origin cannot write inventory.",
      normalizedCode,
      requiresInAppConfirmation: true,
    };
  }

  if (
    input.recentlySubmittedActionId &&
    input.existingActionIds?.has(input.recentlySubmittedActionId)
  ) {
    return {
      kind,
      allowedToLookup: Boolean(normalizedCode),
      allowedToWrite: false,
      reason: "Duplicate action ID must not write inventory twice.",
      normalizedCode,
      requiresInAppConfirmation: true,
    };
  }

  return {
    kind,
    allowedToLookup: Boolean(normalizedCode),
    allowedToWrite: false,
    reason: "Lookup may proceed, but inventory writes require in-app confirmation.",
    normalizedCode,
    requiresInAppConfirmation: true,
  };
}

test("native camera deep link can prefill lookup but cannot write inventory", () => {
  const decision = decideNativeScannerRisk({
    source: "native-camera",
    rawValue: "https://dev.keeptally.ai/scan?code=049000042566",
    authenticated: true,
    selectedLocation: "Carvana South",
    originTrusted: true,
  });

  assert.equal(decision.kind, "keep-tally-url");
  assert.equal(decision.normalizedCode, "049000042566");
  assert.equal(decision.allowedToLookup, true);
  assert.equal(decision.allowedToWrite, false);
  assert.equal(decision.requiresInAppConfirmation, true);
});

test("native scanner cannot bypass authentication", () => {
  const decision = decideNativeScannerRisk({
    source: "native-camera",
    rawValue: "UPC:049000042566",
    authenticated: false,
    selectedLocation: "Carvana South",
    originTrusted: true,
  });

  assert.equal(decision.allowedToLookup, false);
  assert.equal(decision.allowedToWrite, false);
  assert.match(decision.reason, /Authentication/);
});

test("scanner input without a selected location cannot write inventory", () => {
  const decision = decideNativeScannerRisk({
    source: "deep-link",
    rawValue: "KT:UPC:049000042566",
    authenticated: true,
    selectedLocation: null,
    originTrusted: true,
  });

  assert.equal(decision.allowedToLookup, true);
  assert.equal(decision.allowedToWrite, false);
  assert.match(decision.reason, /location/i);
});

test("external URLs and unsupported QR payloads are rejected", () => {
  const external = decideNativeScannerRisk({
    source: "native-camera",
    rawValue: "https://example.com/fake-scan?code=049000042566",
    authenticated: true,
    selectedLocation: "Carvana South",
    originTrusted: false,
  });
  const json = decideNativeScannerRisk({
    source: "native-camera",
    rawValue: "{\"code\":\"049000042566\",\"location\":\"Warehouse\"}",
    authenticated: true,
    selectedLocation: "Carvana South",
    originTrusted: true,
  });

  assert.equal(external.allowedToLookup, false);
  assert.equal(external.allowedToWrite, false);
  assert.equal(json.allowedToLookup, false);
  assert.equal(json.allowedToWrite, false);
});

test("duplicate action IDs are idempotent and do not write twice", () => {
  const decision = decideNativeScannerRisk({
    source: "keep-tally-camera",
    rawValue: "049000042566",
    authenticated: true,
    selectedLocation: "Carvana South",
    originTrusted: true,
    recentlySubmittedActionId: "scan-action-123",
    existingActionIds: new Set(["scan-action-123"]),
  });

  assert.equal(decision.allowedToLookup, true);
  assert.equal(decision.allowedToWrite, false);
  assert.match(decision.reason, /Duplicate action ID/);
});

test("plain UPC normalization strips formatting differences", () => {
  const decision = decideNativeScannerRisk({
    source: "manual-entry",
    rawValue: "049-000 042566",
    authenticated: true,
    selectedLocation: "Carvana South",
    originTrusted: true,
  });

  assert.equal(decision.kind, "plain-upc");
  assert.equal(decision.normalizedCode, "049000042566");
  assert.equal(decision.allowedToLookup, true);
  assert.equal(decision.allowedToWrite, false);
});
