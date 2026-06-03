# Mobile Native Scanner Risk Test Battery

Date: 2026-06-03

Status: Test plan and regression battery

Audience: Business owners, QA testers, implementation team

## Executive Summary

Most Apple and Android devices include built-in QR and barcode scanning through the native camera app. That is useful, but it also creates risk because the native camera may open a link or display a value outside the KeepTally scanner workflow.

This test battery is designed to mimic those risks and project expected outcomes before the app relies on native scanner behavior. The main rule is simple: a native scan may prefill a code or open the KeepTally app, but it must never update inventory until the user is authenticated, a location is selected, and the user confirms the action inside KeepTally.

## Test Objective

Confirm that native mobile scanning cannot bypass KeepTally controls.

The tests should prove:

- Native camera scans cannot update inventory by themselves.
- Deep links only prefill lookup or route the user into the app.
- Authentication is always required.
- Location selection is always required before inventory changes.
- Unsupported QR payloads are rejected.
- Duplicate submissions do not double-save.
- Scans from the in-app scanner and native camera follow the same server-side validation rules.

## Test Types

| Test type | Purpose |
| --- | --- |
| Automated regression tests | Validate scan risk decisions without real camera hardware |
| Manual mobile tests | Confirm iPhone and Android behavior over HTTPS |
| API tests | Confirm server-side lookup/write protections |
| Security tests | Confirm unsafe QR payloads cannot bypass authentication or location scope |

## Automated Regression Command

Run this from the workspace root inside `Brian's Code`:

```bash
corepack pnpm --filter @workspace/scripts run test:mobile-scanner-risks
```

Or from the root package:

```bash
corepack pnpm run test:mobile-scanner-risks
```

The automated test battery currently models:

- KeepTally deep links.
- Native camera scan input.
- Authentication requirements.
- Location requirements.
- External URL rejection.
- JSON payload rejection.
- Duplicate action ID protection.
- UPC normalization.

## Native Scanner Risk Matrix

| Scenario | Example input | Expected outcome |
| --- | --- | --- |
| Native camera scans KeepTally URL | `https://dev.keeptally.ai/scan?code=049000042566` | App may open and prefill code; no inventory write |
| Native camera scans plain UPC | `049000042566` | User must paste or enter code inside KeepTally; no inventory write |
| Native camera scans KeepTally token | `KT:UPC:049000042566` | App may normalize and lookup after authentication |
| Native camera scans external URL | `https://example.com/fake-scan` | Reject as unsupported for inventory action |
| Native camera scans JSON | `{"code":"049000042566"}` | Reject until a trusted parser is intentionally implemented |
| User is not authenticated | Any code | Redirect to login or return authentication error |
| No location selected | Any valid code | Allow lookup only; block inventory write |
| Duplicate scan submitted twice | Same action ID | Return existing result or reject duplicate write |
| In-app scanner camera blocked | Browser denies camera | Show manual entry fallback |
| HTTP instead of HTTPS | Mobile browser blocks camera | Require HTTPS for camera scanning |

## Manual Mobile Test Plan

### Test 1: iPhone Native Camera Opens KeepTally Link

Steps:

1. Create a QR code containing `https://dev.keeptally.ai/scan?code=049000042566`.
2. Scan it with the iPhone Camera app.
3. Open the prompted link.
4. Confirm KeepTally requires login if the user is not authenticated.
5. Confirm no inventory record changes until the user confirms inside KeepTally.

Expected result:

- The app opens or prompts for login.
- The code may be visible or prefilled.
- No inventory update occurs automatically.

### Test 2: Android Native Camera Opens KeepTally Link

Steps:

1. Repeat the same test on Android.
2. Use Chrome as the default browser.
3. Confirm authentication, location selection, and confirmation are still required.

Expected result:

- Android behavior matches iPhone behavior from a business-control standpoint.

### Test 3: External URL Spoofing

Steps:

1. Create a QR code containing `https://example.com/scan?code=049000042566`.
2. Scan it with the native camera.
3. Confirm KeepTally does not treat it as a trusted scan.

Expected result:

- The external URL is not accepted as an inventory action.

### Test 4: In-App Scanner Camera Permission Denied

Steps:

1. Open KeepTally scanner on mobile.
2. Deny camera permission.
3. Confirm the app shows manual entry fallback.

Expected result:

- User can still enter a barcode manually.
- The app does not hang.

### Test 5: Duplicate Scan Protection

Steps:

1. Scan the same code repeatedly.
2. Confirm the scanner cooldown prevents rapid duplicate UI actions.
3. Submit the same confirmed action twice if possible.

Expected result:

- Duplicate camera reads are suppressed.
- Duplicate save attempts do not double-adjust inventory.

## API Test Plan

### Lookup Should Be Allowed

A valid authenticated request can lookup a scanned code.

Expected behavior:

- The API normalizes the code.
- The API checks `product_identifiers`.
- The API falls back to legacy barcode fields.
- The API returns a result or unknown state.

### Write Should Require Confirmation

A scanned code alone must not update inventory.

Expected behavior:

- Save endpoints require authenticated user context.
- Save endpoints require account and location scope.
- Save endpoints require an explicit action.
- Future save endpoints should require a client action ID.

## Recommended Future Implementation

To fully support native QR scanner workflows, add a deep-link route:

```text
/scan?code=049000042566
```

Recommended behavior:

1. If unauthenticated, redirect to login.
2. After login, return to scanner with code prefilled.
3. If no location is selected, ask the user to choose one.
4. Perform lookup only.
5. Require user confirmation before any write.

## Acceptance Criteria

This risk area should be considered controlled when:

- Automated mobile scanner risk tests pass.
- iPhone native camera test passes.
- Android native camera test passes.
- External URL spoofing is rejected.
- Native scan cannot bypass authentication.
- Native scan cannot bypass location selection.
- Native scan cannot write inventory without confirmation.
- Duplicate scans do not double-save.
- Manual entry fallback works when camera permission is denied.

## Recommendation

Add the automated test battery to the regular pre-promotion checklist and run the manual mobile tests before promoting scanner changes from dev to test.
