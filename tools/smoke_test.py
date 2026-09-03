#!/usr/bin/env python3
"""End-to-end smoke test against a running local server.

Exercises the whole product without a scanner, a POS, or a rack:
reset -> inbound -> pick (including the wrong-shade block) -> opname -> Mode B.

    python tools/smoke_test.py [--base http://localhost:8000]

Everything runs against the training site, so it cannot touch real stock.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:8000"
TRAINING_SITE = 99
ok_count = fail_count = 0


def call(method: str, path: str, body: dict | None = None, expect: int = 200):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except urllib.error.URLError as e:
        print(f"\n  Cannot reach {BASE} — is the server running?\n  {e}")
        sys.exit(1)


def check(label: str, cond: bool, detail: str = ""):
    global ok_count, fail_count
    if cond:
        ok_count += 1
        print(f"  PASS  {label}")
    else:
        fail_count += 1
        print(f"  FAIL  {label}  {detail}")


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    BASE = ap.parse_args().base

    print("\nNinja Kilat WMS — smoke test\n" + "=" * 46)

    print("\n[0] Platform")
    st, health = call("GET", "/health")
    check("health responds", st == 200, str(health))
    check("database connected", health.get("database") is True,
          "set DATABASE_URL and run the migrations")
    st, me = call("GET", "/api/me")
    check("identity resolves", st == 200,
          "set ALLOW_ANONYMOUS_DEV=true for local dev")
    if st != 200:
        sys.exit(1)
    print(f"        signed in as {me['email']} ({me['role']})")

    print("\n[1] Training isolation")
    st, r = call("POST", "/api/training/reset", {"site_id": TRAINING_SITE})
    check("training site resets", st == 200, str(r))
    baskets = r.get("fixture", {}).get("baskets_restocked", 0)
    print(f"        {baskets} baskets restocked")
    st, r = call("POST", "/api/training/reset", {"site_id": 2})
    check("reset REFUSED on a live site", st == 403,
          f"expected 403, got {st} — this is a safety guard")

    print("\n[2] Master data + scanning")
    st, skus = call("GET", "/api/skus?limit=5")
    check("SKUs seeded", st == 200 and skus["total"] > 100, f"total={skus.get('total')}")
    st, sheet = call("GET", f"/api/training/barcode-sheet?site_id={TRAINING_SITE}&limit=5")
    check("test barcode sheet prints", st == 200 and len(sheet["rows"]) > 0)
    if not sheet.get("rows"):
        sys.exit(1)
    first = sheet["rows"][0]
    st, res = call("GET",
                   f"/api/scan/resolve?code={first['barcode']}&site_id={TRAINING_SITE}")
    check("barcode resolves to a SKU", st == 200 and res["found"],
          json.dumps(res)[:120])
    check("resolve returns a location", bool(res.get("slot_location_code")))
    print(f"        {first['sku_name']} -> {res.get('slot_location_code')}")
    st, res = call("GET", f"/api/scan/resolve?code=0000000000000&site_id={TRAINING_SITE}")
    check("unknown barcode is handled, not an error", st == 200 and not res["found"])

    print("\n[3] Inbound")
    st, receipt = call("POST", "/api/receipts",
                       {"site_id": TRAINING_SITE, "source_type": "from_brand"})
    check("receipt opens", st == 201, str(receipt))
    rid = receipt["id"]
    st, scan = call("POST", f"/api/receipts/{rid}/scan",
                    {"code": first["barcode"], "qty": 10,
                     "idempotency_key": "smoke-in-1"})
    check("scan puts stock away", st == 200 and scan["accepted"], str(scan)[:160])
    print(f"        {scan.get('message')}")
    st, replay = call("POST", f"/api/receipts/{rid}/scan",
                      {"code": first["barcode"], "qty": 10,
                       "idempotency_key": "smoke-in-1"})
    check("replayed scan does NOT double-count",
          replay.get("qty_in_basket") == scan.get("qty_in_basket"),
          f"{scan.get('qty_in_basket')} vs {replay.get('qty_in_basket')}")
    st, summary = call("POST", f"/api/receipts/{rid}/complete")
    check("receipt completes", st == 200)
    check("24h discrepancy deadline is set",
          bool(summary.get("discrepancy_deadline")))

    print("\n[4] Picking, and the shade gate")
    st, gen = call("POST", "/api/training/orders/generate",
                   {"site_id": TRAINING_SITE, "count": 1, "max_lines": 2})
    check("test order generated", st == 200 and gen["created"], str(gen)[:140])
    st, tasks = call("GET", f"/api/pick-tasks?site_id={TRAINING_SITE}&status=ready")
    check("pick task is queued", st == 200 and len(tasks["tasks"]) > 0)
    if not tasks["tasks"]:
        sys.exit(1)
    task = tasks["tasks"][0]
    st, task = call("POST", f"/api/pick-tasks/{task['id']}/claim")
    check("task claims", st == 200 and task["claimed_by"], str(task)[:120])

    line = task["lines"][0]
    print(f"        line 1: {line['sku_name']} x{line['qty_required']} "
          f"@ {line['location_code']}")

    wrong = next((r for r in sheet["rows"] if r["sku_id"] != line["sku_id"]), None)
    if wrong:
        st, res = call("POST", f"/api/pick-lines/{line['id']}/confirm",
                       {"code": wrong["barcode"], "qty": 1})
        check("WRONG shade is blocked",
              st == 200 and not res["accepted"] and res["outcome"] == "wrong_sku",
              str(res)[:160])
        print(f"        blocked: {res.get('message', '')[:80]}")

    right = await_barcode(line["sku_id"])
    if right:
        st, res = call("POST", f"/api/pick-lines/{line['id']}/confirm",
                       {"code": right, "qty": line["qty_required"],
                        "idempotency_key": "smoke-pick-1"})
        check("correct scan picks the line", st == 200 and res["accepted"],
              str(res)[:160])

    print("\n[5] Stock opname")
    st, plan = call("POST", "/api/opname/plans",
                    {"site_id": TRAINING_SITE, "name": "Smoke test",
                     "rack_codes": ["A"]})
    check("opname plan created", st == 201, str(plan)[:140])
    st, detail = call("GET", f"/api/opname/plans/{plan['id']}")
    check("plan lists baskets", st == 200 and detail["plan"]["total_baskets"] > 0)
    basket = detail["baskets"][0]
    st, session = call("POST", "/api/opname/sessions",
                       {"plan_id": plan["id"], "basket_id": basket["basket_id"]})
    check("basket claims for counting", st == 201, str(session)[:140])
    check("expected qty is HIDDEN during the count",
          "qty_expected" not in session,
          "showing it invites confirming instead of counting")
    st, dup = call("POST", "/api/opname/sessions",
                   {"plan_id": plan["id"], "basket_id": basket["basket_id"]})
    check("re-claim by the same person is allowed", dup is not None)

    bc = await_barcode(basket["sku_id"])
    if bc:
        for i in range(3):
            call("POST", f"/api/opname/sessions/{session['id']}/scan",
                 {"code": bc, "idempotency_key": f"smoke-count-{i}"})
        st, fin = call("POST", f"/api/opname/sessions/{session['id']}/finish", {})
        check("finish reveals the variance", st == 200 and "variance" in fin,
              str(fin)[:140])
        print(f"        expected {fin['qty_expected']}, counted "
              f"{fin['qty_counted']}, variance {fin['variance']:+d}")
        check("a variance does NOT auto-adjust stock",
              fin.get("needs_recount") is not None)

    print("\n[6] Mode B — license plates")
    st, r = call("POST", "/api/training/load",
                 {"site_id": TRAINING_SITE, "scenario": "mode_b"})
    check("mode_b scenario loads", st == 200, str(r)[:140])
    st, rng = call("POST", "/api/plates/ranges",
                   {"site_id": TRAINING_SITE, "count": 20})
    check("plate range issues", st == 201, str(rng)[:140])
    if st == 201:
        st, stock = call("GET", f"/api/plates/stock?site_id={TRAINING_SITE}")
        check("unbound plates counted", st == 200 and stock["unbound"] >= 20)
        st, skus_b = call("GET", "/api/skus?brand_id=2")
        if skus_b.get("skus"):
            sku_b = skus_b["skus"][0]
            code = rng["codes_sample"][0]
            st, bind = call("POST", "/api/plates/bind",
                            {"site_id": TRAINING_SITE, "sku_id": sku_b["id"],
                             "plate_code": code,
                             "idempotency_key": "smoke-bind-1"})
            check("plate binds and puts away", st == 200 and bind["accepted"],
                  str(bind)[:160])
            st, again = call("POST", "/api/plates/bind",
                             {"site_id": TRAINING_SITE, "sku_id": sku_b["id"],
                              "plate_code": code})
            check("re-binding a used plate is BLOCKED",
                  not again.get("accepted") and again.get("outcome") == "already_bound",
                  str(again)[:140])

    print("\n" + "=" * 46)
    print(f"  {ok_count} passed, {fail_count} failed\n")
    sys.exit(1 if fail_count else 0)


def await_barcode(sku_id: int | None) -> str | None:
    """Fetch a scannable barcode for a SKU (Mode A seed data)."""
    if not sku_id:
        return None
    st, sheet = call("GET",
                     f"/api/training/barcode-sheet?site_id={TRAINING_SITE}&limit=500")
    if st != 200:
        return None
    for row in sheet["rows"]:
        if row["sku_id"] == sku_id:
            return row["barcode"]
    return None


if __name__ == "__main__":
    main()
