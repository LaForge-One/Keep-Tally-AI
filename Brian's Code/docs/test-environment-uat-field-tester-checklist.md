# KeepTally Test Environment UAT Field Tester Checklist

Date: 2026-06-03

Status: Test environment UAT checklist

Audience: UAT testers, test coordinator, development team

## Purpose

This document gives field testers a simple checklist for validating the current KeepTally test environment. It is written for user access testing, not developer testing.

The goal is to confirm what works, what does not work, what feels confusing, and what should be corrected before the application moves closer to production readiness.

## Test Site

Use the test environment unless the test coordinator gives you a different link.

```text
https://test.keeptally.ai
```

If Cloudflare Access appears before KeepTally, sign in with the email address approved for testing. After Cloudflare Access, sign in to KeepTally with the test account provided by the test coordinator.

Do not use real customer inventory data unless the test coordinator confirms that the environment is ready for it.

## Tester Information

| Field | Tester entry |
| --- | --- |
| Tester name |  |
| Date tested |  |
| Device |  |
| Browser |  |
| Network | Wi-Fi / cellular / other |
| Test account username |  |
| Assigned location tested |  |

## Result Legend

Use these values while testing.

| Result | Meaning |
| --- | --- |
| Pass | Worked as expected |
| Fail | Did not work |
| Partial | Worked but had an issue |
| Not tested | Not tested during this session |
| Not applicable | Tester did not have permission or device support |

## Pre-Test Coordinator Diagnostics

The test coordinator or developer should run these before sending testers into the test environment.

```bash
cd "/root/Keep-Tally-AI/Brian's Code"

git log --oneline -3
./scripts/vps-stack.sh test status
./scripts/vps-ai-diagnose.sh test
corepack pnpm run test:voice-count
corepack pnpm run test:mobile-scanner-risks
```

Public checks:

```bash
curl -I https://test.keeptally.ai/api/healthz
curl -sS https://test.keeptally.ai/api/ai/connectivity
```

Expected:

- Test stack is running.
- Health endpoint is reachable.
- AI status is configured when testing voice features.
- Voice count regression tests pass.
- Mobile native scanner risk tests pass.

If Cloudflare Access returns `302`, the public URL may be protected. That is acceptable for user testing, but testers must be on the allowed access list.

## Section 1: Login And Access

| Test | Result | Notes |
| --- | --- | --- |
| Open `https://test.keeptally.ai` |  |  |
| Cloudflare Access login works if prompted |  |  |
| KeepTally login screen loads |  |  |
| Username field accepts input |  |  |
| Password field accepts input |  |  |
| Eye icon shows and hides password |  |  |
| Sign In button works |  |  |
| Invalid login shows a clear message |  |  |
| Successful login opens the dashboard |  |  |
| Logout works if available |  |  |

Feedback:

```text

```

## Section 2: Dashboard

| Test | Result | Notes |
| --- | --- | --- |
| Dashboard loads without a blank page |  |  |
| Summary cards show inventory information |  |  |
| Low stock or status areas load |  |  |
| Location selector is visible if expected |  |  |
| Changing location updates visible data |  |  |
| Page feels responsive on desktop |  |  |
| Page feels responsive on mobile |  |  |

Feedback:

```text

```

## Section 3: Store Inventory

Path:

```text
/inventory
```

| Test | Result | Notes |
| --- | --- | --- |
| Inventory list loads |  |  |
| Search or filtering works if available |  |  |
| Location filter works |  |  |
| Item detail values are readable |  |  |
| Create item workflow opens |  |  |
| Edit item workflow opens |  |  |
| Quantity adjustment works with a reason |  |  |
| Verify item action works |  |  |
| Saved changes appear after refresh |  |  |
| User cannot access locations they should not see |  |  |

Feedback:

```text

```

## Section 4: Mobile Scanner And Barcode Flow

Path:

```text
/scan
```

Use a mobile device for camera testing when possible.

| Test | Result | Notes |
| --- | --- | --- |
| Scanner page opens |  |  |
| In-app scanner requests camera permission |  |  |
| Camera works over HTTPS |  |  |
| Denying camera permission shows manual entry fallback |  |  |
| Manual barcode entry works |  |  |
| Existing barcode lookup finds the correct item |  |  |
| Unknown barcode shows a safe not-found or create flow |  |  |
| Repeated scan does not create duplicate updates |  |  |
| Scanner action requires confirmation before saving |  |  |
| Saved scanner action appears in history |  |  |

Native mobile camera checks:

| Test | Result | Notes |
| --- | --- | --- |
| iPhone Camera can open a KeepTally scan link but does not write inventory automatically |  |  |
| Android Camera can open a KeepTally scan link but does not write inventory automatically |  |  |
| External or spoofed QR URL is not trusted as an inventory action |  |  |
| Native scan still requires KeepTally login |  |  |
| Native scan still requires selected location |  |  |

Feedback:

```text

```

## Section 5: Store Voice Count

Path:

```text
/voice-check
```

Use Chrome, Edge, Safari, or Firefox with microphone permission enabled. Voice testing requires configured AI transcription and text-to-speech services.

