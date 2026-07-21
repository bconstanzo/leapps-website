#!/usr/bin/env python3
"""Generate (or validate) designs/posts/index.json from design-review Markdown.

Usage:
    python3 scripts/generate_design_index.py
    python3 scripts/generate_design_index.py --check
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESIGNS_DIR = ROOT / "designs" / "posts"
INDEX_PATH = DESIGNS_DIR / "index.json"

FRONTMATTER_RE = re.compile(r"^---\s*\n(?P<body>.*?)\n---\s*", re.DOTALL)
SLUG_RE = re.compile(r"^[\w-]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED_FIELDS = ("title", "status", "date", "updated", "author", "scope", "excerpt")


def parse_scalar(value: str):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    return value


def parse_value(value: str):
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        return [parse_scalar(part) for part in inner.split(",")] if inner else []
    return parse_scalar(value)


def parse_frontmatter(markdown: str):
    match = FRONTMATTER_RE.match(markdown)
    if not match:
        return None
    metadata = {}
    for line in match.group("body").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            continue
        metadata[key.strip()] = parse_value(value)
    return metadata


def is_date(value) -> bool:
    if not isinstance(value, str) or not DATE_RE.match(value):
        return False
    try:
        from datetime import date
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def validate(path: Path, meta, errors: list[str]) -> None:
    if not SLUG_RE.match(path.stem):
        errors.append(f"{path.name}: filename/slug is not URL-safe.")

    if meta is None:
        errors.append(f"{path.name}: missing YAML frontmatter.")
        return

    for field in REQUIRED_FIELDS:
        value = meta.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            errors.append(f"{path.name}: missing required frontmatter field \"{field}\".")

    for field in ("date", "updated"):
        if field in meta and not is_date(meta[field]):
            errors.append(f"{path.name}: {field} must be a valid YYYY-MM-DD calendar date.")

    scope = meta.get("scope")
    if scope is not None:
        if not isinstance(scope, list):
            errors.append(f"{path.name}: scope must use inline array syntax, e.g. [iLEAPP, LAVA].")
        elif not scope or any(not isinstance(item, str) or not item.strip() for item in scope):
            errors.append(f"{path.name}: scope must contain non-empty strings.")


def entry(path: Path, meta) -> dict:
    row = {
        "slug": path.stem,
        "title": meta["title"],
        "status": meta["status"],
        "date": meta["date"],
        "updated": meta["updated"],
        "author": meta["author"],
        "scope": meta["scope"],
        "discussion": meta.get("discussion", "pending"),
        "excerpt": meta["excerpt"],
    }
    return row


def main() -> int:
    check_only = "--check" in sys.argv[1:]
    paths = sorted(DESIGNS_DIR.glob("*.md"))
    errors: list[str] = []
    parsed = []

    for path in paths:
        meta = parse_frontmatter(path.read_text(encoding="utf-8-sig"))
        validate(path, meta, errors)
        parsed.append((path, meta))

    if errors:
        for error in errors:
            print(f"  error: {error}", file=sys.stderr)
        print(f"\nDesign frontmatter invalid — {len(errors)} error(s).", file=sys.stderr)
        return 1

    if check_only:
        print(f"Design frontmatter valid — {len(parsed)} design(s).")
        return 0

    rows = [entry(path, meta) for path, meta in parsed]
    rows.sort(key=lambda row: (row["updated"], row["date"], row["slug"]), reverse=True)
    INDEX_PATH.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {INDEX_PATH.relative_to(ROOT)} — {len(rows)} design(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
