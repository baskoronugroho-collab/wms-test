"""Pengaturan: Hub & mulai operasi, and Aturan & waktu (canvas section 2).

Three parts, all read by every role (every role sees every menu) and changed by
the role each part names:

* **Hub** (canvas 2a). A hub arrives from Hiryu by itself (message 6, agent L
  makes the `sites` row with a placeholder code HY<dark store id>). Its name,
  address and hours stay read-only here. Ops HQ completes only what the WMS
  needs: the hub code (MA5) and how many temporary inbound bins, quarantine
  trays and outbound baskets it has. Saving makes the special bins
  (MA5-IN-01 ..., MA5-QR-01, MA5-OUT-01 ...), whose labels are printed on
  Rak & bin.

* **Mulai operasi** (canvas 2c). The kick-off checklist per hub, phases A to E,
  21 steps. The WMS ticks every step it can see by itself, from its own data and
  from what Hiryu sent; the others are ticked by hand (*Tandai selesai*), with who
  and when. A step whose data is not deployed yet (another agent's column) falls
  back to a hand tick instead of failing.

* **Aturan & waktu**. The reminder and timing rules (`alert_rules`), grouped for
  the page. The labels of the older rules live in `reminders.RULES`; new keys go
  in `NEW_RULES` below and their row is seeded in the owner's migration.
"""
import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import auth
import db
import ledger
from routers import locations, racks, reminders

router = APIRouter(prefix="/api", tags=["pengaturan"])

_CODE_OK = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
_DAYS = (("mon", "Sen"), ("tue", "Sel"), ("wed", "Rab"), ("thu", "Kam"), ("fri", "Jum"),
         ("sat", "Sab"), ("sun", "Min"))


def _iso(v) -> str | None:
    return racks.iso(v)


def _wib_date(v) -> str | None:
    return racks.wib_date_text(v + timedelta(hours=7)) if v else None


def hours_text(raw: str | None) -> str | None:
    """'Setiap hari, 08:00 sampai 22:00 WIB' from Hiryu's opening_hours JSON."""
    if not raw:
        return None
    try:
        hours = json.loads(raw)
    except (TypeError, ValueError):
        return None

    def day(periods):
        if not periods:
            return "tutup"
        return ", ".join(f"{p.get('open')} sampai {p.get('close')}" for p in periods)

    texts = [(label, day(hours.get(key) or [])) for key, label in _DAYS]
    if len({t for _, t in texts}) == 1:
        return f"Setiap hari, {texts[0][1]} WIB" if texts[0][1] != "tutup" else "Tutup"
    return "; ".join(f"{label} {t}" for label, t in texts) + " (WIB)"


# =============================================================================
# Hub (canvas 2a)
# =============================================================================

class HubCompleteIn(BaseModel):
    code: str = Field(description="Kode hub, e.g. MA5: 2 to 8 letters or digits")
    inbound_bins: int = Field(description="Bin barang masuk sementara")
    quarantine_trays: int = Field(description="Baki karantina, at least 1")
    outbound_baskets: int = Field(description="Keranjang pesanan")


async def _hub(site_id: int) -> dict:
    row = await db.fetch_one(
        "SELECT id, code, name, address, site_type, is_training, active, created_at, "
        "       hiryu_dark_store_id, opening_hours_json, hiryu_received_at, "
        "       setup_completed_at, setup_completed_by, inbound_bins, quarantine_trays, "
        "       outbound_baskets FROM sites WHERE id = %s", (site_id,))
    if not row:
        raise HTTPException(404, "Dark store tidak ditemukan. / Dark store not found.")
    return row


def _codes_text(code: str, n_in: int, n_qr: int, n_out: int) -> str:
    def span(kind, n):
        if n <= 0:
            return None
        first = locations.special_bin_code(code, kind, 1)
        return first if n == 1 else f"{first} sampai {locations.special_bin_code(code, kind, n)}"
    parts = [p for p in (span("IN", n_in), span("QR", n_qr), span("OUT", n_out)) if p]
    if not parts:
        return ""
    joined = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " dan " + parts[-1]
    return f"Setelah disimpan, WMS membuat {joined}. Labelnya dicetak di Rak & bin."


async def hub_payload(row: dict) -> dict:
    special = await locations.special_bins_of(row["id"])
    n = {k: sum(1 for b in special if b["kind"] == k) for k in locations.SPECIAL_KINDS}
    from_hiryu = row["hiryu_dark_store_id"] is not None
    is_new = from_hiryu and row["setup_completed_at"] is None
    has_bins = await db.fetch_one("SELECT 1 AS x FROM locations WHERE site_id = %s LIMIT 1",
                                  (row["id"],))
    code = row["code"]
    return {
        "id": row["id"], "code": code, "name": row["name"], "address": row["address"],
        "is_training": bool(row["is_training"]), "active": bool(row["active"]),
        "from_hiryu": from_hiryu, "hiryu_dark_store_id": row["hiryu_dark_store_id"],
        "opening_hours": json.loads(row["opening_hours_json"]) if row["opening_hours_json"]
        else None,
        "opening_hours_text": hours_text(row["opening_hours_json"]),
        "hiryu_received_at": _iso(row["hiryu_received_at"]),
        "new_from_hiryu": is_new,
        "banner": (f"Baru dari Hiryu: {row['name']} (dark store #{row['hiryu_dark_store_id']})"
                   if is_new else None),
        # The code is set once: bin codes carry it, so it is fixed once any bin exists.
        "code_editable": not has_bins,
        # A new dark store may be a hub the WMS already runs: Sambungkan ke hub yang ada.
        "link_targets": await link_targets() if is_new else [],
        "setup_completed_at": _iso(row["setup_completed_at"]),
        "setup_completed_by": row["setup_completed_by"],
        "inbound_bins": n["IN"], "quarantine_trays": n["QR"], "outbound_baskets": n["OUT"],
        "special_codes_text": _codes_text(code, n["IN"], n["QR"], n["OUT"]) if not is_new else "",
    }


