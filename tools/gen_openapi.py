#!/usr/bin/env python3
"""Generate openapi.json at the project root from the FastAPI app.

The app is the authority here: every endpoint declares a Pydantic response
model, so the harvested schemas carry real field names and types rather than
"object, any fields". This file ships with the deploy and becomes the app's
published API description in the Substrait API Library — regenerate it whenever
routes or shapes change.

    python tools/gen_openapi.py
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

# The MySQL driver is not needed to describe the API, and is not installed on
# every machine that might regenerate this file.
_stub = type(sys)("asyncmy")
_stub.create_pool = None
sys.modules.setdefault("asyncmy", _stub)
_cursors = type(sys)("asyncmy.cursors")
_cursors.DictCursor = object
sys.modules.setdefault("asyncmy.cursors", _cursors)

from main import app  # noqa: E402


# Where a handler has no docstring, FastAPI falls back to the function name
# ("List Brands"), which restates the path instead of saying what it does.
SUMMARIES = {
    ("get", "/health"): "Readiness probe — reports liveness and database connectivity",
    ("get", "/api/me"): "Who the signed-in user is, their role, and the sites they may work at",
    ("get", "/api/brands"): "List every brand Ninja fulfils for",
    ("post", "/api/brands"): "Onboard a new brand and set its default identity mode",
    ("get", "/api/skus"): "Search a brand's SKUs by name or code",
    ("post", "/api/skus"): "Create one SKU under a brand",
    ("get", "/api/scan/resolve"):
        "Resolve any scanned code to either a SKU (Mode A) or one physical unit (Mode B)",
    ("get", "/api/sites"): "List the stations and hubs the user may work at",
    ("post", "/api/sites"): "Register a new station, hub, or training site",
    ("post", "/api/receipts"): "Open an inbound receipt against a brand delivery or a hub transfer",
    ("post", "/api/receipts/{receipt_id}/complete"):
        "Close a receipt and start the 24-hour discrepancy clock",
    ("get", "/api/receipts/{receipt_id}/summary"):
        "What a receipt took in, with expected-versus-received variance",
    ("get", "/api/plates/stock"): "How many unbound license plates a site has left",
    ("get", "/api/plates/{code}"): "Where one license-plated unit is, and its history",
    ("get", "/api/pick-tasks"): "Pick tasks waiting at a station",
    ("post", "/api/pick-tasks/{task_id}/complete"):
        "Finish a pick task and hand the order to the packing station",
    ("post", "/api/opname/plans"): "Create a stock-count plan over a site's baskets",
    ("get", "/api/opname/plans/{plan_id}"):
        "A count plan's progress, and every basket in it",
    ("get", "/api/training/scenarios"): "The training fixture library",
    ("get", "/api/inventory"): "On-hand stock at a site, by SKU and location",
    ("post", "/api/skus/import"):
        "Bulk-import a brand's SKUs from CSV — preview by default, commit on request",
    ("post", "/api/slots"):
        "Give a SKU its basket at a site — one SKU per basket, one basket per SKU",
    ("post", "/api/receipts/{receipt_id}/scan"):
        "Scan a unit into a receipt and be told which basket it goes in",
    ("post", "/api/plates/bind"):
        "Bind a freshly-applied license plate to a SKU and put the unit away in one action",
    ("post", "/api/plates/{code}/unbind"):
        "Release a license plate so the label can be peeled and reused",
    ("post", "/api/pick-lines/{line_id}/confirm"):
        "Confirm a pick by scanning — blocks the wrong shade before it reaches the bag",
    ("get", "/api/movements"):
        "The append-only stock ledger — what moved, when, and who moved it",
    ("post", "/api/training/reset"):
        "Restore a training site to a known state, deterministically",
}


def first_sentence(text: str) -> str:
    """The opening sentence of a docstring, as a one-line summary."""
    line = (text or "").strip().split("\n")[0].strip()
    for sep in (". ", " — ", "; "):
        if sep in line:
            line = line.split(sep)[0].strip()
            break
    return line.rstrip(".")


def main() -> None:
    spec = app.openapi()

    # FastAPI derives a summary from the function name ("List Brands"). Where the
    # handler has a docstring, its opening line says more.
    for path, ops in spec.get("paths", {}).items():
        for verb, op in ops.items():
            override = SUMMARIES.get((verb.lower(), path))
            if override:
                op["summary"] = override
                continue
            desc = op.get("description")
            if desc:
                s = first_sentence(desc)
                if len(s) > 8:
                    op["summary"] = s

    spec["info"]["contact"] = {"name": "Ninja Van — Kilat fulfilment"}

    out = ROOT / "openapi.json"
    out.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")

    paths = spec["paths"]
    ops = sum(len(v) for v in paths.values())
    schemas = len(spec.get("components", {}).get("schemas", {}))
    size_kb = out.stat().st_size / 1024
    print(f"wrote openapi.json: {len(paths)} paths, {ops} operations, "
          f"{schemas} schemas, {size_kb:.0f} KB")

    missing = [f"{v.upper()} {p}" for p, ops_ in paths.items()
               for v, o in ops_.items() if not o.get("summary")]
    if missing:
        print("WARNING: operations with no summary:", ", ".join(missing))


if __name__ == "__main__":
    main()
