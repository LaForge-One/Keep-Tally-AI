# Label Generation Design

Date: 2026-05-29

## Short Answer

Yes. KeepTally can generate and print scan labels directly inside the system.

The app already has:

- Store item barcode field.
- Warehouse item barcode field.
- Camera/manual scan workflow.
- Scan lookup and scan action API routes.
- Inventory create/update workflows that can store a barcode.

The missing feature is a first-class label workflow: generate codes, assign them to items, print labels, and audit label batches.

## Recommended Label Strategy

Use system-generated QR codes for internal labels.

Why QR first:

- Easy to scan with phone cameras.
- Reliable on small labels.
- Can hold a structured payload instead of only a number.
- Avoids needing external UPC/EAN registration.
- Works well for internal vending/storage/bin workflows.

Still support existing UPC/barcodes:

- If an item already has a manufacturer UPC, keep using it.
- If no barcode exists, generate an internal KeepTally code.
- Scanner should accept both manufacturer UPC and internal QR payloads.

## Internal Code Format

Recommended internal code:

```text
KT:<accountId>:<inventoryType>:<itemId>:<shortCheck>
```

Examples:

```text
KT:1:store:123:A7F2
KT:1:warehouse:44:91BC
```

For human-readable fallback, print a short SKU below the QR:

```text
KT-S-000123
KT-W-000044
```

Design rule:

- QR payload is authoritative.
- Human-readable text is for manual entry if the camera fails.
- The existing `barcode` column can store the short human-readable code or the QR payload. Longer term, add a separate `label_code` column if we want to preserve manufacturer UPC separately.

## Product Flow

### 1. Item Detail Label Action

Add a label action on each inventory item:

- `Print Label`
- `Generate Label`
- `Regenerate Label`
- `Download PDF`

Behavior:

- If the item already has a barcode, show preview.
- If missing, generate an internal code.
- Save generated code to the item.
- Render a printable label.

### 2. Bulk Label Center

Add a new Settings section or dedicated sidebar page:

```text
Settings -> Labels
```

Views:

- Missing Labels
- Store Items
- Warehouse Items
- Recently Printed
- Label Templates

Bulk actions:

- Generate labels for selected items.
- Generate labels for all items missing barcodes.
- Print selected labels.
- Export label sheet as PDF.
- Export CSV for external label software.

### 3. Receiving / Import Flow

When creating items from scan/import:

- If item has UPC, preserve UPC.
- If item has no UPC, offer “Generate KeepTally Label.”
- If a scan is unknown, allow creating an item and binding that scanned code.

### 4. Scan Flow

Scanner should normalize incoming data:

- Raw UPC/EAN/code128 text.
- Internal `KT:*` QR payload.
- Short manual code like `KT-S-000123`.

Then lookup should resolve:

- Store item by barcode/code.
- Warehouse item by barcode/code.
- If QR includes item ID, verify account/location access before returning item.

## Label Layouts

### Shelf / Bin Label

Best for inventory shelves and bins:

- Item name
- Category
- Location
- QR code
- Human-readable short code
- Par level

Suggested size:

- Avery 5160 / 8160 address labels
- 2.625 in x 1 in

### Small Product Label

Best for tight packaging:

- QR code
- Short code
- Abbreviated name

Suggested size:

- 1 in x 1 in
- Dymo/Zebra compatible

### Warehouse Label

Best for cases, bins, shelves:

- Item name
- QR code
- Min/max/reorder
- Units per case
- Vendor optional

Suggested size:

- 2 in x 1 in or 3 in x 2 in

## Technical Design

### Frontend

Add:

- `LabelsPage`
- `LabelPreview`
- `LabelSheet`
- `LabelTemplateSelector`
- `PrintLabelsDialog`

Libraries:

- QR generation: `qrcode` or `qr-code-styling`.
- PDF export: browser print CSS first; add PDF generation later if needed.
- Barcode generation if needed later: `JsBarcode`.

Initial implementation should use browser print:

```text
Generate labels -> render print sheet -> window.print()
```

This avoids printer-driver complexity and works on desktops quickly.

### Backend

Add API routes:

```text
POST /api/labels/generate
POST /api/labels/bulk-generate
GET  /api/labels/preview?inventoryType=store&id=123
POST /api/labels/print-batch
GET  /api/labels/batches
```

Minimum backend responsibilities:

- Generate collision-resistant internal codes.
- Ensure generated codes are unique per account.
- Save the code to the correct item.
- Log label generation in history.
- Enforce permissions.

Permissions:

- Generate labels: `edit_store_inventory` or `edit_warehouse`.
- Print labels: same as view/edit inventory, depending on strictness.
- Regenerate labels: admin or edit inventory.

### Database

Minimum approach:

- Reuse existing `barcode` fields.
- Add unique-ish lookup indexes if needed.

Better long-term approach:

Add:

```sql
label_code text
label_updated_at timestamptz
label_printed_at timestamptz
```

Create indexes:

```sql
items(account_id, label_code)
warehouse_items(account_id, label_code)
```

Reason:

- Manufacturer UPC and internal label code are different concepts.
- Keeping them separate avoids overwriting real product UPCs.

### Print Batch Audit

Optional but useful:

```text
label_batches
- id
- account_id
- inventory_type
- template
- item_count
- created_by
- created_at

label_batch_items
- id
- batch_id
- item_id
- label_code
```

This gives accountability when labels are reprinted.

## AI/Agent Enhancements Later

Once API credentials are available:

- Suggest label abbreviations that fit small labels.
- Detect duplicate or inconsistent product names.
- Auto-generate category-specific label templates.
- Parse vendor invoices/CSV and suggest label batches.
- Voice workflow: “Print labels for all low-stock Red Bull items at Route 3.”
- Agent workflow: “Find every item missing a label and prepare a print sheet.”

## Implementation Phases

### Phase 1: Fast Internal Label MVP

Scope:

- Generate internal QR/short code for store and warehouse items.
- Print labels from item detail and inventory table.
- Bulk print selected items.
- Use browser print CSS.
- Store generated value in existing `barcode` only when barcode is empty.

Risk:

- Existing UPC and internal codes share one field.

### Phase 2: Proper Label Data Model

Scope:

- Add `label_code` fields.
- Add indexes.
- Keep `barcode` for UPC/vendor/manufacturer codes.
- Scan lookup checks both `barcode` and `label_code`.
- Add label batch history.

Risk:

- Requires migration and scan route update.

### Phase 3: Printer/Template Polish

Scope:

- Avery, Dymo, Zebra templates.
- PDF export.
- CSV export for external label software.
- Print alignment calibration.

Risk:

- Browser/printer margins vary by device.

### Phase 4: AI-Assisted Label Operations

Scope:

- Auto abbreviations.
- Missing label detection.
- Duplicate product cleanup.
- Voice/agent-driven label batch creation.

Dependency:

- API credentials.

## Recommended Next Step

Build Phase 1 first:

1. Add a Labels page under Settings.
2. Generate QR labels for selected inventory items.
3. Print via browser print sheet.
4. Update scan lookup to recognize internal `KT-*` codes.
5. Keep AI out of the critical path until credentials are ready.

This gives immediate operational value without needing external label services or API credentials.