@router.get("/hubs")
async def list_hubs(user: auth.User = Depends(auth.current_user)):
    """Hubs the caller works at (every hub from Ops HQ up), new ones from Hiryu first."""
    rows = await db.fetch_all(
        "SELECT id, code, name, address, site_type, is_training, active, created_at, "
        "       hiryu_dark_store_id, opening_hours_json, hiryu_received_at, "
        "       setup_completed_at, setup_completed_by, inbound_bins, quarantine_trays, "
        "       outbound_baskets FROM sites WHERE active = 1 AND site_type <> 'hub' "
        "ORDER BY (hiryu_dark_store_id IS NOT NULL AND setup_completed_at IS NULL) DESC, "
        "         is_training, code")
    if not user.at_least("hq"):
        mine = {int(r["site_id"]) for r in await db.fetch_all(
            "SELECT site_id FROM user_sites WHERE user_id = %s", (user.id,))}
        rows = [r for r in rows if int(r["id"]) in mine]
    return {"hubs": [await hub_payload(r) for r in rows], "can_edit": user.at_least("hq"),
            "intro": "Dark store dibuat di Hiryu dan muncul di sini sendiri. Di WMS Anda hanya "
                     "melengkapi data gudang."}


@router.get("/hubs/{site_id}")
async def get_hub(site_id: int, user: auth.User = Depends(auth.current_user)):
    """One hub: the read-only part from Hiryu and the WMS part (canvas 2a)."""
    await auth.assert_site_access(user, site_id)
    return await hub_payload(await _hub(site_id))


@router.get("/hubs/{site_id}/preview-codes")
async def preview_codes(site_id: int, code: str, inbound_bins: int = 0,
                        quarantine_trays: int = 1, outbound_baskets: int = 0,
                        user: auth.User = Depends(auth.current_user)):
    """The line under the form: which special-bin codes Simpan hub would make."""
    await auth.assert_site_access(user, site_id)
    return {"text": _codes_text(code.strip().upper() or "HUB", inbound_bins, quarantine_trays,
                                outbound_baskets)}


@router.put("/hubs/{site_id}/complete")
async def complete_hub(site_id: int, body: HubCompleteIn,
                       user: auth.User = Depends(auth.require("hq"))):
    """Simpan hub: set the hub code and the special bins' numbers. Making the code
    final ends "Baru dari Hiryu". The numbers can be changed again later; going
    down only works while the last bin is empty."""
    await auth.assert_site_access(user, site_id)
    row = await _hub(site_id)
    code = (body.code or "").strip().upper()
    if not 2 <= len(code) <= 8 or not set(code) <= _CODE_OK:
        raise HTTPException(422, "Kode dark store: 2 sampai 8 huruf atau angka, misalnya MA5. / "
                                 "Dark store code: 2 to 8 letters or digits, e.g. MA5.")
    if code.startswith("HY") and row["hiryu_dark_store_id"] is not None and \
            code == row["code"] and row["setup_completed_at"] is None:
        raise HTTPException(422, "Isi kode dark store yang dipakai di gudang, misalnya MA5. / "
                                 "Enter the dark store's real code, e.g. MA5.")
    for label, v, lo in (("Bin barang masuk sementara", body.inbound_bins, 1),
                         ("Baki karantina", body.quarantine_trays, 1),
                         ("Keranjang pesanan", body.outbound_baskets, 1)):
        if not lo <= v <= locations.SPECIAL_MAX:
            raise HTTPException(422, f"{label}: isi {lo} sampai {locations.SPECIAL_MAX}. / "
                                     f"{label}: {lo} to {locations.SPECIAL_MAX}.")
    if code != row["code"]:
        if await db.fetch_one("SELECT 1 AS x FROM locations WHERE site_id = %s LIMIT 1",
                              (site_id,)):
            raise HTTPException(409, f"Kode dark store {row['code']} sudah dipakai di kode bin, jadi "
                                     "tidak bisa diganti. / The dark store code is already on bin labels.")
        if await db.fetch_one("SELECT id FROM sites WHERE code = %s AND id <> %s",
                              (code, site_id)):
            raise HTTPException(409, f"Kode dark store {code} sudah dipakai dark store lain. / Dark store code "
                                     f"{code} is taken.")
    want = {"IN": body.inbound_bins, "QR": body.quarantine_trays, "OUT": body.outbound_baskets}
    have = {k: len(await locations.special_bins_of(site_id, k)) for k in want}
    async with db.tx() as cur:
        await db.run(cur, "UPDATE sites SET code = %s, setup_completed_at = "
                          "COALESCE(setup_completed_at, NOW()), setup_completed_by = "
                          "COALESCE(setup_completed_by, %s) WHERE id = %s",
                     (code, user.email, site_id))
        for kind, n in want.items():
            for _ in range(max(0, n - have[kind])):
                await locations.add_special_bin(cur, site_id, kind, user.email)
        await ledger.audit(cur, actor_email=user.email, entity="site", entity_id=site_id,
                           action="complete_hub", before={"code": row["code"]},
                           after={"code": code, **want})
    problems = []
    for kind, n in want.items():
        for _ in range(max(0, have[kind] - n)):
            try:
                await locations.remove_last_special_bin(site_id, kind, user.email)
            except HTTPException as e:
                problems.append(str(e.detail))
                break
    payload = await hub_payload(await _hub(site_id))
    msg = f"Dark store {code} tersimpan."
    if problems:
        msg += " " + " ".join(problems)
    return {"ok": True, "message": msg, "hub": payload}


class HubLinkIn(BaseModel):
    target_site_id: int = Field(description="The existing hub this dark store is")


async def link_targets() -> list[dict]:
    """Existing hubs a new dark store may be linked to: live, not training, and
    not linked to a Hiryu dark store yet."""
    rows = await db.fetch_all(
        "SELECT id, code, name FROM sites WHERE active = 1 AND is_training = 0 "
        "AND site_type <> 'hub' AND hiryu_dark_store_id IS NULL ORDER BY code")
    return [{"id": r["id"], "code": r["code"], "name": r["name"]} for r in rows]


