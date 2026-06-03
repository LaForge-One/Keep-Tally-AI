#!/usr/bin/env python3
"""Generate the fillable KeepTally UAT field tester PDF."""

from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "KeepTally-Test-Environment-UAT-Field-Tester-Checklist.pdf"

PAGE_W, PAGE_H = letter
LEFT = 48
RIGHT = 48
TOP = 742
BOTTOM = 44
WIDTH = PAGE_W - LEFT - RIGHT

NAVY = colors.HexColor("#102a4c")
HEADER = colors.HexColor("#dce9f6")
ROW = colors.HexColor("#f3f6fa")
BORDER = colors.HexColor("#aebfd2")
FIELD = colors.white
TEXT = colors.black
MUTED = colors.HexColor("#546174")


SECTIONS = [
    (
        "Login And Access",
        "https://test.keeptally.ai",
        [
            "Open https://test.keeptally.ai",
            "Cloudflare Access login works if prompted",
            "KeepTally login screen loads",
            "Username field accepts input",
            "Password field accepts input",
            "Eye icon shows and hides password",
            "Sign In button works",
            "Invalid login shows a clear message",
            "Successful login opens the dashboard",
            "Logout works if available",
        ],
    ),
    (
        "Dashboard",
        "",
        [
            "Dashboard loads without a blank page",
            "Summary cards show inventory information",
            "Low stock or status areas load",
            "Location selector is visible if expected",
            "Changing location updates visible data",
            "Page feels responsive on desktop",
            "Page feels responsive on mobile",
        ],
    ),
    (
        "Store Inventory",
        "/inventory",
        [
            "Inventory list loads",
            "Search or filtering works if available",
            "Location filter works",
            "Item detail values are readable",
            "Create item workflow opens",
            "Edit item workflow opens",
            "Quantity adjustment works with a reason",
            "Verify item action works",
            "Saved changes appear after refresh",
            "User cannot access locations they should not see",
        ],
    ),
    (
        "Mobile Scanner And Barcode Flow",
        "/scan",
        [
            "Scanner page opens",
            "In-app scanner requests camera permission",
            "Camera works over HTTPS",
            "Denying camera permission shows manual entry fallback",
            "Manual barcode entry works",
            "Existing barcode lookup finds the correct item",
            "Unknown barcode shows a safe not-found or create flow",
            "Repeated scan does not create duplicate updates",
            "Scanner action requires confirmation before saving",
            "Saved scanner action appears in history",
            "iPhone Camera can open a KeepTally scan link but does not write inventory automatically",
            "Android Camera can open a KeepTally scan link but does not write inventory automatically",
            "External or spoofed QR URL is not trusted as an inventory action",
            "Native scan still requires KeepTally login",
            "Native scan still requires selected location",
        ],
    ),
    (
        "Store Voice Count",
        "/voice-check",
        [
            "Voice count page opens",
            "Location selection works",
            "Count mode selection works",
            "Start AI voice count button works",
            "Browser asks for microphone permission",
            "Recording indicator is visible while speaking",
            "Saying an item and count creates a transcript",
            "App asks for confirmation before saving",
            'Verbal confirmation such as "yes" or "confirm" is accepted',
            'Verbal rejection such as "no" or "skip" is accepted',
            "Verified, updated, and skipped counters update correctly",
            "OpenAI voice response is audible if enabled",
            "Saved voice count appears in history",
        ],
    ),
    (
        "Restock",
        "/restock",
        [
            "Restock page loads",
            "Low-stock items are visible if available",
            "Location filtering works",
            "Export or restock action works if available",
            "Values match inventory expectations",
        ],
    ),
    (
        "History",
        "/history",
        [
            "History page loads",
            "Recent inventory changes appear",
            "Scanner action appears after scanner save",
            "Voice count action appears after voice save",
            "Filters work if available",
            "History entries show useful user, item, location, and reason details",
        ],
    ),
    (
        "Warehouse",
        "/warehouse, /warehouse/purchases, /warehouse/voice",
        [
            "Warehouse page loads",
            "Warehouse item list loads",
            "Warehouse item detail opens",
            "Create or edit warehouse item works if tester has permission",
            "Receive purchase workflow works if tester has permission",
            "Transfer to store workflow works if tester has permission",
            "Warehouse purchase history loads",
            "Warehouse voice count opens if tester has permission",
        ],
    ),
    (
        "Orders And Route Sheets",
        "/orders, /route-sheets",
        [
            "Orders page loads",
            "Create order or pick list works if available",
            "Order detail opens",
            "Print order page opens",
            "Route sheets page loads",
            "Create route sheet workflow works if available",
            "Route sheet details are readable",
        ],
    ),
    (
        "Import",
        "/import",
        [
            "Import page loads",
            "CSV or spreadsheet file can be selected",
            "Preview shows expected item names and quantities",
            "Bad file format shows a clear error",
            "Apply import works if coordinator approves write testing",
            "Import result shows created, updated, skipped, or failed counts",
        ],
    ),
    (
        "AI Insights",
        "/agents",
        [
            "AI insights page loads",
            "Page shows operational insights or an understandable empty state",
            "Any refresh or conversation controls work if available",
            "AI output is understandable to a non-technical user",
            "AI output does not modify inventory without confirmation",
        ],
    ),
    (
        "Admin Users",
        "/admin/users",
        [
            "User management page loads",
            "Create user workflow works",
            "Edit user workflow works",
            "Role or permission changes save correctly",
            "Location assignment changes save correctly",
            "Password reset or must-change-password flow works",
            "Non-admin user cannot access admin page",
        ],
    ),
    (
        "Settings",
        "/settings",
        [
            "Settings page loads",
            "Any visible settings are readable",
            "Placeholder or unavailable features are clearly labeled",
        ],
    ),
]


