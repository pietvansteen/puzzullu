#!/usr/bin/env python3
"""
Put the newest version from site/changelog.json everywhere it is used:
  - the footer link on every page:  vX.Y.Z · Wat is nieuw
  - the cache-busting ?v= on css/js/svg links:  X.Y.Z-<code>

The <code> is a short hash of the site's files, so it changes with every change,
also while the version number stays the same during a work session.

Run after every change to the site (and after adding a version to the changelog):
  python3 tools/release.py
"""

import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"

FOOTER = re.compile(r'<a class="version" href="/wat-is-nieuw/">[^<]*</a>')
ASSET_V = re.compile(r"\?v=\d+\.\d+\.\d+(?:-[0-9a-f]+)?")
CODE_OF = ("*.css", "*.js", "*.svg", "*.png", "changelog.json")  # the files that ?v= points at


def content_code():
    """Short hash of the files the pages link to (not the pages themselves, which hold the code)."""
    h = hashlib.sha256()
    for f in sorted({f for pattern in CODE_OF for f in SITE.rglob(pattern)}):
        h.update(str(f.relative_to(SITE)).encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:6]


def main():
    changelog = json.loads((SITE / "changelog.json").read_text(encoding="utf-8"))
    version = changelog[0]["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        sys.exit(f"Not a MAJOR.MINOR.PATCH version: {version}")

    build = f"{version}-{content_code()}"
    changed = []
    for path in sorted(SITE.rglob("*.html")):
        text = path.read_text(encoding="utf-8")
        new = FOOTER.sub(f'<a class="version" href="/wat-is-nieuw/">v{version} · Wat is nieuw</a>', text)
        new = ASSET_V.sub(f"?v={build}", new)
        if new != text:
            path.write_text(new, encoding="utf-8")
            changed.append(str(path.relative_to(ROOT)))
    print(f"v{version} (assets ?v={build}): updated {len(changed)} file(s)")
    for c in changed:
        print("  " + c)


if __name__ == "__main__":
    main()