@router.post("/hubs/{site_id}/link")
async def link_hub(site_id: int, body: HubLinkIn,
                   user: auth.User = Depends(auth.require("hq"))):
    """Sambungkan ke hub yang sudah ada: a dark store that arrived from Hiryu is a
    hub the WMS already runs (MA5 before the link existed). The existing hub takes
    the dark store number, name, address and hours; the stores Hiryu attached to
    the new entry move to it, and the new entry is switched off. Allowed only
    while the new entry has nothing of its own (no bins, orders or deliveries)."""
    await auth.assert_site_access(user, site_id)
    new = await _hub(site_id)
    if new["hiryu_dark_store_id"] is None or new["setup_completed_at"] is not None:
        raise HTTPException(409, "Hanya dark store baru dari Hiryu yang belum dilengkapi. / Only a new "
                                 "dark store from Hiryu that was not completed yet.")
    target = await _hub(body.target_site_id)
    if target["id"] == new["id"] or not target["active"] or target["is_training"]:
        raise HTTPException(422, "Pilih dark store lain yang aktif. / Choose another live dark store.")
    if target["hiryu_dark_store_id"] is not None:
        raise HTTPException(409, f"{target['code']} sudah tersambung ke dark store "
                                 f"#{target['hiryu_dark_store_id']}. / Already linked.")
    for table, label in (("locations", "bin"), ("orders", "pesanan"),
                         ("inbound_receipts", "barang masuk"), ("replenishments", "restock")):
        if await db.fetch_one(f"SELECT 1 AS x FROM {table} WHERE site_id = %s LIMIT 1",
                              (site_id,)):
            raise HTTPException(409, f"Dark store baru ini sudah punya {label}, jadi tidak bisa "
                                     "disambungkan. / The new dark store already has its own data.")
    dark_id = new["hiryu_dark_store_id"]
    async with db.tx() as cur:
        # The unique key on hiryu_dark_store_id: free it on the new entry first.
        await db.run(cur, "UPDATE sites SET hiryu_dark_store_id = NULL, active = 0 "
                          "WHERE id = %s", (site_id,))
        await db.run(cur, "UPDATE sites SET hiryu_dark_store_id = %s, name = %s, address = %s, "
                          "opening_hours_json = %s, hiryu_received_at = %s, "
                          "setup_completed_at = COALESCE(setup_completed_at, NOW()), "
                          "setup_completed_by = COALESCE(setup_completed_by, %s) WHERE id = %s",
                     (dark_id, new["name"], new["address"] or target["address"],
                      new["opening_hours_json"], new["hiryu_received_at"], user.email,
                      target["id"]))
        await db.run(cur, "UPDATE hiryu_stores SET site_id = %s WHERE site_id = %s",
                     (target["id"], site_id))
        await db.run(cur, "INSERT INTO user_sites (user_id, site_id) SELECT user_id, %s "
                          "FROM user_sites WHERE site_id = %s "
                          "ON DUPLICATE KEY UPDATE user_sites.user_id = user_sites.user_id",
                     (target["id"], site_id))
        await db.run(cur, "DELETE FROM user_sites WHERE site_id = %s", (site_id,))
        await db.run(cur, "INSERT INTO hub_kickoff_marks (site_id, step_key, done_by, "
                          "done_by_name, done_at, note) SELECT %s, step_key, done_by, "
                          "done_by_name, done_at, note FROM hub_kickoff_marks WHERE site_id = %s "
                          "ON DUPLICATE KEY UPDATE hub_kickoff_marks.site_id = "
                          "hub_kickoff_marks.site_id", (target["id"], site_id))
        await ledger.audit(cur, actor_email=user.email, entity="site", entity_id=target["id"],
                           action="link_dark_store",
                           after={"hiryu_dark_store_id": dark_id, "placeholder_site_id": site_id,
                                  "placeholder_code": new["code"]})
    return {"ok": True, "hub": await hub_payload(await _hub(target["id"])),
            "message": f"Dark store #{dark_id} tersambung ke {target['code']}."}


# =============================================================================
# Mulai operasi (canvas 2c)
# =============================================================================

PHASES = (
    ("A", "Orang dan tempat", "People and place", ""),
    ("B", "Katalog", "Catalogue", ""),
    ("C", "Rak dan label", "Racks and labels", "Daftar rak, cek label, bin khusus, beri bin"),
    ("D", "Stok awal", "Opening stock", "PO pertama, barang masuk pertama"),
    ("E", "Nyalakan", "Switch on", "Link stok, pesanan uji, aktif di Grab, pantau"),
)