def row_height(label: str) -> int:
    lines = len(wrap(label, 45)) or 1
    return 22 + (min(lines, 3) - 1) * 13


def draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width_chars: int, size: int = 8) -> int:
    lines = wrap(text, width_chars) or [""]
    c.setFont("Helvetica-Bold", size)
    for index, line in enumerate(lines[:3]):
        c.drawString(x, y - index * (size + 1), line)
    return len(lines[:3])


def ensure_space(c: canvas.Canvas, y: float, need: float, page_no: int) -> tuple[float, int]:
    if y - need >= BOTTOM:
        return y, page_no
    footer(c, page_no)
    c.showPage()
    page_no += 1
    header(c, page_no)
    return TOP - 24, page_no


def header(c: canvas.Canvas, page_no: int) -> None:
    if page_no > 1:
        c.setFont("Helvetica", 9)
        c.setFillColor(MUTED)
        c.drawRightString(PAGE_W - RIGHT, PAGE_H - 28, "KeepTally Test Environment UAT Field Tester Checklist")
        c.setFillColor(TEXT)


def footer(c: canvas.Canvas, page_no: int) -> None:
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawCentredString(PAGE_W / 2, 24, "Result legend: Pass / Fail / Partial / NT / NA")
    c.setFillColor(TEXT)


def title(c: canvas.Canvas, text: str, y: float) -> float:
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(LEFT, y, text)
    c.setFillColor(TEXT)
    return y - 26


def small_text(c: canvas.Canvas, text: str, x: float, y: float, size: int = 8) -> None:
    c.setFont("Helvetica", size)
    c.drawString(x, y, text)


def text_field(c: canvas.Canvas, name: str, x: float, y: float, w: float, h: float, multiline: bool = False) -> None:
    flags = 4096 if multiline else 0
    c.acroForm.textfield(
        name=name,
        x=x,
        y=y,
        width=w,
        height=h,
        borderStyle="inset",
        borderWidth=1,
        borderColor=BORDER,
        fillColor=FIELD,
        textColor=TEXT,
        fontName="Helvetica",
        fontSize=8,
        fieldFlags=flags,
    )


def checkbox(c: canvas.Canvas, name: str, x: float, y: float) -> None:
    c.acroForm.checkbox(
        name=name,
        x=x,
        y=y,
        size=10,
        buttonStyle="check",
        borderWidth=1,
        borderColor=BORDER,
        fillColor=FIELD,
        textColor=TEXT,
    )