| Test | Result | Notes |
| --- | --- | --- |
| Voice count page opens |  |  |
| Location selection works |  |  |
| Count mode selection works |  |  |
| Start AI voice count button works |  |  |
| Browser asks for microphone permission |  |  |
| Recording indicator is visible while speaking |  |  |
| Saying an item and count creates a transcript |  |  |
| App asks for confirmation before saving |  |  |
| Verbal confirmation such as "yes" or "confirm" is accepted |  |  |
| Verbal rejection such as "no" or "skip" is accepted |  |  |
| Verified, updated, and skipped counters update correctly |  |  |
| OpenAI voice response is audible if enabled |  |  |
| Saved voice count appears in history |  |  |

Feedback:

```text

```

## Section 6: Restock

Path:

```text
/restock
```

| Test | Result | Notes |
| --- | --- | --- |
| Restock page loads |  |  |
| Low-stock items are visible if available |  |  |
| Location filtering works |  |  |
| Export or restock action works if available |  |  |
| Values match inventory expectations |  |  |

Feedback:

```text

```

## Section 7: History

Path:

```text
/history
```

| Test | Result | Notes |
| --- | --- | --- |
| History page loads |  |  |
| Recent inventory changes appear |  |  |
| Scanner action appears after scanner save |  |  |
| Voice count action appears after voice save |  |  |
| Filters work if available |  |  |
| History entries show useful user, item, location, and reason details |  |  |

Feedback:

```text

```

## Section 8: Warehouse

Paths:

```text
/warehouse
/warehouse/purchases
/warehouse/voice
```

| Test | Result | Notes |
| --- | --- | --- |
| Warehouse page loads |  |  |
| Warehouse item list loads |  |  |
| Warehouse item detail opens |  |  |
| Create or edit warehouse item works if tester has permission |  |  |
| Receive purchase workflow works if tester has permission |  |  |
| Transfer to store workflow works if tester has permission |  |  |
| Warehouse purchase history loads |  |  |
| Warehouse voice count opens if tester has permission |  |  |

Feedback:

```text

```

## Section 9: Orders And Route Sheets

Paths:

```text
/orders
/route-sheets
```

| Test | Result | Notes |
| --- | --- | --- |
| Orders page loads |  |  |
| Create order or pick list works if available |  |  |
| Order detail opens |  |  |
| Print order page opens |  |  |
| Route sheets page loads |  |  |
| Create route sheet workflow works if available |  |  |
| Route sheet details are readable |  |  |

Feedback:

```text

```

## Section 10: Import

Path:

```text
/import
```

Only use test files approved by the coordinator.

| Test | Result | Notes |
| --- | --- | --- |
| Import page loads |  |  |
| CSV or spreadsheet file can be selected |  |  |
| Preview shows expected item names and quantities |  |  |
| Bad file format shows a clear error |  |  |
| Apply import works if coordinator approves write testing |  |  |
| Import result shows created, updated, skipped, or failed counts |  |  |

Feedback:

```text

```

## Section 11: AI Insights

Path:

```text
/agents
```

| Test | Result | Notes |
| --- | --- | --- |
| AI insights page loads |  |  |
| Page shows operational insights or an understandable empty state |  |  |
| Any refresh or conversation controls work if available |  |  |
| AI output is understandable to a non-technical user |  |  |
| AI output does not modify inventory without confirmation |  |  |

Feedback:

```text

```

## Section 12: Admin Users

Path:

```text
/admin/users
```

Only admin testers should complete this section.

| Test | Result | Notes |
| --- | --- | --- |
| User management page loads |  |  |
| Create user workflow works |  |  |
| Edit user workflow works |  |  |
| Role or permission changes save correctly |  |  |
| Location assignment changes save correctly |  |  |
| Password reset or must-change-password flow works |  |  |
| Non-admin user cannot access admin page |  |  |

Feedback:

```text

```

## Section 13: Settings

Path:

```text
/settings
```

| Test | Result | Notes |
| --- | --- | --- |
| Settings page loads |  |  |
| Any visible settings are readable |  |  |
| Placeholder or unavailable features are clearly labeled |  |  |

Feedback:

```text

```

## Issue Report Template

Use this format for every bug or confusing behavior.

| Field | Tester entry |
| --- | --- |
| Page or workflow |  |
| Device and browser |  |
| User account |  |
| Location selected |  |
| Steps to reproduce |  |
| Expected result |  |
| Actual result |  |
| Screenshot or screen recording attached | Yes / No |
| Severity | Low / Medium / High / Blocking |
| Business impact |  |

## Final UAT Summary

| Question | Tester answer |
| --- | --- |
| Could you complete the assigned workflow? | Yes / No / Partially |
| Was anything confusing? |  |
| Did any page feel too slow? |  |
| Did voice or scanner behavior fail? |  |
| Did the data look accurate? |  |
| Would you be comfortable using this in a live test with supervision? | Yes / No / Partially |
| Top three improvements requested |  |

## Tester Sign-Off

| Field | Tester entry |
| --- | --- |
| Tester name |  |
| Date |  |
| Overall result | Pass / Fail / Partial |
| Signature or typed approval |  |