# key, phase, title (ID), title (EN), who (roles), systems, mode, screen, guide,
# where (ID), what to do (ID lines), how it is ticked (ID)
STEPS: list[dict] = [
    dict(key="a_dark_store", phase="A", title="Buat dark store di Hiryu",
         title_en="Create the dark store in Hiryu", who=["hq"], systems=["Hiryu"], mode="auto",
         screen=None, guide="S02", where="Hiryu, Dark stores",
         do=["Nama, alamat dan jam buka. Jam buka di sini yang tampil di Grab."],
         auto="Dicentang otomatis saat dark store masuk dari Hiryu."),
    dict(key="a_hub", phase="A", title="Lengkapi dark store di WMS", title_en="Complete the dark store in the WMS",
         who=["hq"], systems=["WMS"], mode="auto", screen="pengaturan.html#hub", guide="S02",
         where="Pengaturan, Dark store & mulai operasi",
         do=["Isi kode dark store, bin barang masuk sementara, baki karantina dan keranjang pesanan.",
             "Tekan Simpan dark store."],
         auto="Dicentang otomatis saat dark store disimpan."),
    dict(key="a_people", phase="A", title="Tambah orang", title_en="Add the people",
         who=["hq", "supervisor"], systems=["Hiryu", "WMS"], mode="auto",
         screen="pengaturan.html#orang", guide="S02", where="Hiryu dulu, lalu Orang & akses",
         do=["Di Hiryu beri MANAGER (SPV) atau STAFF.",
             "Di WMS: email @ninjavan.co, nama, peran, dark store, centang Login Hiryu sudah dibuat."],
         auto="Dicentang otomatis saat dark store punya minimal 1 SPV dan 1 staf."),
    dict(key="a_devices", phase="A", title="Pasang perangkat dan login",
         title_en="Set up the devices and sign in", who=["supervisor"], systems=["Hiryu", "WMS"],
         mode="manual", screen=None, guide="S02", where="Di dark store",
         do=["Dua ponsel dark store, pemindai, laptop packing dengan Hiryu Live Orders, printer struk, "
             "printer A4 untuk label bin.",
             "Atur kedua printer di Pengaturan, Printer: printer struk 80 mm untuk slip Hiryu "
             "dan slip putaway, printer A4 untuk label.",
             "Setiap orang masuk dengan akunnya sendiri."],
         manual="WMS tidak bisa melihat langkah ini. SPV menandainya setelah semua perangkat "
                "terpasang dan setiap orang sudah masuk."),
    dict(key="a_training", phase="A", title="Latih staf", title_en="Train the staff",
         who=["supervisor"], systems=["WMS"], mode="manual", screen="pesanan.html", guide="S02",
         where="Di dark store",
         do=["Latih setiap staf sebelum dark store buka, sesuai jumlah orang per shift.",
             "Setiap orang berlatih dengan pesanan uji di ponselnya sendiri."],
         manual="WMS tidak bisa melihat langkah ini. SPV menandainya setelah cukup staf di tiap "
                "shift sudah dilatih dengan pesanan uji."),
    dict(key="b_brands", phase="B", title="Tambah merek", title_en="Add the brands", who=["hq"],
         systems=["WMS"], mode="auto", screen="produk.html#merek", guide="S02",
         where="Produk, Merek, Tambah merek",
         do=["Nama merek, perusahaan, email kontak restock, barcode di kemasan, akun merchant Grab.",
             "Tambah merek sebelum tokonya dibuat di Hiryu."],
         auto="Dicentang otomatis saat setiap toko di dark store punya merek yang terdaftar."),
    dict(key="b_stores", phase="B", title="Buat toko di Hiryu", title_en="Create the stores in Hiryu",
         who=["hq"], systems=["Hiryu"], mode="auto", screen=None, guide="S02",
         where="Hiryu, Stores",
         do=["Satu toko untuk satu merek, pasang ke dark store ini.", "Terima pesanan: MANUAL."],
         auto="Dicentang otomatis saat toko masuk dari Hiryu."),
    dict(key="b_store_brand", phase="B", title="Pilih merek toko", title_en="Pick each store's brand",
         who=["hq"], systems=["WMS"], mode="auto", screen="menu-toko-hiryu.html", guide="S02",
         where="Menu & toko Hiryu",
         do=["Pilih merek dan akun merchant Grab untuk setiap toko baru, lalu Simpan."],
         auto="Dicentang otomatis saat setiap toko di dark store punya merek."),
    dict(key="b_menus", phase="B", title="Buat menu tiap toko di Hiryu",
         title_en="Build each store's menu in Hiryu", who=["hq"], systems=["Hiryu"], mode="auto",
         screen="menu-toko-hiryu.html", guide="S02", where="Hiryu, Menus",
         do=["Satu menu per toko. Untuk memakai ulang: Export CSV lalu Import CSV."],
         auto="Dicentang otomatis saat setiap toko punya menu dengan item."),
    dict(key="b_bundles", phase="B", title="Buat SKU dan Bundles",
         title_en="Create the SKUs and Bundles", who=["hq"], systems=["Hiryu"], mode="auto",
         screen="menu-toko-hiryu.html", guide="S02", where="Hiryu, SKUs dan Bundles",
         do=["Sambungkan setiap item menu ke SKU-nya. Item tanpa SKU tidak bisa diambil."],
         auto="Dicentang otomatis saat Item tanpa SKU di dark store ini 0."),
    dict(key="b_sku_data", phase="B", title="Lengkapi data SKU", title_en="Complete the SKU data",
         who=["hq"], systems=["WMS"], mode="auto", screen="produk.html?filter=no_size",
         guide="S02", where="Produk, filter Tanpa ukuran bin",
         do=["Pilih Kecil atau Besar untuk tiap SKU. Ini wajib.",
             "Belum ada barcode: Pindai satu unit, atau Tempel kode.",
             "Data lain boleh diisi nanti, di tabel atau lewat CSV."],
         auto="Dicentang otomatis. Langkah ini selesai sendiri saat semua SKU punya ukuran bin."),
    dict(key="c_racks", phase="C", title="Daftar rak", title_en="Register the racks",
         who=["supervisor"], systems=["WMS"], mode="auto", screen="rak-bin.html", guide="S03",
         where="Rak & bin, Tambah rak",
         do=["Isi rak persis seperti yang berdiri: level, kolom, bin dan ukurannya."],
         auto="Dicentang otomatis saat dark store punya rak dengan bin."),
    dict(key="c_labels", phase="C", title="Cetak dan cek label", title_en="Print and check the labels",
         who=["supervisor", "staff"], systems=["WMS"], mode="auto",
         screen="rak-bin.html#cek-label", guide="S03", where="Rak & bin, Cetak label, Cek label",
         do=["Cetak di kertas A4 biasa, gunting, tempel dengan selotip bening.",
             "Pindai setiap label sekali dengan ponsel."],
         auto="Dicentang otomatis saat semua label rak cocok."),
    dict(key="c_special", phase="C", title="Bin khusus", title_en="Special bins",
         who=["supervisor"], systems=["WMS"], mode="auto", screen="rak-bin.html#bin-khusus",
         guide="S03", where="Rak & bin, Bin khusus",
         do=["Atur jumlah bin barang masuk sementara, baki karantina dan keranjang pesanan.",
             "Cetak labelnya."],
         auto="Dicentang otomatis saat ketiganya ada dan labelnya sudah dicetak."),
    dict(key="c_assign", phase="C", title="Beri bin", title_en="Give every SKU its bin",
         who=["supervisor"], systems=["WMS"], mode="auto", screen="rak-bin.html#perlu-bin",
         guide="S03", where="Rak & bin, Perlu bin",
         do=["Beri setiap SKU yang punya ukuran bin satu bin kosong dengan ukuran yang sama."],
         auto="Dicentang otomatis saat Perlu bin 0."),
    dict(key="d_po", phase="D", title="PO pertama", title_en="The first PO", who=["hq"],
         systems=["WMS"], mode="auto", screen="restock.html", guide="S04",
         where="Restock ke merek",
         do=["Buat dan kirim PO pertama ke setiap merek."],
         auto="Dicentang otomatis saat PO pertama terkirim ke merek."),
    dict(key="d_inbound", phase="D", title="Barang masuk pertama", title_en="The first delivery",
         who=["supervisor", "staff"], systems=["WMS"], mode="auto", screen="barang-masuk.html",
         guide="S05", where="Barang masuk",
         do=["Terima kiriman pertama, pindai setiap unit, simpan ke rak."],
         auto="Dicentang otomatis saat barang masuk pertama selesai."),
    dict(key="e_link", phase="E", title="Nyalakan link stok", title_en="Switch on the stock link",
         who=["hq"], systems=["WMS", "Hiryu"], mode="auto", screen="pengaturan.html#integrasi",
         guide="S02", where="Pengaturan, Integrasi Hiryu",
         do=["Bersama Shaun: nyalakan link untuk toko. WMS mengirim seluruh stok.",
             "Buka 3 SKU di Hiryu dan cek angkanya sama dengan WMS (tersedia dikurangi Cadangan "
             "Grab)."],
         auto="Dicentang otomatis saat link setiap toko di dark store menyala."),
    dict(key="e_test_orders", phase="E", title="Latihan pesanan uji", title_en="Test orders",
         who=["supervisor", "hq"], systems=["WMS"], mode="auto", screen="pesanan.html",
         guide="S02", where="Pesanan, Buat pesanan uji",
         do=["Pesanan uji hanya di WMS, ditandai UJI, tidak sampai ke Hiryu atau Grab.",
             "Ambil, kemas, serahkan, lalu Kembalikan ke rak."],
         auto="Dicentang otomatis saat pesanan uji pertama sudah diserahkan."),
    dict(key="e_grab", phase="E", title="Aktifkan toko di Grab", title_en="Activate the stores on Grab",
         who=["hq"], systems=["Hiryu", "Grab"], mode="auto", screen="menu-toko-hiryu.html",
         guide="S02", where="Hiryu, dengan login manajer Grab outlet",
         do=["Cek menu Synced di Hiryu dan jam buka tampil di Grab.",
             "Aktifkan hanya bila semua langkah sebelumnya Selesai."],
         auto="Dicentang otomatis saat setiap toko di dark store Aktif di Grab."),
    dict(key="e_watch", phase="E", title="Pantau pesanan pertama",
         title_en="Watch the first real orders", who=["supervisor", "hq"],
         systems=["Hiryu", "WMS"], mode="manual", screen="pesanan.html", guide="S02",
         where="Di dark store",
         do=["Dampingi picker dan packer pada pesanan Grab pertama tiap toko.",
             "Bereskan masalah di hari yang sama."],
         manual="SPV atau Ops HQ menandainya setelah pesanan pertama tiap toko diserahkan."),
]
_STEP = {s["key"]: s for s in STEPS}


