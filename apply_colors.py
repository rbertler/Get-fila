#!/usr/bin/env python3
"""
Apply color changes from an updated Fila_Color_Inventory.docx to the codebase.

Usage:
    python3 apply_colors.py [--dry-run]

Steps:
    1. Drop the updated Fila_Color_Inventory.docx into /Users/rachelbertler/fila/
    2. Run: python3 apply_colors.py
    3. Review the summary, then commit the changes.

Add --dry-run to preview changes without writing any files.
"""

import zipfile
import xml.etree.ElementTree as ET
import re
import json
import os
import sys

DOCX = os.path.join(os.path.dirname(__file__), 'Fila_Color_Inventory.docx')
BASELINE = os.path.join(os.path.dirname(__file__), 'colors_baseline.json')
SRC_DIR = os.path.join(os.path.dirname(__file__), 'client', 'src')
EXTENSIONS = ('.tsx', '.ts', '.css', '.js')

NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,6}')

dry_run = '--dry-run' in sys.argv


def get_cell_text(cell):
    return ''.join(t.text for t in cell.iter(NS + 't') if t.text).strip()


def extract_rows(docx_path):
    with zipfile.ZipFile(docx_path) as z:
        with z.open('word/document.xml') as f:
            tree = ET.parse(f)
    root = tree.getroot()
    rows = []
    for table in root.iter(NS + 'tbl'):
        for row in table.iter(NS + 'tr'):
            cells = [get_cell_text(c) for c in row.findall(NS + 'tc')]
            if cells:
                rows.append({'cells': cells, 'hexes': HEX_RE.findall(' | '.join(cells))})
    return rows


def row_key(row):
    # Use the non-hex cells as the key so we can match rows across versions
    return ' | '.join(
        re.sub(r'#[0-9a-fA-F]{3,6}', '', c).strip()
        for c in row['cells']
    ).lower()


def build_changes(baseline, updated):
    changes = {}  # old_hex (lowercase) -> new_hex (lowercase)

    # Build lookup from key -> row for baseline
    baseline_map = {}
    for row in baseline:
        key = row_key(row)
        baseline_map[key] = row

    matched = 0
    skipped = 0

    for new_row in updated:
        key = row_key(new_row)
        old_row = baseline_map.get(key)

        if old_row is None:
            # New row added in the doc — just skip, nothing to diff
            skipped += 1
            continue

        old_hexes = [h.lower() for h in old_row['hexes']]
        new_hexes = [h.lower() for h in new_row['hexes']]
        matched += 1

        if len(old_hexes) != len(new_hexes):
            print(f"  WARNING: hex count changed for row '{key}', skipping")
            continue

        for old_h, new_h in zip(old_hexes, new_hexes):
            if old_h != new_h:
                if old_h in changes and changes[old_h] != new_h:
                    print(f"  WARNING: conflicting change for {old_h} -> {changes[old_h]} vs {new_h}, using first")
                else:
                    changes[old_h] = new_h

    print(f"  Matched {matched} existing rows, {skipped} new rows ignored for diff")
    return changes


def apply_to_file(path, changes):
    with open(path, 'r', encoding='utf-8') as f:
        original = f.read()

    content = original
    for old_hex, new_hex in changes.items():
        for variant in [old_hex, old_hex.upper(), old_hex[0] + old_hex[1:].upper()]:
            if variant in content:
                content = content.replace(variant, new_hex)

    if content != original:
        if not dry_run:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
        return True
    return False


def main():
    if not os.path.exists(DOCX):
        print(f"ERROR: {DOCX} not found.")
        sys.exit(1)
    if not os.path.exists(BASELINE):
        print(f"ERROR: {BASELINE} not found.")
        sys.exit(1)

    with open(BASELINE) as f:
        baseline = json.load(f)

    print(f"Parsing {os.path.basename(DOCX)}...")
    updated = extract_rows(DOCX)
    print(f"  Baseline: {len(baseline)} rows | Updated doc: {len(updated)} rows")

    changes = build_changes(baseline, updated)

    if not changes:
        print("\nNo color changes detected.")
        if not dry_run:
            print("Updating baseline to include any new rows...")
            with open(BASELINE, 'w') as f:
                json.dump(updated, f, indent=2)
            print("Done.")
        return

    print(f"\nDetected {len(changes)} color change(s):")
    for old, new in changes.items():
        print(f"  {old}  →  {new}")

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Scanning {SRC_DIR}...")
    changed_files = []
    for root, dirs, files in os.walk(SRC_DIR):
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for fname in files:
            if fname.endswith(EXTENSIONS):
                path = os.path.join(root, fname)
                if apply_to_file(path, changes):
                    rel = os.path.relpath(path, os.path.dirname(__file__))
                    changed_files.append(rel)

    if changed_files:
        print(f"\n{'Would update' if dry_run else 'Updated'} {len(changed_files)} file(s):")
        for f in changed_files:
            print(f"  {f}")
    else:
        print("No source files contained the changed hex values.")

    if not dry_run:
        print("\nUpdating baseline...")
        with open(BASELINE, 'w') as f:
            json.dump(updated, f, indent=2)
        print("Done. Baseline updated to match new document.")
    else:
        print("\n(Dry run — no files written. Remove --dry-run to apply.)")


if __name__ == '__main__':
    main()
