#!/usr/bin/env python3
"""Copy the PRD, the wireframes, the Excel layouts and the API description into
frontend/docs/, so the deployed app serves them at /docs/ behind the same
Google sign-in as the WMS.

    python build_prd_html.py && python build_wireframes.py && python tools/publish_docs.py
"""
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "frontend" / "docs"
(DOCS / "templates").mkdir(parents=True, exist_ok=True)

shutil.copyfile(ROOT / "PRD.html", DOCS / "prd.html")
shutil.copyfile(ROOT / "Wireframes.html", DOCS / "wireframes.html")
shutil.copyfile(ROOT / "openapi.json", DOCS / "openapi.json")
for old in (DOCS / "templates").glob("*.xlsx"):
    old.unlink()
for f in (ROOT / "docs" / "templates").glob("*.xlsx"):
    if "(contoh)" in f.name or f.name.startswith("~$"):
        continue
    shutil.copyfile(f, DOCS / "templates" / f.name)
print("published to", DOCS.relative_to(ROOT), sorted(p.name for p in DOCS.rglob("*") if p.is_file()))