async def _one(sql: str, params: tuple) -> dict | None:
    return await db.fetch_one(sql, params)


async def _check(key: str, site: dict) -> tuple[str, str | None] | None:
    """(status, detail) for an auto step, or None when the WMS cannot tell
    (the data it reads is not there yet): the step is then ticked by hand."""
    sid = site["id"]
    if key == "a_dark_store":
        if site["hiryu_dark_store_id"] is None:
            return None
        return "selesai", f"dark store #{site['hiryu_dark_store_id']}"
    if key == "a_hub":
        if site["setup_completed_at"]:
            return "selesai", None
        return "belum", None
    if key == "a_people":
        r = await _one(
            "SELECT SUM(CASE WHEN u.role = 'supervisor' THEN 1 ELSE 0 END) AS spv, "
            "       SUM(CASE WHEN u.role IN ('staff','hub_operator') THEN 1 ELSE 0 END) AS staf "
            "FROM users u JOIN user_sites us ON us.user_id = u.id "
            "WHERE us.site_id = %s AND u.active = 1", (sid,))
        spv, staf = int(r["spv"] or 0), int(r["staf"] or 0)
        detail = f"{spv} SPV, {staf} Staf"
        if spv and staf:
            return "selesai", detail
        return ("sedang" if spv or staf else "belum"), detail
    if key == "b_brands":
        r = await _one(
            "SELECT COUNT(*) AS n, SUM(CASE WHEN b.id IS NULL THEN 1 ELSE 0 END) AS missing "
            "FROM hiryu_stores hs LEFT JOIN brands b ON b.id = hs.brand_id AND b.active = 1 "
            "WHERE hs.site_id = %s AND hs.active = 1", (sid,))
        if int(r["n"] or 0) == 0:
            b = await _one("SELECT COUNT(*) AS n FROM brands WHERE active = 1 "
                           "AND grab_account IS NOT NULL", ())
            return ("sedang" if int(b["n"] or 0) else "belum"), f"{int(b['n'] or 0)} merek"
        return ("selesai" if not int(r["missing"] or 0) else "sedang"), None
    if key == "b_stores":
        r = await _one("SELECT COUNT(*) AS n FROM hiryu_stores WHERE site_id = %s AND active = 1",
                       (sid,))
        n = int(r["n"] or 0)
        return ("selesai" if n else "belum"), f"{n} toko"
    if key == "b_store_brand":
        r = await _one(
            "SELECT COUNT(*) AS n, SUM(CASE WHEN brand_id IS NULL OR brand_id = 0 THEN 1 ELSE 0 "
            "END) AS open_n FROM hiryu_stores WHERE site_id = %s AND active = 1", (sid,))
        n, open_n = int(r["n"] or 0), int(r["open_n"] or 0)
        if not n:
            return "belum", None
        return ("selesai" if not open_n else "sedang"), (f"{open_n} toko belum dipilih"
                                                          if open_n else None)
    if key == "b_menus":
        r = await _one(
            "SELECT COUNT(*) AS n, SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM hiryu_items hi "
            "  WHERE hi.hiryu_store_no = hs.hiryu_store_no AND hi.active = 1) THEN 1 ELSE 0 END) "
            "  AS empty_n FROM hiryu_stores hs WHERE hs.site_id = %s AND hs.active = 1", (sid,))
        n, empty = int(r["n"] or 0), int(r["empty_n"] or 0)
        if not n:
            return "belum", None
        if empty == n:
            return "belum", "Belum ada menu"
        return ("selesai" if not empty else "sedang"), (f"{empty} toko tanpa menu" if empty
                                                        else None)
    if key == "b_bundles":
        r = await _one(
            "SELECT COUNT(*) AS n, SUM(CASE WHEN hi.sku_id IS NULL THEN 1 ELSE 0 END) AS loose "
            "FROM hiryu_items hi JOIN hiryu_stores hs ON hs.hiryu_store_no = hi.hiryu_store_no "
            "WHERE hs.site_id = %s AND hs.active = 1 AND hi.active = 1", (sid,))
        n, loose = int(r["n"] or 0), int(r["loose"] or 0)
        if not n:
            return "belum", None
        return ("selesai" if not loose else "sedang"), (f"{loose} item tanpa SKU" if loose
                                                        else None)
    if key == "b_sku_data":
        r = await _one(
            "SELECT COUNT(*) AS n, SUM(CASE WHEN s.bin_size IS NULL THEN 1 ELSE 0 END) AS open_n "
            "FROM skus s JOIN brands b ON b.id = s.brand_id JOIN sites st ON st.id = %s "
            f"WHERE s.active = 1 AND b.active = 1 AND {racks.CARRIED_SQL}", (sid,))
        n, open_n = int(r["n"] or 0), int(r["open_n"] or 0)
        if not n:
            return "belum", None
        return ("selesai" if not open_n else "sedang"), (
            f"Sekarang: {open_n} SKU tanpa ukuran bin" if open_n else f"{n} SKU punya ukuran bin")
    if key == "c_racks":
        r = await _one(
            "SELECT COUNT(DISTINCT r.id) AS racks, COUNT(l.id) AS bins FROM racks r "
            "JOIN levels lv ON lv.rack_id = r.id JOIN locations l ON l.level_id = lv.id "
            "WHERE r.site_id = %s", (sid,))
        n = int(r["bins"] or 0)
        return ("selesai" if n else "belum"), (f"{int(r['racks'])} rak, {n} bin" if n else None)
    if key == "c_labels":
        r = await _one(
            "SELECT COUNT(l.id) AS n, SUM(CASE WHEN l.label_check_state = 'ok' THEN 1 ELSE 0 END) "
            "AS ok FROM racks r JOIN levels lv ON lv.rack_id = r.id "
            "JOIN locations l ON l.level_id = lv.id WHERE r.site_id = %s", (sid,))
        n, ok = int(r["n"] or 0), int(r["ok"] or 0)
        if not n:
            return "belum", None
        return ("selesai" if ok == n else "sedang" if ok else "belum"), f"{ok} dari {n}"
    if key == "c_special":
        rows = await locations.special_bins_of(sid)
        kinds = {b["kind"] for b in rows}
        printed = all(b["label_printed_at"] for b in rows) if rows else False
        if kinds == set(locations.SPECIAL_KINDS) and printed:
            return "selesai", None
        return ("sedang" if rows else "belum"), ("Label belum dicetak" if rows and not printed
                                                 else None)
    if key == "c_assign":
        need = await racks._needs_rack(sid, count_only=True)
        r = await _one("SELECT COUNT(*) AS n FROM slot_assignments WHERE site_id = %s "
                       "AND slot_role = 'primary'", (sid,))
        have = int(r["n"] or 0)
        if not need and have:
            return "selesai", f"{have} SKU punya bin"
        return ("sedang" if have else "belum"), (f"{need} SKU perlu bin" if need else None)
    if key == "d_po":
        r = await _one(
            "SELECT SUM(CASE WHEN status IN ('sent','confirmed','receiving','variance_review',"
            "'variance_signoff','received') THEN 1 ELSE 0 END) AS sent_n, "
            "SUM(CASE WHEN status IN ('draft','raised','po') THEN 1 ELSE 0 END) AS open_n "
            "FROM replenishments WHERE site_id = %s", (sid,))
        if int(r["sent_n"] or 0):
            return "selesai", None
        return ("sedang" if int(r["open_n"] or 0) else "belum"), None
    if key == "d_inbound":
        r = await _one(
            "SELECT SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done_n, "
            "COUNT(*) AS n FROM inbound_receipts WHERE site_id = %s", (sid,))
        if int(r["done_n"] or 0):
            return "selesai", None
        return ("sedang" if int(r["n"] or 0) else "belum"), None
    if key == "e_link":
        r = await _one("SELECT COUNT(*) AS n, SUM(CASE WHEN link_on = 1 THEN 1 ELSE 0 END) AS on_n "
                       "FROM hiryu_stores WHERE site_id = %s AND active = 1", (sid,))
        n, on = int(r["n"] or 0), int(r["on_n"] or 0)
        if not n:
            return "belum", None
        return ("selesai" if on == n else "sedang" if on else "belum"), f"{on} dari {n} toko"
    if key == "e_test_orders":
        r = await _one("SELECT COUNT(*) AS n, SUM(CASE WHEN handed_over_at IS NOT NULL THEN 1 "
                       "ELSE 0 END) AS done_n FROM orders WHERE site_id = %s AND is_test = 1",
                       (sid,))
        n, done = int(r["n"] or 0), int(r["done_n"] or 0)
        if done:
            return "selesai", f"{done} pesanan uji diserahkan"
        return ("sedang" if n else "belum"), None
    if key == "e_grab":
        r = await _one("SELECT COUNT(*) AS n, SUM(CASE WHEN grab_active = 1 THEN 1 ELSE 0 END) "
                       "AS on_n FROM hiryu_stores WHERE site_id = %s AND active = 1", (sid,))
        n, on = int(r["n"] or 0), int(r["on_n"] or 0)
        if not n:
            return "belum", None
        return ("selesai" if on == n else "sedang" if on else "belum"), f"{on} dari {n} toko"
    return None