def draw_info_table(c: canvas.Canvas, y: float) -> float:
    fields = [
        "Tester name",
        "Date tested",
        "Device",
        "Browser",
        "Network",
        "Test account username",
        "Assigned location tested",
    ]
    c.setFillColor(HEADER)
    c.rect(LEFT, y - 22, WIDTH, 22, fill=1, stroke=1)
    c.setFillColor(TEXT)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(LEFT + 6, y - 14, "Field")
    c.drawString(LEFT + 176, y - 14, "Tester entry")
    y -= 22
    for i, label in enumerate(fields):
        h = 24
        c.setFillColor(ROW)
        c.rect(LEFT, y - h, 170, h, fill=1, stroke=1)
        c.setFillColor(TEXT)
        draw_wrapped(c, label, LEFT + 6, y - 15, 28)
        c.rect(LEFT + 170, y - h, WIDTH - 170, h, fill=0, stroke=1)
        text_field(c, f"tester_info_{i}", LEFT + 174, y - h + 4, WIDTH - 178, h - 8)
        y -= h
    return y - 18


def draw_result_legend(c: canvas.Canvas, y: float) -> float:
    rows = [
        ("Pass", "Worked as expected"),
        ("Fail", "Did not work"),
        ("Partial", "Worked but had an issue"),
        ("NT", "Not tested during this session"),
        ("NA", "Tester did not have permission or device support"),
    ]
    y = title(c, "Result Legend", y)
    c.setFillColor(HEADER)
    c.rect(LEFT, y - 20, WIDTH, 20, fill=1, stroke=1)
    c.setFillColor(TEXT)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(LEFT + 6, y - 13, "Result")
    c.drawString(LEFT + 96, y - 13, "Meaning")
    y -= 20
    for result, meaning in rows:
        c.setFillColor(ROW)
        c.rect(LEFT, y - 20, 90, 20, fill=1, stroke=1)
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(LEFT + 6, y - 13, result)
        c.rect(LEFT + 90, y - 20, WIDTH - 90, 20, fill=0, stroke=1)
        small_text(c, meaning, LEFT + 96, y - 13)
        y -= 20
    return y - 18


def draw_section(c: canvas.Canvas, page_no: int, y: float, index: int, name: str, path: str, items: list[str]) -> tuple[int, float]:
    needed = 56 + sum(row_height(i) for i in items) + 102
    y, page_no = ensure_space(c, y, min(needed, 360), page_no)
    y = title(c, f"Section {index}: {name}", y)
    if path:
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        c.drawString(LEFT, y + 9, f"Path: {path}")
        c.setFillColor(TEXT)

    # Header row
    header_h = 19
    result_x = LEFT + 254
    labels = ["P", "F", "Part", "NT", "NA"]
    notes_x = LEFT + 398
    c.setFillColor(HEADER)
    c.rect(LEFT, y - header_h, WIDTH, header_h, fill=1, stroke=1)
    c.setFillColor(TEXT)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(LEFT + 6, y - 12, "Test")
    for n, label in enumerate(labels):
        c.drawCentredString(result_x + n * 28 + 10, y - 12, label)
    c.drawString(notes_x + 6, y - 12, "Tester notes")
    y -= header_h

    for item_i, item in enumerate(items):
        h = row_height(item)
        y, page_no = ensure_space(c, y, h + 92, page_no)
        c.setFillColor(ROW)
        c.rect(LEFT, y - h, 254, h, fill=1, stroke=1)
        c.setFillColor(TEXT)
        draw_wrapped(c, item, LEFT + 6, y - 15, 45, 7 if len(item) > 72 else 8)
        for n in range(5):
            c.rect(result_x + n * 28, y - h, 28, h, fill=0, stroke=1)
            checkbox(c, f"s{index}_r{item_i}_{labels[n].lower()}", result_x + n * 28 + 9, y - h + (h - 10) / 2)
        c.rect(notes_x, y - h, LEFT + WIDTH - notes_x, h, fill=0, stroke=1)
        text_field(c, f"s{index}_r{item_i}_notes", notes_x + 4, y - h + 4, LEFT + WIDTH - notes_x - 8, h - 8, multiline=h > 24)
        y -= h

    # Keep feedback visibly detached from the final test row.
    y -= 18
    y, page_no = ensure_space(c, y, 80, page_no)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY)
    c.drawString(LEFT, y, "Section feedback")
    c.setFillColor(TEXT)
    y -= 55
    text_field(c, f"s{index}_feedback", LEFT, y, WIDTH, 48, multiline=True)
    return page_no, y - 22


