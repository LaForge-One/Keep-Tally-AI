# KeepTally Field Test Checklist

Use this checklist after starting the API and website locally. Record any failure with the screen, file name, location selected, and the exact toast or server message.

## Store Import

- [ ] Valid Cantaloupe sales CSV imports against the selected store location.
- [ ] File with missing item/barcode columns shows a clear backend error.
- [ ] File with missing quantity/count column shows a clear backend error.
- [ ] Duplicate SKUs/barcodes are combined into one sold quantity during preview.
- [ ] Malformed quantities are ignored or shown as zero instead of crashing the import.
- [ ] Backend error message appears in the upload/apply toast.

Expected result: preview maps item names from `Name` or barcodes from `UPC`; `Item Cost` and `Item Price` are not treated as item names.

## Warehouse Import

- [ ] Spreadsheet/CSV with a Totals row skips the Totals row.
- [ ] Negative inventory previews as 0.
- [ ] `Item Cost` maps to cost, not item name.
- [ ] `Item Price` maps to unit price, not item name.
- [ ] Blank rows are skipped.
- [ ] Preview item names and quantities match the source file after cleanup.
- [ ] Apply succeeds without quantity validation errors.

Expected result: preview values are safe to send directly to apply.

## Scanner Flow

- [ ] Scan an existing store item barcode and see item details.
- [ ] Scan a missing barcode and see Item not found.
- [ ] Run automated mobile native scanner risk battery before scanner promotion.
- [ ] Confirm iPhone native Camera scan cannot write inventory without KeepTally confirmation.
- [ ] Confirm Android native Camera scan cannot write inventory without KeepTally confirmation.
- [ ] Confirm external or spoofed QR URLs are rejected.
- [ ] Confirm in-app scanner works over HTTPS on mobile.
- [ ] Confirm denied camera permission shows manual barcode entry fallback.
- [ ] Confirm repeated scans do not create duplicate inventory updates.
- [ ] Apply Spoilage and confirm quantity decreases.
- [ ] Apply Theft and confirm quantity decreases.
- [ ] Apply warehouse adjustment and confirm warehouse quantity changes.
- [ ] Confirm inventory history records the reason, quantity delta, barcode, account, location, and operator.
- [ ] Confirm scan log receives the adjustment entry.
- [ ] Assigned-location user cannot adjust outside assigned locations.

Expected result: reason is required before save and the confirmation appears after save.

## Quick Fixture Check

Run this from the repo root when dependencies are installed:

```powershell
pnpm --filter @workspace/scripts run check:import-fixtures
```

Expected result: `Import fixture checks passed`.

## Scanner Risk Battery

Run this from `Brian's Code` before promoting scanner changes from dev to test:

```powershell
corepack pnpm run test:mobile-scanner-risks
```

Expected result: all mobile native scanner risk tests pass.