def _min_role(roles: list[str]) -> str:
    return min(roles, key=auth.rank)


async def kickoff_payload(site_id: int, user: auth.User) -> dict:
    site = await _hub(site_id)
    marks = {m["step_key"]: m for m in await db.fetch_all(
        "SELECT step_key, done_by, done_by_name, done_at, note FROM hub_kickoff_marks "
        "WHERE site_id = %s", (site_id,))}
    steps = []
    for i, st in enumerate(STEPS, start=1):
        auto = None
        if st["mode"] == "auto":
            try:
                auto = await _check(st["key"], site)
            except Exception:
                auto = None  # the data is not deployed yet: ticked by hand instead
        mark = marks.get(st["key"])
        mode = "auto" if auto is not None else "manual"
        if auto is not None:
            status, detail = auto
            done_by = "WMS" if status == "selesai" else None
            done_at = None
        else:
            status = "selesai" if mark else "belum"
            detail = None
            done_by = (mark["done_by_name"] or mark["done_by"]) if mark else None
            done_at = _iso(mark["done_at"]) if mark else None
        role = _min_role(st["who"])
        steps.append({
            "key": st["key"], "no": i, "phase": st["phase"], "title": st["title"],
            "title_en": st["title_en"], "who": st["who"],
            "who_text": " ".join(admin_role_text(r) for r in st["who"]),
            "systems": st["systems"], "mode": mode, "status": status, "detail": detail,
            "done_by": done_by, "done_at": done_at, "note": mark["note"] if mark else None,
            "screen": st["screen"], "guide": st["guide"], "where": st["where"], "do": st["do"],
            "how": (st.get("auto") if mode == "auto" else
                    st.get("manual") or "WMS tidak bisa melihat langkah ini. Orang yang "
                                        "mengerjakannya menekan Tandai selesai."),
            "can_mark": (mode == "manual" and user.at_least(role)
                         and user.real_role == user.role),
            "mark_role": role,
        })
    phases = []
    for code, title, title_en, sub in PHASES:
        mine = [s for s in steps if s["phase"] == code]
        done = sum(1 for s in mine if s["status"] == "selesai")
        busy = any(s["status"] == "sedang" for s in mine)
        status = "selesai" if done == len(mine) else ("sedang" if done or busy else "belum")
        phases.append({"phase": code, "title": title, "title_en": title_en, "subtitle": sub,
                       "steps": len(mine), "done": done, "status": status,
                       "who_text": " ".join(dict.fromkeys(
                           admin_role_text(r) for s in mine for r in s["who"][:1]))})
    done_all = sum(1 for s in steps if s["status"] == "selesai")
    current = next((s for s in steps if s["status"] != "selesai"), None)
    open_earlier = [s["key"] for s in steps
                    if current and s["no"] < current["no"] and s["status"] != "selesai"]
    return {
        "site": {"id": site["id"], "code": site["code"], "name": site["name"]},
        "title": f"Mulai operasi {site['code']}",
        "intro": "Sampai dark store siap menerima pesanan Grab. WMS mencentang sendiri langkah yang "
                 "bisa dilihatnya.",
        "done": done_all, "total": len(steps),
        "progress_text": f"{done_all} dari {len(steps)} langkah selesai",
        "phases": phases, "steps": steps,
        "current_step": current["key"] if current else None,
        "open_earlier": open_earlier,
    }