def draw_issue_summary(c: canvas.Canvas, page_no: int, y: float) -> tuple[int, float]:
    issue_fields = [
        "Page or workflow",
        "Device and browser",
        "User account",
        "Location selected",
        "Steps to reproduce",
        "Expected result",
        "Actual result",
        "Screenshot or screen recording attached",
        "Severity",
        "Business impact",
    ]
    summary_fields = [
        "Could you complete the assigned workflow?",
        "Was anything confusing?",
        "Did any page feel too slow?",
        "Did voice or scanner behavior fail?",
        "Did the data look accurate?",
        "Would you be comfortable using this in a live test with supervision?",
        "Top three improvements requested",
    ]
    signoff_fields = ["Tester name", "Date", "Overall result", "Signature or typed approval"]

    for block_name, fields, prefix in [
        ("Issue Report", issue_fields, "issue"),
        ("Final UAT Summary", summary_fields, "summary"),
        ("Tester Sign-Off", signoff_fields, "signoff"),
    ]:
        y, page_no = ensure_space(c, y, 44 + len(fields) * 28, page_no)
        y = title(c, block_name, y)
        c.setFillColor(HEADER)
        c.rect(LEFT, y - 19, WIDTH, 19, fill=1, stroke=1)
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(LEFT + 6, y - 12, "Field")
        c.drawString(LEFT + 180, y - 12, "Tester entry")
        y -= 19
        for i, label in enumerate(fields):
            h = 26 if len(label) < 45 else 32
            y, page_no = ensure_space(c, y, h + 24, page_no)
            c.setFillColor(ROW)
            c.rect(LEFT, y - h, 174, h, fill=1, stroke=1)
            c.setFillColor(TEXT)
            draw_wrapped(c, label, LEFT + 6, y - 13, 30)
            c.rect(LEFT + 174, y - h, WIDTH - 174, h, fill=0, stroke=1)
            text_field(c, f"{prefix}_{i}", LEFT + 178, y - h + 4, WIDTH - 182, h - 8, multiline=h > 28)
            y -= h
        y -= 20
    c.setFont("Helvetica-Bold", 8)
    c.drawString(LEFT, y, "Tester note:")
    c.setFont("Helvetica", 8)
    c.drawString(LEFT + 54, y, "If a workflow is unavailable because of account permissions, mark it NA and describe what happened in Notes.")
    return page_no, y - 20


def generate() -> None:
    c = canvas.Canvas(str(OUT), pagesize=letter)
    c.setTitle("KeepTally Test Environment UAT Field Tester Checklist")
    page_no = 1
    header(c, page_no)

    y = title(c, "KeepTally Test Environment UAT Field Tester Checklist", TOP)
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawString(LEFT, y + 7, "Fillable digital checklist for test-environment UAT. Complete electronically and send back to the development team.")
    c.setFillColor(TEXT)
    y -= 16
    y = draw_info_table(c, y)
    y = draw_result_legend(c, y)

    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY)
    c.drawString(LEFT, y, "Test site")
    c.setFillColor(TEXT)
    y -= 18
    text_field(c, "test_site", LEFT, y, WIDTH, 18)
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(LEFT + 4, y + 6, "Default: https://test.keeptally.ai")
    c.setFillColor(TEXT)
    y -= 26

    for index, (name, path, items) in enumerate(SECTIONS, start=1):
        page_no, y = draw_section(c, page_no, y, index, name, path, items)

    page_no, y = draw_issue_summary(c, page_no, y)
    footer(c, page_no)
    c.save()


if __name__ == "__main__":
    generate()