def admin_role_text(role: str) -> str:
    return {"staff": "Staf", "supervisor": "SPV", "hq": "Ops HQ", "ops_head": "Ops Head",
            "superadmin": "Superadmin"}.get(role, role)


class KickoffMarkIn(BaseModel):
    note: str | None = Field(default=None, description="Optional, up to 255 characters")


@router.get("/hubs/{site_id}/kickoff")
async def kickoff(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Mulai operasi for one hub: phases A to E, every step with its status
    (selesai, sedang, belum), who ticked it and when."""
    await auth.assert_site_access(user, site_id)
    return await kickoff_payload(site_id, user)


@router.post("/hubs/{site_id}/kickoff/{step_key}/done")
async def kickoff_mark(site_id: int, step_key: str, body: KickoffMarkIn | None = None,
                       user: auth.User = Depends(auth.current_user)):
    """Tandai selesai: a step the WMS cannot see, ticked by the role that does it."""
    await auth.assert_site_access(user, site_id)
    st = _STEP.get(step_key)
    if not st:
        raise HTTPException(404, "Langkah tidak dikenal. / Unknown step.")
    role = _min_role(st["who"])
    if not user.at_least(role):
        raise HTTPException(403, f"Hanya {admin_role_text(role)} ke atas. / Only "
                                 f"{admin_role_text(role)} and above.")
    if st["mode"] == "auto":
        try:
            seen = await _check(step_key, await _hub(site_id))
        except Exception:
            seen = None
        if seen is not None:
            raise HTTPException(409, "WMS mencentang langkah ini sendiri. / The WMS ticks this "
                                     "step by itself.")
    note = ((body.note if body else None) or "").strip()[:255] or None
    await db.execute(
        "INSERT INTO hub_kickoff_marks (site_id, step_key, done_by, done_by_name, note) "
        "VALUES (%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE done_by = VALUES(done_by), "
        "done_by_name = VALUES(done_by_name), done_at = NOW(), note = VALUES(note)",
        (site_id, step_key, user.email, user.name, note))
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'kickoff.done','sites',%s,%s)", (user.email, site_id, step_key))
    return await kickoff_payload(site_id, user)


@router.delete("/hubs/{site_id}/kickoff/{step_key}/done")
async def kickoff_unmark(site_id: int, step_key: str,
                         user: auth.User = Depends(auth.current_user)):
    """Undo a hand tick (pressed by mistake)."""
    await auth.assert_site_access(user, site_id)
    st = _STEP.get(step_key)
    if not st:
        raise HTTPException(404, "Langkah tidak dikenal. / Unknown step.")
    role = _min_role(st["who"])
    if not user.at_least(role):
        raise HTTPException(403, f"Hanya {admin_role_text(role)} ke atas. / Only "
                                 f"{admin_role_text(role)} and above.")
    await db.execute("DELETE FROM hub_kickoff_marks WHERE site_id = %s AND step_key = %s",
                     (site_id, step_key))
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'kickoff.undo','sites',%s,%s)", (user.email, site_id, step_key))
    return await kickoff_payload(site_id, user)


# =============================================================================
# Aturan & waktu
# =============================================================================

# New rule keys go here: key -> (label ID, label EN, "unit ID|unit EN" or None).
# Seed the row in your own migration:
#   INSERT INTO alert_rules (rule_key, enabled, value_num) VALUES ('my_key', 1, 10)
#   ON DUPLICATE KEY UPDATE rule_key = rule_key;
# then add the key to one group in GROUPS (and, if its range is not 1 to 365, to
# BOUNDS). Labels already in reminders.RULES are reused as they are.
NEW_RULES: dict[str, tuple[str, str, str | None]] = {
    "grab_ready_minutes": ("Target siap: waktu pesanan Grab ditambah",
                           "Ready target: Grab's order time plus", "menit|min"),
    "scheduled_lead_minutes": ("Pesanan terjadwal: siap sebelum waktu jadwal",
                               "Scheduled order: ready before the scheduled time by", "menit|min"),
    "grab_buffer_default": ("Cadangan Grab bawaan per SKU (bila tidak diisi di Produk)",
                            "Default Grab buffer per SKU (when not set on Produk)", "unit|units"),
    "bin_kecil_length_cm": ("Bin Kecil: panjang kemasan paling besar",
                            "Kecil bin: longest pack side", "cm|cm"),
    "bin_kecil_width_cm": ("Bin Kecil: lebar kemasan paling besar",
                           "Kecil bin: pack width", "cm|cm"),
    "bin_kecil_height_cm": ("Bin Kecil: tinggi kemasan paling besar",
                            "Kecil bin: pack height", "cm|cm"),
    "bin_besar_bottle_ml": ("Botol mulai ukuran ini masuk bin Besar",
                            "Bottles from this size go in a Besar bin", "ml|ml"),
    # Agent C (seeded in V31): quarantine, counts, consumables.
    "quarantine_decide_hours": ("Barang di karantina menunggu keputusan SPV: ingatkan setelah",
                                "Quarantined goods waiting for the SPV's decision: remind after",
                                "jam|hours"),
    "writeoff_approve_hours": ("Penghapusan stok menunggu persetujuan: ingatkan setelah",
                               "Write-off waiting for approval: remind after", "jam|hours"),
    "count_approve_hours": ("Hasil hitung stok menunggu persetujuan SPV: ingatkan setelah",
                            "Count result waiting for the SPV's approval: remind after", "jam|hours"),
    "count_review_hours": ("Hasil hitung stok menunggu tinjauan Ops HQ: ingatkan setelah",
                           "Count result waiting for Ops HQ's review: remind after", "jam|hours"),
    "count_full_workdays": ("Hitung stok penuh bulanan selesai dalam",
                            "Monthly full count to be finished within", "hari kerja|working days"),
    "consumable_pr_hours": ("Permintaan bahan kemas menunggu PR dari Ops HQ: ingatkan setelah",
                            "Consumables request waiting for Ops HQ's PR: remind after", "jam|hours"),
    "consumable_approve_hours": ("Penerimaan bahan kemas menunggu persetujuan Ops HQ: ingatkan "
                                 "setelah", "Consumables receipt waiting for Ops HQ: remind after",
                                 "jam|hours"),
    "consumable_count_days": ("Hitung bahan kemas setiap", "Count consumables every",
                              "hari|days"),
    "consumable_orders_month": ("Target pesanan per dark store per bulan (dasar minimum bahan kemas)",
                                "Orders per dark store per month (basis of the consumables minimum)",
                                "pesanan|orders"),
    "consumable_min_days": ("Minimum bahan kemas cukup untuk", "Consumables minimum covers",
                            "hari|days"),
    # Agents I and O: add your keys here.
}

# group key, title ID, title EN, rule keys in order
GROUPS: list[tuple[str, str, str, list[str]]] = [
    ("pesanan", "Pesanan", "Orders",
     ["grab_ready_minutes", "scheduled_lead_minutes", "pick_start_minutes",
      "handover_wait_minutes"]),
    ("stok", "Stok dan restock", "Stock and restock",
     ["restock_default_pct", "auto_replenish", "safety_breach", "grab_buffer_default",
      "stock_old_days", "slow_mover_days"]),
    ("restock", "Permintaan ke merek", "Requests to brands",
     ["draft_unsent_hours", "sent_unconfirmed_hours", "delivery_overdue_days",
      "variance_open_hours"]),
    ("barang_masuk", "Barang masuk", "Receiving",
     ["faktur_spv_hours", "faktur_hq_hours"]),
    ("produk", "Produk dan rak", "Products and racks",
     ["needs_rack_days", "sku_request_open_hours", "bin_kecil_length_cm", "bin_kecil_width_cm",
      "bin_kecil_height_cm", "bin_besar_bottle_ml"]),
    ("karantina", "Karantina dan penghapusan", "Quarantine and write-off",
     ["quarantine_decide_hours", "writeoff_approve_hours"]),
    ("hitung", "Hitung stok", "Stock counts",
     ["count_approve_hours", "count_review_hours", "count_full_workdays"]),
    ("bahan_kemas", "Bahan kemas", "Consumables",
     ["consumable_pr_hours", "consumable_approve_hours", "consumable_count_days",
      "consumable_orders_month", "consumable_min_days"]),
    ("hiryu", "Hiryu", "Hiryu", ["link_wait_alert_minutes"]),
]

BOUNDS: dict[str, tuple[int, int]] = {
    "restock_default_pct": (1, 99), "grab_buffer_default": (0, 99),
    "bin_kecil_length_cm": (1, 200), "bin_kecil_width_cm": (1, 200),
    "bin_kecil_height_cm": (1, 200), "bin_besar_bottle_ml": (1, 5000),
    "grab_ready_minutes": (1, 240), "scheduled_lead_minutes": (1, 240),
    "consumable_orders_month": (1, 100000), "count_full_workdays": (1, 31),
}


def _all_rules() -> dict[str, tuple]:
    return {**reminders.RULES, **NEW_RULES}


class RuleIn(BaseModel):
    enabled: bool = True
    value: int | None = None


async def rules_payload(user: auth.User) -> dict:
    defs = _all_rules()
    rows = await db.fetch_all("SELECT rule_key, enabled, value_num, updated_by, updated_at "
                              "FROM alert_rules")
    have = {r["rule_key"]: r for r in rows}
    groups = []
    placed = set()
    for gkey, title, title_en, keys in GROUPS:
        items = []
        for key in keys:
            if key not in defs:
                continue
            placed.add(key)
            lid, len_, unit = defs[key]
            r = have.get(key)
            lo, hi = BOUNDS.get(key, (1, 365))
            items.append({
                "key": key, "label_id": lid, "label_en": len_,
                "unit_id": unit.split("|")[0] if unit else None,
                "unit_en": unit.split("|")[1] if unit else None,
                "has_value": unit is not None, "min": lo, "max": hi,
                "enabled": bool(r["enabled"]) if r else False,
                "value": r["value_num"] if r else None,
                "updated_by": r["updated_by"] if r else None,
                "updated_at": _iso(r["updated_at"]) if r else None,
            })
        groups.append({"key": gkey, "title": title, "title_en": title_en, "rules": items})
    # A key someone added to NEW_RULES or reminders.RULES but not to a group.
    rest = [k for k in defs if k not in placed and k not in ("ed_near_days",)]
    if rest:
        extra = []
        for key in rest:
            lid, len_, unit = defs[key]
            r = have.get(key)
            lo, hi = BOUNDS.get(key, (1, 365))
            extra.append({"key": key, "label_id": lid, "label_en": len_,
                          "unit_id": unit.split("|")[0] if unit else None,
                          "unit_en": unit.split("|")[1] if unit else None,
                          "has_value": unit is not None, "min": lo, "max": hi,
                          "enabled": bool(r["enabled"]) if r else False,
                          "value": r["value_num"] if r else None,
                          "updated_by": r["updated_by"] if r else None,
                          "updated_at": _iso(r["updated_at"]) if r else None})
        groups.append({"key": "lain", "title": "Lainnya", "title_en": "Other", "rules": extra})
    return {"groups": groups, "can_edit": user.at_least("hq") and user.real_role == user.role,
            "note": "Ops HQ menulis SOP; angka di sini hanya menentukan kapan WMS mengingatkan."}


@router.get("/settings/rules")
async def list_rules(user: auth.User = Depends(auth.current_user)):
    """Aturan & waktu: every rule by group, with its value and who changed it last."""
    return await rules_payload(user)


@router.put("/settings/rules/{key}")
async def set_rule(key: str, body: RuleIn, user: auth.User = Depends(auth.require("hq"))):
    """Ops HQ switches a rule on or off, or sets its number."""
    defs = _all_rules()
    if key not in defs:
        raise HTTPException(404, "Aturan tidak dikenal. / Unknown rule.")
    has_value = defs[key][2] is not None
    lo, hi = BOUNDS.get(key, (1, 365))
    if has_value and body.value is not None and not lo <= body.value <= hi:
        raise HTTPException(422, f"Nilai antara {lo} dan {hi}. / The value must be {lo} to {hi}.")
    await db.execute(
        "INSERT INTO alert_rules (rule_key, enabled, value_num, updated_by) VALUES (%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), "
        "value_num = COALESCE(VALUES(value_num), value_num), updated_by = VALUES(updated_by)",
        (key, 1 if body.enabled else 0, body.value if has_value else None, user.email))
    return await rules_payload(user)
