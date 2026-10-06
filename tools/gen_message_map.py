#!/usr/bin/env python3
"""Build frontend/app/peta-pesan.json: the message map on Pengaturan, Integrasi Hiryu.

Run from the repo root:

    python tools/gen_message_map.py           # check everything, then write the file
    python tools/gen_message_map.py --check   # check only; fails if the file on disk is stale

The map shows every message between Hiryu and the WMS, field by field. The code
is what runs, so the field rows come from the code, not from a copy of the doc:

  * Hiryu to WMS (messages 1, 2, 6): the rows are walked from the pydantic models
    in backend/routers/hiryu_link.py (model_json_schema): type, required, may be
    null, pattern, limits and allowed values.
  * WMS to Hiryu (messages 3, 4, 5): the real builders in
    backend/pos_sender.py are run against a stubbed database, and the rows come
    from the keys and values they put in `data`, inside envelope().
  * The catalogue pull (GET POS_CATALOGUE_URL, Sinkron ulang dari Hiryu): no
    body; its one query field is written by hand and checked against
    pos_sender.pull_catalogue, catalogue_url() and the button's route, and its
    example answer is validated as a full message 6.

What the code cannot say (what a field means, an example, the triggers, what the
receiver does next) is written by hand below, in Indonesian and English.

Checks, all failing loudly on drift:
  * every inbound example JSON is validated by the real model, and its times by
    the WMS's own time parser; every answer body by the answer model;
  * every outbound example has exactly the keys the builder puts in `data`, with
    the same JSON types, and the envelope has exactly envelope()'s keys;
  * every field row has a hand-written meaning and a business name (ID and
    EN, what ops call it), and no meaning or name is left for a field the code
    no longer has;
  * the "Kapan dan seberapa cepat" texts and the order timeline match the
    code: the sender loop's pause in main.py, order messages ahead of stock
    (ledger.PRIORITY), the same number skipped, the 03:00 WIB snapshot, the
    snapshot on switch-on and on the button, no buffer in available_now, and
    the ready target (grab_ready_minutes);
  * routes, auth header, message types, H refs in the log, retry schedule,
    timeout and the error words quoted below are found in the code;
  * the 401 and 422 answers are produced by the real router (FastAPI TestClient).
  * no en or em dash anywhere in the output.
"""
import asyncio
import copy
import inspect
import json
import os
import pathlib
import re
import sys
import warnings
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "app" / "peta-pesan.json"
sys.path.insert(0, str(ROOT / "backend"))

# The MySQL driver is not needed to describe the link (as in gen_openapi.py).
_stub = type(sys)("asyncmy")
_stub.create_pool = None
sys.modules.setdefault("asyncmy", _stub)
_cursors = type(sys)("asyncmy.cursors")
_cursors.DictCursor = object
sys.modules.setdefault("asyncmy.cursors", _cursors)

import pos_sender  # noqa: E402
from routers import hiryu_link, outbound  # noqa: E402

PROBLEMS: list[str] = []

# The catalogue pull's wait, from the code (pos_sender.CATALOGUE_TIMEOUT).
PULL_SECS = int(pos_sender.CATALOGUE_TIMEOUT)


def fail(msg: str) -> None:
    PROBLEMS.append(msg)


def T(id_text: str, en_text: str) -> dict:
    return {"id": id_text, "en": en_text}


# ==========================================================================
# The H list (board 11a) and the general rules
# ==========================================================================

H_LIST = [
    {"h": "H1", "pilot": True, "messages": ["1"], "grab": [],
     "text": T("Staf menekan Terima di Hiryu: Hiryu mengirim pesan 1, pesanan untuk diambil.",
               "Staff press Accept in Hiryu: Hiryu sends message 1, the order to pick.")},
    {"h": "H2", "pilot": True, "messages": ["2"], "grab": [],
     "text": T("Pembatalan apa pun (pelanggan, Grab, merchant, atau setelah H5): Hiryu mengirim pesan 2.",
               "Any cancel (customer, Grab, merchant, or after H5): Hiryu sends message 2.")},
    {"h": "H3", "pilot": True, "messages": ["3"], "grab": ["Hiryu menu stock sync"],
     "text": T("WMS mengirim level stok (pesan 3): Hiryu menyetel Units on hand ke angka itu dan meneruskannya ke Grab.",
               "The WMS sends a stock level (message 3): Hiryu sets Units on hand to that number and passes it on to Grab.")},
    {"h": "H4", "pilot": True, "messages": ["4"], "grab": ["MarkOrderReady"],
     "text": T("Packer menekan Selesai dikemas: WMS mengirim pesan 4 dan Hiryu menandai pesanan siap di Grab.",
               "The packer taps Selesai dikemas: the WMS sends message 4 and Hiryu marks the order ready on Grab.")},
    {"h": "H5", "pilot": True, "messages": ["5", "2"], "grab": ["CheckOrderCancelable", "CancelOrder", "EditOrder"],
     "text": T("Picker menyatakan barang tidak ada: WMS mengirim pesan 5, Hiryu mengubah atau membatalkan pesanan di Grab (2001).",
               "The picker declares an item missing: the WMS sends message 5 and Hiryu edits or cancels the order on Grab (2001).")},
    {"h": "H6", "pilot": True, "messages": ["6", "catalogue_pull"], "grab": [],
     "text": T("Dark store, toko, menu, bundle atau SKU dibuat atau berubah: Hiryu mengirim pesan 6. Saat Sinkron ulang, WMS menarik katalog lengkap (GET) dan Hiryu menjawab dengan isi pesan 6.",
               "A dark store, store, menu, bundle or SKU is created or changed: Hiryu sends message 6. On a resync the WMS pulls the whole catalogue (GET) and Hiryu answers with a message 6 body.")},
    {"h": "H7", "pilot": True, "messages": ["1", "2", "3", "4", "5", "6", "catalogue_pull"], "grab": [],
     "text": T("Selalu: alamat HTTPS untuk pesan dari WMS, kunci bersama di X-Hiryu-Key, antrean yang tahan restart dengan percobaan ulang, dan peringatan bila pesan gagal.",
               "Always: an HTTPS address for the WMS's messages, the shared key in X-Hiryu-Key, a queue that survives a restart with retries, and an alert when messages fail.")},
    {"h": "H8", "pilot": True, "messages": ["3", "1"], "grab": [],
     "text": T("Stok ke Hiryu untuk setiap toko aktif (aktif di Hiryu, merek dipilih, dark store ada di katalog Hiryu), tanpa sakelar per toko. Begitu toko aktif dan Sambungan Hiryu aktif menyala, Hiryu berhenti mengubah stok sendiri dan WMS mengirim snapshot stok penuh toko itu.",
               "Stock goes to Hiryu for every active store (active in Hiryu, brand chosen, dark store in Hiryu's catalogue), with no switch per store. Once a store is active and Sambungan Hiryu aktif is on, Hiryu stops changing stock itself and the WMS sends that store's full stock snapshot.")},
    {"h": "H9", "pilot": True, "messages": ["1"], "grab": [],
     "text": T("Pilihan pelanggan bila stok habis: dikirim per baris di pesan 1 (oos_instruction), null bila tidak ada.",
               "The customer's out-of-stock choice: sent per line in message 1 (oos_instruction), null when there is none.")},
    {"h": "H10", "pilot": True, "messages": ["5"], "grab": ["EditOrder"],
     "text": T("WMS melaporkan baris diganti atau dihapus (pesan 5): Hiryu menerapkannya dengan Edit order di Grab.",
               "The WMS reports a line replaced or removed (message 5): Hiryu applies it with Edit order on Grab.")},
    {"h": "H11", "pilot": False, "messages": [], "grab": [],
     "text": T("Setelah pilot: laporan pesanan mentah bulanan untuk pembayaran Nemu Mart. Tidak perlu selama setiap merek punya akun merchant Grab sendiri.",
               "After the pilot: a monthly raw-order report for Nemu Mart payouts. Not needed while each brand has its own Grab merchant account.")},
]


def _dur_words(seconds: int) -> tuple[str, str]:
    if seconds < 60:
        return f"{seconds} dtk", f"{seconds} s"
    return f"{seconds // 60} mnt", f"{seconds // 60} min"


def retry_words() -> dict:
    steps = list(pos_sender.BACKOFF)
    first, last = steps[:-1], steps[-1]
    id_parts = [_dur_words(s)[0] for s in first]
    en_parts = [_dur_words(s)[1] for s in first]
    return T(", ".join(id_parts) + ", lalu tiap " + _dur_words(last)[0],
             ", ".join(en_parts) + ", then every " + _dur_words(last)[1])


def general_rules() -> list[dict]:
    rw = retry_words()
    timeout = int(pos_sender.HTTP_TIMEOUT)
    return [
        {"key": "auth", "title": T("Kunci", "The key"),
         "text": T("Setiap panggilan, dua arah, membawa header X-Hiryu-Key berisi POS_SHARED_SECRET. Nilainya beda di dev dan produksi. "
                   "Di WMS, kunci yang hilang atau salah dijawab 401 (jalur publik tanpa Google sign-in) dan tidak ada yang berubah.",
                   "Every call, both ways, carries the header X-Hiryu-Key with POS_SHARED_SECRET. It differs on dev and production. "
                   "At the WMS a missing or wrong key answers 401 (a public path, no Google sign-in) and nothing changes.")},
        {"key": "message_id", "title": T("message_id sekali saja", "message_id, once"),
         "text": T("Setiap pesan punya message_id yang unik per pengirim; percobaan ulang memakai yang sama. WMS menyimpan message_id yang sudah diterima "
                   "dan menjawab ulangan dengan status dan isi yang sama, tanpa mengubah apa pun. Pesan yang ditolak (422) tidak disimpan: setelah "
                   "penyebabnya dibereskan, pesan yang sama boleh dikirim lagi. WMS juga mengirim Idempotency-Key berisi message_id.",
                   "Every message has a message_id, unique per sender; a retry reuses it. The WMS keeps every message_id it took and answers a repeat "
                   "with the same status and body, changing nothing. A refused message (422) is not kept: once the cause is fixed, the same message "
                   "may be sent again. The WMS also sends Idempotency-Key with the message_id.")},
        {"key": "time", "title": T("Waktu", "Times"),
         "text": T("ISO 8601 dengan zona (2026-10-01T09:41:00+07:00) atau UTC dengan Z. Waktu tanpa zona ditolak (422). WMS selalu mengirim UTC dengan Z, "
                   "sampai detik. Jam buka di opening_hours memakai WIB, 24 jam, HH:MM.",
                   "ISO 8601 with a zone (2026-10-01T09:41:00+07:00) or UTC with Z. A time with no zone is refused (422). The WMS always sends UTC "
                   "with Z, to the second. Opening hours in opening_hours are WIB, 24 h, HH:MM.")},
        {"key": "numbers", "title": T("Angka dan kode", "Numbers and codes"),
         "text": T("Angka selalu mutlak, tidak pernah \"+2\". Kode SKU dibandingkan tanpa melihat huruf besar kecil; WMS mengirimnya dalam huruf besar.",
                   "Numbers are absolute, never \"+2\". SKU codes are compared ignoring capitals; the WMS sends them in capitals.")},
        {"key": "hiryu_first", "title": T("Hiryu dulu", "Hiryu first"),
         "text": T("Untuk setiap alur yang menyentuh dua sistem, Hiryu melakukan langkahnya dulu, lalu WMS. Pesanan masuk ke WMS hanya setelah staf menekan Terima di Hiryu. "
                   "WMS memberi tahu Hiryu, dan hanya Hiryu yang bicara dengan Grab.",
                   "In any flow that touches both systems, Hiryu does its step first, then the WMS. An order reaches the WMS only after Accept in Hiryu. "
                   "The WMS tells Hiryu, and only Hiryu talks to Grab.")},
        {"key": "no_customer_data", "title": T("Tanpa data pelanggan", "No customer data"),
         "text": T("Tidak pernah dikirim, ke arah mana pun: nama pelanggan, telepon, alamat, catatan pelanggan, pembayaran, data driver. Setiap model di WMS "
                   "menolak field yang tidak ada di peta ini (422, extra_forbidden) dan setiap field teks punya pola ketat, jadi data itu tidak bisa ikut terbawa.",
                   "Never sent, either way: customer name, phone, address, customer notes, payment, driver details. Every WMS model refuses a field that "
                   "is not on this map (422, extra_forbidden) and every text field has a strict pattern, so none of these can ride along.")},
        {"key": "order_first", "title": T("Pesanan dulu", "Orders first"),
         "text": T("Pesan pesanan (1, 2, 4, 5) didahulukan dari pesan stok dan katalog (3, 6). Di antrean WMS: order_ready dan item_short prioritas 1, "
                   "stock_level prioritas 5. Tarik katalog tidak lewat antrean. Pembatalan yang datang sebelum pesanannya disimpan dan dijalankan saat pesan 1 tiba.",
                   "Order messages (1, 2, 4, 5) go ahead of stock and catalogue messages (3, 6). In the WMS queue: order_ready and item_short are "
                   "priority 1, stock_level priority 5. The catalogue pull does not use the queue. A cancel that comes before its order is kept and applied when message 1 arrives.")},
        {"key": "retries", "title": T("Jawaban dan percobaan ulang", "Answers and retries"),
         "text": T(f"2xx atau 409: selesai. 408, 429, 5xx, atau tidak ada jawaban dalam {timeout} dtk: coba lagi setelah {rw['id']}. 4xx lain: gagal, "
                   "berhenti, tampil merah di halaman ini; Ops HQ menekan Coba lagi yang gagal. 422 dari WMS: jangan coba lagi, bereskan penyebabnya. "
                   "Pesan yang menunggu lebih dari 5 menit tampil merah. Kedua sisi menyimpan pesan yang belum terkirim di antrean yang tahan restart.",
                   f"2xx or 409: done. 408, 429, 5xx, or no answer in {timeout} s: retry after {rw['en']}. Any other 4xx: failed, stops, shows red "
                   "on this page; Ops HQ presses Coba lagi yang gagal. A 422 from the WMS: do not retry, fix the cause. A message waiting more than "
                   "5 minutes shows red. Both sides keep unsent messages in a queue that survives a restart.")},
        {"key": "switches", "title": T("Sakelar di sisi WMS", "Switches on the WMS side"),
         "text": T("WMS mengirim pesan 3, 4 dan 5 ke Hiryu hanya bila POS_PUSH_ENABLED, POS_WEBHOOK_URL, POS_SHARED_SECRET dan Sambungan Hiryu aktif semuanya menyala; "
                   "sebelum itu pesan antre (mode bayangan). Stok dikirim untuk setiap toko aktif, tanpa sakelar per toko (H8). Tarik katalog hanya perlu "
                   "alamat katalog (POS_CATALOGUE_URL, atau asal POS_WEBHOOK_URL + /catalogue) dan POS_SHARED_SECRET. Lokasi latihan dan pesanan UJI "
                   "tidak pernah mengirim.",
                   "The WMS sends messages 3, 4 and 5 to Hiryu only when POS_PUSH_ENABLED, POS_WEBHOOK_URL, POS_SHARED_SECRET and Sambungan Hiryu aktif are all on; "
                   "until then messages queue (shadow mode). Stock goes to every active store, with no switch per store (H8). The catalogue pull needs only "
                   "the catalogue address (POS_CATALOGUE_URL, or POS_WEBHOOK_URL's origin + /catalogue) and POS_SHARED_SECRET. The training site and UJI test "
                   "orders never send.")},
        {"key": "demo", "title": T("Mode demo", "Mode demo"),
         "text": T("Dark store dalam Mode demo mengirim ke stand-in Hiryu di dalam WMS, bukan ke POS_WEBHOOK_URL. Stand-in menjawab 200 {\"ok\": true, \"standin\": true}, "
                   "lalu berlaku seperti Hiryu: setelah item_short dengan cancel_order ia mengirim pesan 2 (merchant, 2001), dan tarik katalog ia "
                   "jawab dengan pesan 6 penuh. Di log tampil sebagai Demo atau Stand-in.",
                   "A dark store in Mode demo sends to the Hiryu stand-in inside the WMS instead of POS_WEBHOOK_URL. The stand-in answers 200 "
                   "{\"ok\": true, \"standin\": true}, then acts like Hiryu: after item_short with cancel_order it sends message 2 (merchant, 2001), "
                   "and it answers the catalogue pull with a full message 6. The log shows these as Demo or Stand-in.")},
        {"key": "ping", "title": T("Cek sambungan", "Health check"),
         "text": T("GET /api/hiryu/v1/ping dengan X-Hiryu-Key menjawab {\"ok\": true} bila kuncinya benar.",
                   "GET /api/hiryu/v1/ping with X-Hiryu-Key answers {\"ok\": true} when the key is right.")},
    ]


# ==========================================================================
# Hiryu to WMS: messages 1, 2 and 6
# ==========================================================================

EX_ORDER = {
    "message_id": "hy-ord-8f2c",
    "grab_order_id": "A-7Q2K9XW3M4",
    "gm_number": "GM-358",
    "hiryu_store_id": 903,
    "order_time": "2026-10-01T09:41:00+07:00",
    "scheduled_time": None,
    "estimated_ready_time": None,
    "lines": [
        {"hiryu_item_id": "LAB-GB-MC-100", "item_qty": 3, "sku_code": "LAB-GB-MC-100", "units": 3,
         "item_price": 45000,
         "oos_instruction": {"type": "replace", "replace_hiryu_item_id": "LAB-GB-MC-225",
                             "replace_sku_code": "LAB-GB-MC-225", "replace_units": 1}},
    ],
}

EX_CANCEL_PATH = "A-3H6PV8N2RT"
EX_CANCEL = {"message_id": "hy-can-11ab", "reason_code": "2001", "reason": "Item out of stock",
             "cancelled_by": "merchant", "cancelled_at": "2026-10-01T08:55:00+07:00"}

_HOURS = {d: [{"open": "08:00", "close": "22:00"}] for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}
EX_CATALOGUE = {
    "message_id": "hy-cat-77",
    "full": False,
    "request_id": None,
    "dark_stores": [
        {"hiryu_dark_store_id": 13, "name": "Cawang", "address": "Jl. Raya Kalibata No. 4, Jakarta Timur",
         "opening_hours": _HOURS},
    ],
    "stores": [
        {"hiryu_store_id": 902, "name": "Kahf - Cawang", "hiryu_dark_store_id": 13, "status": "active",
         "order_acceptance": "MANUAL"},
    ],
    "skus": [
        {"sku_code": "KHF-FW-OAC-100", "name": "Kahf Oil and Acne Care Face Wash 100 ml",
         "barcodes": ["8993137000101"]},
    ],
    "menus": [
        {"hiryu_store_id": 902, "items": [
            {"item_id": "KHF-FW-OAC-100", "name": "Kahf Face Wash Oil & Acne 100 ml", "sku_code": "KHF-FW-OAC-100",
             "units_per_sale": 1, "price": 45000, "available": True},
        ]},
    ],
}

TIME_NOTE = T("ISO 8601 dengan zona", "ISO 8601 with a zone")
TIME_OR_NULL = TIME_NOTE
FOR_REPLACE = T("Untuk replace", "For replace")
FOR_REPLACED = T("Untuk replaced", "For replaced")

# path -> {meaning, [allowed], [when], [example]}
ANN_ORDER = {
    "message_id": {"meaning": T(
        "Hiryu membuatnya, unik per pesan; percobaan ulang memakai yang sama. Ulangan dijawab sama dan tidak mengubah apa pun.",
        "Hiryu makes it, unique per message; a retry reuses it. A repeat gets the same answer and changes nothing.")},
    "grab_order_id": {"meaning": T(
        "ID pesanan Grab. Kunci pesanan di WMS; ID yang sama lagi dijawab 200 duplicate.",
        "The Grab order ID. The order's key in the WMS; the same ID again answers 200 duplicate.")},
    "gm_number": {"allowed": T("GM- lalu 1 sampai 16 huruf atau angka", "GM- then 1 to 16 letters or digits"), "meaning": T(
        "Nomor pendek di Live Orders dan slip. Tampil besar untuk picker dan packer; packer mengetiknya untuk cek slip.",
        "The short number on Live Orders and the slip. Shown big to picker and packer; the packer types it to check the slip.")},
    "hiryu_store_id": {"meaning": T(
        "Nomor toko di Hiryu (Labore - Cawang #903). Menentukan dark store dan merek; toko tak dikenal atau tidak aktif dijawab 422.",
        "Hiryu's store number (Labore - Cawang is #903). Finds the dark store and brand; an unknown or inactive store answers 422.")},
    "order_time": {"allowed": TIME_NOTE, "meaning": T(
        "Saat pelanggan memesan di Grab. Jam mulai dihitung dari sini, bukan dari Terima: siap paling lambat order_time + 10 menit.",
        "When the customer ordered on Grab. The clock starts here, not at Accept: ready-by is order_time plus 10 minutes.")},
    "scheduled_time": {"allowed": TIME_OR_NULL, "meaning": T(
        "Waktu terjadwal dari Grab; null untuk pesanan sekarang. Pesanan menunggu di Terjadwal dan masuk ke picker 20 menit sebelumnya.",
        "Grab's scheduled time; null for an order now. The order waits in Terjadwal and goes to a picker 20 minutes before.")},
    "estimated_ready_time": {"allowed": TIME_OR_NULL, "meaning": T(
        "Perkiraan siap dari Grab, bila ada. Disimpan sebagai catatan saja, bukan batas siap.",
        "Grab's estimated ready time, when it gives one. Kept for reference only, not the ready-by.")},
    "lines": {"meaning": T(
        "Barang di pesanan Grab, satu isi per item menu. Satu baris ambil per isi.",
        "The items on the Grab order, one entry per menu item. One pick line per entry.")},
    "lines[].hiryu_item_id": {"meaning": T(
        "Item menu Hiryu yang dipesan. Disimpan di baris dan dikirim balik di pesan 5.",
        "The Hiryu menu item ordered. Kept on the line and sent back in message 5.")},
    "lines[].item_qty": {"meaning": T(
        "Jumlah item yang dipesan pelanggan. Untuk laporan penjualan merek.",
        "How many of the item the customer ordered. For the brand sales report.")},
    "lines[].sku_code": {"meaning": T(
        "SKU yang dipakai item di Bundles. Mencari produk WMS tanpa melihat huruf besar kecil; kode tak dikenal dijawab 422.",
        "The SKU the item uses in Bundles. Finds the WMS product ignoring capitals; an unknown code answers 422.")},
    "lines[].units": {"meaning": T(
        "item_qty x unit per penjualan dari Bundles (2-pack dipesan sekali = 2). Unit yang diambil; langsung ditahan.",
        "item_qty x units per sale from Bundles (a 2-pack ordered once is 2). Units to pick; held at once.")},
    "lines[].item_price": {"meaning": T(
        "Harga menu item hari itu, rupiah. Hanya untuk laporan penjualan merek.",
        "The item's menu price that day, in rupiah. Brand sales report only.")},
    "lines[].oos_instruction": {"meaning": T(
        "Pilihan pelanggan bila barang habis (H9), seperti di kartu pesanan Hiryu. null bila Grab tidak memberi: diperlakukan cancel_order.",
        "The customer's out-of-stock choice (H9), as on Hiryu's order card. null when Grab gives none: treated as cancel_order.")},
    "lines[].oos_instruction.type": {"meaning": T(
        "replace: picker mengambil pengganti. remove: baris keluar dari pesanan. cancel_order: pesanan berhenti. contact_customer: di pilot diperlakukan cancel_order.",
        "replace: the picker takes the replacement. remove: the line leaves the order. cancel_order: the order stops. contact_customer: handled as cancel_order in the pilot.")},
    "lines[].oos_instruction.replace_hiryu_item_id": {"when": FOR_REPLACE, "meaning": T(
        "Item pengganti yang dipilih pelanggan. Dikirim balik di pesan 5 bila pengganti diambil.",
        "The replacement item the customer picked. Sent back in message 5 when the replacement is taken.")},
    "lines[].oos_instruction.replace_sku_code": {"when": FOR_REPLACE, "meaning": T(
        "SKU item pengganti di Bundles. Kode tak dikenal tidak menolak pesanan: baris jadi cancel_order dan Ops HQ diberi tahu.",
        "The replacement item's SKU in Bundles. An unknown code does not refuse the order: the line becomes cancel_order and Ops HQ is flagged.")},
    "lines[].oos_instruction.replace_units": {"when": FOR_REPLACE, "meaning": T(
        "Jumlah item pengganti x unit per penjualannya. Unit pengganti yang diambil. Ganti tanpa ketiga field ini jadi cancel_order.",
        "Replacement item quantity x its units per sale. Units of the replacement to pick. A replace without all three fields becomes cancel_order.")},
}

ANN_CANCEL = {
    "(path) grab_order_id": {"meaning": T(
        "ID pesanan Grab yang dibatalkan, di alamat. Belum dikenal: pembatalan disimpan dan dijalankan saat pesan 1 tiba.",
        "The cancelled order's Grab order ID, in the path. Not seen yet: the cancel is kept and applied when message 1 arrives.")},
    "message_id": {"meaning": T(
        "Hiryu membuatnya, unik per pesan. Ulangan tidak mengubah apa pun.",
        "Hiryu makes it, unique per message. A repeat changes nothing.")},
    "reason_code": {"allowed": T("2001 | 2002 | 2003 | 2004", "2001 | 2002 | 2003 | 2004"), "meaning": T(
        "2001 Item out of stock, 2002 Store closed, 2003 Too busy, 2004 Customer requested; null bila Grab tidak memberi alasan. Laporan menghitung 2001 sebagai batal karena barang tidak ada.",
        "2001 Item out of stock, 2002 Store closed, 2003 Too busy, 2004 Customer requested; null when Grab gives no reason. Reports count 2001 as a missing-item cancel.")},
    "reason": {"meaning": T(
        "Kata-kata untuk kode itu, tidak pernah kata-kata pelanggan. Kosong: WMS memakai kata baku kodenya.",
        "The words for the code, never the customer's own words. Left out: the WMS uses the code's standard words.")},
    "cancelled_by": {"meaning": T(
        "Siapa yang membatalkan, seperti diketahui Hiryu. Tampil di pesanan merah dan laporan.",
        "Who cancelled, as Hiryu knows it. Shown on the red order and in reports.")},
    "cancelled_at": {"allowed": TIME_NOTE, "meaning": T(
        "Saat pesanan dibatalkan. Disimpan di pesanan.",
        "When the order was cancelled. Kept on the order.")},
}

ANN_CATALOGUE = {
    "message_id": {"meaning": T("Hiryu membuatnya, unik per pesan. Ulangan tidak mengubah apa pun.",
                                "Hiryu makes it, unique per message. A repeat changes nothing.")},
    "full": {"meaning": T(
        "true bila Hiryu mengirim daftar lengkap. Dark store, toko dan item menu yang tidak ada di bagian yang dikirim jadi tidak aktif; bagian yang kosong tidak mengubah apa pun.",
        "true when Hiryu sends the whole list. Dark stores, stores and menu items missing from a section that is sent turn inactive; an empty section changes nothing.")},
    "request_id": {"meaning": T(
        "Pada jawaban tarik katalog: null atau request_id dari ?request_id=; WMS tetap mengisinya dengan request_id permintaannya. Null bila Hiryu mengirim sendiri. Menandai Sinkron ulang selesai.",
        "In the answer to a catalogue pull: null or the request_id from ?request_id=; the WMS fills in its own request_id either way. Null when Hiryu sends on its own. Marks Sinkron ulang as done.")},
    "dark_stores": {"meaning": T("Dark store di Hiryu. Setiap dark store Hiryu adalah satu dark store di WMS.",
                                "Hiryu's dark stores. Each one is one dark store in the WMS.")},
    "dark_stores[].hiryu_dark_store_id": {"meaning": T(
        "Nomor dark store di Hiryu, kuncinya di WMS. Nomor baru membuat dark store baru di WMS (Baru dari Hiryu); Ops HQ hanya menambah data WMS.",
        "The dark store's number in Hiryu, its key in the WMS. A new one creates the dark store in the WMS (Baru dari Hiryu); Ops HQ adds only the WMS data.")},
    "dark_stores[].name": {"meaning": T("Nama dark store, hanya baca di WMS.",
                                        "The dark store's name, read-only in the WMS.")},
    "dark_stores[].address": {"meaning": T("Alamat dark store. Hanya baca di Dark store & mulai operasi.",
                                           "The dark store's address. Read-only on Dark store & mulai operasi.")},
    "dark_stores[].opening_hours": {"meaning": T(
        "Jam buka di Hiryu, yang juga tampil di Grab. Jam buka dark store, untuk mulai hari, laporan akhir hari dan peringatan.",
        "The hours set in Hiryu, the ones Grab shows. The dark store's open hours, for the day's start, end-of-day report and alerts.")},
    "dark_stores[].opening_hours.{mon,tue,wed,thu,fri,sat,sun}": {"meaning": T(
        "Satu isi per jam buka, WIB, 24 jam; [] berarti tutup hari itu. Ketujuh hari wajib ada.",
        "One entry per opening period, WIB, 24 h; [] means closed that day. All seven days must be there.")},
    "dark_stores[].opening_hours.{mon,tue,wed,thu,fri,sat,sun}[].open": {"allowed": T("00:00 sampai 24:00", "00:00 to 24:00"), "meaning": T("Jam buka, HH:MM.", "Opening time, HH:MM.")},
    "dark_stores[].opening_hours.{mon,tue,wed,thu,fri,sat,sun}[].close": {"allowed": T("00:00 sampai 24:00", "00:00 to 24:00"), "meaning": T(
        "Jam tutup, HH:MM; 24:00 untuk tengah malam.", "Closing time, HH:MM; 24:00 for midnight.")},
    "stores": {"meaning": T("Toko di Hiryu, satu per merek per dark store. Satu toko WMS per isi.",
                            "Hiryu's stores, one per brand per dark store. One WMS store per entry.")},
    "stores[].hiryu_store_id": {"meaning": T(
        "Nomor toko, kuncinya. Toko baru menunggu di Menu & toko Hiryu sampai Ops HQ memilih merek dan akun merchant Grab-nya.",
        "The store's number, its key. A new store waits on Menu & toko Hiryu until Ops HQ picks its brand and Grab merchant account.")},
    "stores[].name": {"meaning": T("Nama toko. Tampil di Menu & toko Hiryu.", "The store's name. Shown on Menu & toko Hiryu.")},
    "stores[].hiryu_dark_store_id": {"meaning": T(
        "Dark store tempat toko berada. Toko ditaruh di dark store itu; nomor yang tak dikenal masuk problems.",
        "The dark store the store belongs to. Puts the store on that dark store; an unknown number goes to problems.")},
    "stores[].status": {"allowed": T("active | inactive", "active | inactive"), "meaning": T(
        "active atau inactive (huruf besar kecil bebas). inactive: stok tidak dikirim dan pesanannya ditolak.",
        "active or inactive (any capitals). inactive: no stock is sent and its orders are refused.")},
    "stores[].order_acceptance": {"meaning": T(
        "Pengaturan terima pesanan toko. Tampil sebagai terima MANUAL; Ops HQ diperingatkan bila bukan MANUAL.",
        "The store's order acceptance setting. Shown as terima MANUAL; Ops HQ is warned when it is not MANUAL.")},
    "skus": {"meaning": T("SKU di Hiryu. Produk di WMS.", "Hiryu's SKUs. Products in the WMS.")},
    "skus[].sku_code": {"meaning": T(
        "Kode SKU Hiryu. Mencari produk tanpa melihat huruf besar kecil; kode baru membuat produk untuk merek toko yang memakainya.",
        "The Hiryu SKU code. Finds the product ignoring capitals; a new code creates a product for the brand of the store that uses it.")},
    "skus[].name": {"meaning": T("Nama SKU. Nama produk di semua layar.", "The SKU's name. The product name on every screen.")},
    "skus[].barcodes": {"meaning": T(
        "Barcode SKU, huruf dan angka, maks. 64. Didaftarkan untuk pindai; barcode milik produk lain masuk problems.",
        "The SKU's barcodes, letters and digits, up to 64. Registered for scanning; a barcode on another product goes to problems.")},
    "menus": {"meaning": T("Menu di Hiryu, satu per toko.", "Hiryu's menus, one per store.")},
    "menus[].hiryu_store_id": {"meaning": T("Toko pemilik menu. Toko tak dikenal masuk problems.",
                                            "The store the menu belongs to. An unknown store goes to problems.")},
    "menus[].items": {"meaning": T("Item di menu. Satu item menu per isi.", "The menu's items. One menu item per entry.")},
    "menus[].items[].item_id": {"meaning": T(
        "ID item menu, sama dengan hiryu_item_id di pesan 1. Kunci item.",
        "The menu item ID, the same as hiryu_item_id in message 1. The item's key.")},
    "menus[].items[].name": {"meaning": T("Nama item di menu. Tampil di Menu & toko Hiryu.",
                                          "The item's name on the menu. Shown on Menu & toko Hiryu.")},
    "menus[].items[].sku_code": {"meaning": T(
        "SKU di Bundles; null bila belum dihubungkan. null tampil sebagai Item tanpa SKU: pesanannya tidak bisa diambil.",
        "The SKU in Bundles; null when not linked yet. null shows as Item tanpa SKU: its orders cannot be picked.")},
    "menus[].items[].units_per_sale": {"meaning": T(
        "Unit SKU dalam satu item (Bundles). Menjelaskan units di pesan 1.",
        "Units of the SKU in one item (Bundles). Explains units in message 1.")},
    "menus[].items[].price": {"meaning": T("Harga menu item hari ini, rupiah. Disimpan per hari untuk laporan penjualan merek.",
                                           "The item's menu price today, in rupiah. Kept per day for the brand sales report.")},
    "menus[].items[].available": {"meaning": T("Sakelar nyala atau mati item di Hiryu. Tampil di daftar menu.",
                                               "The item's on or off switch in Hiryu. Shown on the menu list.")},
}

# The business name of every field: what ops call it, first column of the
# field table. Every row must have one (the build fails otherwise).
MSG_ID_NAME = T("Nomor pesan (sekali saja)", "Message number (used once)")
GRAB_ORDER = T("Nomor pesanan Grab", "Grab order number")
GM_NO = T("Nomor GM (slip Hiryu)", "GM number (Hiryu slip)")
STORE = T("Toko", "Store")
SKU = T("Kode produk (SKU)", "Product code (SKU)")

NAMES_ORDER = {
    "message_id": MSG_ID_NAME,
    "grab_order_id": GRAB_ORDER,
    "gm_number": GM_NO,
    "hiryu_store_id": STORE,
    "order_time": T("Waktu pelanggan memesan", "Time the customer ordered"),
    "scheduled_time": T("Waktu pesanan terjadwal", "Scheduled order time"),
    "estimated_ready_time": T("Perkiraan siap dari Grab", "Grab's estimated ready time"),
    "lines": T("Barang yang dipesan", "Items ordered"),
    "lines[].hiryu_item_id": T("Item menu", "Menu item"),
    "lines[].item_qty": T("Jumlah item dipesan", "Item quantity ordered"),
    "lines[].sku_code": SKU,
    "lines[].units": T("Unit yang diambil", "Units to pick"),
    "lines[].item_price": T("Harga menu", "Menu price"),
    "lines[].oos_instruction": T("Instruksi pelanggan jika barang habis", "Customer's instruction if out of stock"),
    "lines[].oos_instruction.type": T("Pilihan pelanggan", "Customer's choice"),
    "lines[].oos_instruction.replace_hiryu_item_id": T("Item pengganti", "Replacement item"),
    "lines[].oos_instruction.replace_sku_code": T("Kode produk pengganti", "Replacement product code"),
    "lines[].oos_instruction.replace_units": T("Unit pengganti yang diambil", "Replacement units to pick"),
}

NAMES_CANCEL = {
    "(path) grab_order_id": GRAB_ORDER,
    "message_id": MSG_ID_NAME,
    "reason_code": T("Kode alasan batal", "Cancel reason code"),
    "reason": T("Alasan batal", "Cancel reason"),
    "cancelled_by": T("Dibatalkan oleh", "Cancelled by"),
    "cancelled_at": T("Waktu batal", "Time cancelled"),
}

_DAYS_PATH = "dark_stores[].opening_hours.{mon,tue,wed,thu,fri,sat,sun}"
NAMES_CATALOGUE = {
    "message_id": MSG_ID_NAME,
    "full": T("Daftar lengkap?", "Whole list?"),
    "request_id": T("Jawaban untuk permintaan", "Answer to request"),
    "dark_stores": T("Dark store", "Dark stores"),
    "dark_stores[].hiryu_dark_store_id": T("Nomor dark store di Hiryu", "Dark store number in Hiryu"),
    "dark_stores[].name": T("Nama dark store", "Dark store name"),
    "dark_stores[].address": T("Alamat dark store", "Dark store address"),
    "dark_stores[].opening_hours": T("Jam buka", "Opening hours"),
    _DAYS_PATH: T("Jam buka per hari", "Hours per day"),
    _DAYS_PATH + "[].open": T("Buka pukul", "Opens at"),
    _DAYS_PATH + "[].close": T("Tutup pukul", "Closes at"),
    "stores": T("Toko", "Stores"),
    "stores[].hiryu_store_id": T("Nomor toko di Hiryu", "Store number in Hiryu"),
    "stores[].name": T("Nama toko", "Store name"),
    "stores[].hiryu_dark_store_id": T("Dark store tempat toko", "The store's dark store"),
    "stores[].status": T("Toko aktif?", "Store active?"),
    "stores[].order_acceptance": T("Cara terima pesanan", "How orders are accepted"),
    "skus": T("Produk (SKU)", "Products (SKUs)"),
    "skus[].sku_code": SKU,
    "skus[].name": T("Nama produk", "Product name"),
    "skus[].barcodes": T("Barcode", "Barcodes"),
    "menus": T("Menu toko", "Store menus"),
    "menus[].hiryu_store_id": STORE,
    "menus[].items": T("Item di menu", "Menu items"),
    "menus[].items[].item_id": T("Item menu", "Menu item"),
    "menus[].items[].name": T("Nama di menu", "Name on the menu"),
    "menus[].items[].sku_code": SKU,
    "menus[].items[].units_per_sale": T("Unit per penjualan", "Units per sale"),
    "menus[].items[].price": T("Harga menu", "Menu price"),
    "menus[].items[].available": T("Item menyala di menu?", "Item switched on?"),
}

INBOUND = [
    {
        "key": "1", "no": 1, "log_type": "order", "model": hiryu_link.OrderMessage, "handler": "handle_order",
        "name": T("Pesanan untuk diambil", "Order to pick"),
        "h": ["H1", "H9"], "method": "POST", "path": "/api/hiryu/v1/orders",
        "example": EX_ORDER, "ann": ANN_ORDER, "names": NAMES_ORDER,
        "timing": {"agree": True, "event": T(
            "Staf menekan Terima di Hiryu. Hanya pesanan yang diterima yang dikirim.",
            "Staff press Terima in Hiryu. Only an accepted order is sent."),
            "speed": T(
            "Usulan: Hiryu mengirim saat itu juga, dalam beberapa detik setelah Terima, karena jam 10 menit sudah berjalan sejak pelanggan memesan. "
            "Bila WMS tidak menjawab, Hiryu mencoba lagi dengan message_id yang sama. (untuk disepakati dengan Shaun)",
            "Proposal: Hiryu sends at once, within a few seconds of Terima, because the 10-minute clock has been running since the customer ordered. "
            "If the WMS does not answer, Hiryu retries with the same message_id. (to agree with Shaun)")},
        "triggers": [
            {"side": "hiryu", "h": ["H1"], "text": T(
                "Staf menekan Terima di Hiryu. Sekali per pesanan, saat itu juga.",
                "Staff press Accept in Hiryu. Once per order, at that moment.")},
            {"side": "hiryu", "h": ["H9"], "text": T(
                "Setiap baris membawa pilihan pelanggan bila barang habis (oos_instruction), atau null.",
                "Every line carries the customer's out-of-stock choice (oos_instruction), or null.")},
            {"side": "wms", "h": [], "text": T(
                "Uji di WMS: Buat pesanan dummy (Mode demo) dan simulator menjalankan handler yang sama. Di log tampil sebagai Demo atau Simulator.",
                "Tests in the WMS: Buat pesanan dummy (Mode demo) and the simulator run the same handler. The log shows them as Demo or Simulator.")},
        ],
        "answers": [
            {"status": 201, "model": hiryu_link.OrderAnswer, "body": {"order_id": 123, "status": "accepted"},
             "when": T("Diterima: pesanan dan tugas ambilnya dibuat, stok ditahan.",
                       "Taken: the order and its pick are made, stock is held.")},
            {"status": 200, "model": hiryu_link.OrderAnswer, "body": {"order_id": 123, "status": "duplicate"},
             "when": T("grab_order_id yang sama dengan message_id baru: sudah ada, tidak ada yang berubah.",
                       "The same grab_order_id with a new message_id: already there, nothing changes.")},
            {"status": "replay", "body": None,
             "when": T("message_id yang sama lagi: jawaban pertama diulang persis (status dan isi), tidak ada yang berubah.",
                       "The same message_id again: the first answer exactly (status and body), nothing changes.")},
            {"status": 422, "source": "Toko Hiryu #{body.hiryu_store_id} tidak dikenal atau tidak aktif",
             "body": {"detail": "Toko Hiryu #903 tidak dikenal atau tidak aktif. Ops HQ sudah diberi tahu. / "
                                "Hiryu store #903 is unknown or inactive. Ops HQ has been flagged."},
             "when": T("Toko tidak dikenal atau tidak aktif. Ops HQ diberi tahu di Perlu tindakan.",
                       "The store is unknown or inactive. Ops HQ is flagged on Perlu tindakan.")},
            {"status": 422, "source": "menunggu Ops HQ memilih merek dan akun",
             "body": {"detail": "Toko Hiryu #903 menunggu Ops HQ memilih merek dan akun merchant Grab. / "
                                "Hiryu store #903 is waiting for Ops HQ to pick its brand and Grab merchant account."},
             "when": T("Toko baru dari pesan 6 yang belum diberi merek oleh Ops HQ.",
                       "A new store from message 6 whose brand Ops HQ has not picked yet.")},
            {"status": 422, "source": "Kode SKU tidak dikenal: {codes}. Ops HQ sudah diberi tahu.",
             "body": {"detail": "Kode SKU tidak dikenal: LAB-GB-MC-999. Ops HQ sudah diberi tahu. / "
                                "Unknown SKU code: LAB-GB-MC-999. Ops HQ has been flagged."},
             "when": T("Kode SKU di baris tidak dikenal untuk merek toko ini.",
                       "A line's SKU code is not known for this store's brand.")},
            {"status": 422, "source": "waktu tanpa zona / time has no zone",
             "body": {"detail": "order_time: waktu tanpa zona / time has no zone"},
             "when": T("Waktu tanpa zona (berlaku juga untuk scheduled_time dan estimated_ready_time).",
                       "A time with no zone (the same for scheduled_time and estimated_ready_time).")},
            {"status": 422, "probe": {"add": {"customer_name": "x"}},
             "when": T("Field yang tidak ada di peta, atau nilai di luar aturan. Jawaban dari FastAPI, satu isi per masalah.",
                       "A field not on the map, or a value outside the rules. FastAPI's answer, one entry per problem.")},
            {"status": 401, "probe": {"bad_key": True},
             "when": T("X-Hiryu-Key tidak ada atau salah.", "X-Hiryu-Key missing or wrong.")},
        ],
        "next": [
            {"side": "wms", "text": T(
                "Pesanan masuk antrean ambil dengan nomor GM-nya, saat itu juga. Pesanan terjadwal menunggu di Terjadwal sampai 20 menit sebelum waktunya.",
                "The order joins the pick queue with its GM number at once. A scheduled order waits in Terjadwal until 20 minutes before its time.")},
            {"side": "wms", "text": T(
                "Unit ditahan, jadi pesan 3 berangkat untuk setiap SKU yang angkanya berubah (H3).",
                "Units are held, so message 3 goes for every SKU whose number changed (H3).")},
            {"side": "wms", "text": T(
                "Pembatalan yang datang lebih dulu dijalankan sekarang. Pengganti tak dikenal atau tidak lengkap: baris jadi cancel_order dan Ops HQ diberi tahu.",
                "A cancel that came first is applied now. An unknown or incomplete replacement: the line becomes cancel_order and Ops HQ is flagged.")},
            {"side": "hiryu", "text": T(
                "Setelah 2xx tidak ada langkah lagi sampai pesan 4 atau 5. Setelah 422 jangan coba lagi; tandai gagal. Setelah Ops HQ membereskan toko atau SKU, kirim pesan yang sama lagi.",
                "After 2xx nothing more until message 4 or 5. After 422 do not retry; mark it failed. Once Ops HQ fixes the store or SKU, send the same message again.")},
        ],
    },
    {
        "key": "2", "no": 2, "log_type": "cancel", "model": hiryu_link.CancelMessage, "handler": "handle_cancel",
        "name": T("Pesanan dibatalkan", "Order cancelled"),
        "h": ["H2"], "method": "POST", "path": "/api/hiryu/v1/orders/{grab_order_id}/cancel",
        "path_example": EX_CANCEL_PATH, "example": EX_CANCEL, "ann": ANN_CANCEL, "names": NAMES_CANCEL,
        "timing": {"agree": True, "event": T(
            "Grab atau pelanggan membatalkan, atau merchant membatalkan di Hiryu (juga setelah pesan 5).",
            "Grab or the customer cancels, or the merchant cancels in Hiryu (also after message 5)."),
            "speed": T(
            "Usulan: Hiryu mengirim saat itu juga, begitu tahu pesanan batal, supaya picker berhenti dan stoknya dilepas. (untuk disepakati dengan Shaun)",
            "Proposal: Hiryu sends at once, as soon as it knows the order is cancelled, so the picker stops and the stock is released. (to agree with Shaun)")},
        "triggers": [
            {"side": "hiryu", "h": ["H2"], "text": T(
                "Pelanggan membatalkan di Grab, Grab membatalkan, atau merchant membatalkan di Hiryu.",
                "The customer cancels on Grab, Grab cancels, or the merchant cancels in Hiryu.")},
            {"side": "hiryu", "h": ["H2", "H5"], "text": T(
                "Setelah pesan 5 dengan cancel_order: Hiryu membatalkan di Grab dengan 2001 lalu mengirim ini, cancelled_by merchant.",
                "After message 5 with cancel_order: Hiryu cancels on Grab with 2001, then sends this with cancelled_by merchant.")},
            {"side": "hiryu", "h": ["H2", "H10"], "text": T(
                "Setelah pesan 5 dengan replaced atau removed, bila Grab tidak mengizinkan Edit order: batal dengan 2001, lalu kirim ini.",
                "After message 5 with replaced or removed, when Grab does not allow Edit order: cancel with 2001, then send this.")},
            {"side": "wms", "h": [], "text": T(
                "Uji di WMS: stand-in Hiryu (Mode demo) mengirimnya setelah item_short dengan cancel_order; simulator juga bisa.",
                "Tests in the WMS: the Hiryu stand-in (Mode demo) sends it after item_short with cancel_order; the simulator can too.")},
        ],
        "answers": [
            {"status": 200, "model": hiryu_link.CancelAnswer, "body": {"order_id": 123, "status": "cancelled"},
             "when": T("Pesanan dibatalkan sekarang.", "The order is cancelled now.")},
            {"status": 200, "model": hiryu_link.CancelAnswer, "body": {"order_id": 123, "status": "already_cancelled"},
             "when": T("Sudah batal (pesan 2 sebelumnya, atau dihentikan WMS setelah barang tidak ada). Kode dan siapa yang membatalkan tetap disimpan.",
                       "Already cancelled (an earlier message 2, or stopped by the WMS after a missing item). The code and who cancelled are still kept.")},
            {"status": 200, "model": hiryu_link.CancelAnswer, "body": {"order_id": None, "status": "pending"},
             "when": T("Pesanan belum dikenal: pembatalan disimpan dan dijalankan saat pesan 1 tiba.",
                       "The order is not known yet: the cancel is kept and applied when message 1 arrives.")},
            {"status": "replay", "body": None,
             "when": T("message_id yang sama lagi: jawaban pertama diulang persis, tidak ada yang berubah.",
                       "The same message_id again: the first answer exactly, nothing changes.")},
            {"status": 422, "source": "grab_order_id tidak valid / invalid grab_order_id",
             "body": {"detail": "grab_order_id tidak valid / invalid grab_order_id"},
             "when": T("grab_order_id di alamat tidak cocok dengan polanya.", "The grab_order_id in the path does not match its pattern.")},
            {"status": 422, "source": "waktu tanpa zona / time has no zone",
             "body": {"detail": "cancelled_at: waktu tanpa zona / time has no zone"},
             "when": T("cancelled_at tanpa zona.", "cancelled_at has no zone.")},
            {"status": 422, "probe": {"set": {"reason_code": "2009"}},
             "when": T("Nilai di luar aturan atau field yang tidak ada di peta. Jawaban dari FastAPI.",
                       "A value outside the rules or a field not on the map. FastAPI's answer.")},
            {"status": 401, "probe": {"bad_key": True},
             "when": T("X-Hiryu-Key tidak ada atau salah.", "X-Hiryu-Key missing or wrong.")},
        ],
        "next": [
            {"side": "wms", "text": T(
                "Tahanan stok dilepas (pesan 3 untuk SKU itu), unit yang sudah diambil masuk Kembalikan ke rak, paket di rak siap tampil Dibatalkan, pesanan jadi merah dengan kodenya.",
                "Holds are released (message 3 for those SKUs), picked units go to Kembalikan ke rak, a parcel on the ready shelf shows Dibatalkan, the order turns red with its code.")},
            {"side": "wms", "text": T("Pesan 4 tidak pernah dikirim untuk pesanan yang batal.",
                                      "Message 4 is never sent for a cancelled order.")},
            {"side": "hiryu", "text": T("Tidak ada langkah lagi.", "Nothing more to do.")},
        ],
    },
    {
        "key": "6", "no": 6, "log_type": "catalogue", "model": hiryu_link.CatalogueMessage, "handler": "handle_catalogue",
        "name": T("Katalog", "Catalogue"),
        "h": ["H6"], "method": "POST", "path": "/api/hiryu/v1/catalogue",
        "example": EX_CATALOGUE, "ann": ANN_CATALOGUE, "names": NAMES_CATALOGUE,
        "timing": {"agree": True, "event": T(
            "Katalog berubah di Hiryu (dark store, toko, menu, item, bundle atau SKU). Isi yang sama adalah jawaban tarik katalog.",
            "The catalogue changes in Hiryu (dark store, store, menu, item, bundle or SKU). The same body is the answer to the catalogue pull."),
            "speed": T(
            f"Usulan: setiap kali katalog berubah, Hiryu mengirim yang berubah saat itu juga. Jawaban tarik katalog paling lambat {PULL_SECS} dtk. (untuk disepakati dengan Shaun)",
            f"Proposal: whenever the catalogue changes, Hiryu sends what changed at once. The answer to a catalogue pull within {PULL_SECS} s. (to agree with Shaun)")},
        "triggers": [
            {"side": "hiryu", "h": ["H6"], "text": T(
                "Dark store, toko, menu, item, bundle atau SKU dibuat atau berubah di Hiryu: kirim yang berubah, full false.",
                "A dark store, store, menu, item, bundle or SKU is created or changed in Hiryu: send what changed, full false.")},
            {"side": "wms", "h": ["H6"], "text": T(
                "Sinkron ulang dari Hiryu: WMS menarik katalog (GET POS_CATALOGUE_URL) dan Hiryu menjawab dengan isi ini, full true. WMS menjalankannya lewat penangan yang sama.",
                "Sinkron ulang dari Hiryu: the WMS pulls the catalogue (GET POS_CATALOGUE_URL) and Hiryu answers with this body, full true. The WMS runs it through the same handler.")},
            {"side": "wms", "h": [], "text": T(
                "Uji di WMS: di Mode demo stand-in Hiryu menjawab tarik katalog dengan pesan 6 penuh dari data yang sudah ada di WMS.",
                "Tests in the WMS: in Mode demo the Hiryu stand-in answers the catalogue pull with a full message 6 built from what the WMS already holds.")},
        ],
        "answers": [
            {"status": 200, "model": hiryu_link.CatalogueAnswer,
             "body": {"stores": 1, "skus_created": 0, "skus_updated": 1, "items": 1, "problems": []},
             "when": T("Diterima. Hitungan yang diproses.", "Taken. Counts of what was processed.")},
            {"status": 200, "model": hiryu_link.CatalogueAnswer, "source": "tidak dikenal / unknown dark store",
             "body": {"stores": 0, "skus_created": 0, "skus_updated": 1, "items": 1,
                      "problems": ["Toko/store #905: dark store #99 tidak dikenal / unknown dark store"]},
             "when": T("Sebagian diterima: yang tidak bisa ditaruh dilewati dan dicatat di problems (maks. 200), sisanya diambil. Ops HQ diberi tahu.",
                       "Partly taken: what cannot be placed is skipped and listed in problems (up to 200), the rest is taken. Ops HQ is flagged.")},
            {"status": "replay", "body": None,
             "when": T("message_id yang sama lagi: jawaban pertama diulang persis, tidak ada yang berubah.",
                       "The same message_id again: the first answer exactly, nothing changes.")},
            {"status": 422, "probe": {"set_path": ["stores", 0, "status", "paused"]},
             "when": T("Nilai di luar aturan atau field yang tidak ada di peta: seluruh pesan ditolak. Jawaban dari FastAPI.",
                       "A value outside the rules or a field not on the map: the whole message is refused. FastAPI's answer.")},
            {"status": 401, "probe": {"bad_key": True},
             "when": T("X-Hiryu-Key tidak ada atau salah.", "X-Hiryu-Key missing or wrong.")},
        ],
        "next": [
            {"side": "wms", "text": T(
                "Dark store baru muncul dengan tanda Baru dari Hiryu; Ops HQ melengkapi kode dark store, bin dan keranjang di Dark store & mulai operasi.",
                "A new dark store shows up marked Baru dari Hiryu; Ops HQ completes its dark store code, bins and baskets on Dark store & mulai operasi.")},
            {"side": "wms", "text": T(
                "Toko baru menunggu Ops HQ memilih merek dan akun merchant Grab; sampai itu tidak ada yang dikirim untuknya. Begitu toko aktif, WMS mengirim snapshot stok penuhnya (H8). SKU baru dibuat untuk merek toko yang memakainya; Ops HQ melengkapinya (Lengkapi data SKU).",
                "A new store waits for Ops HQ to pick its brand and Grab merchant account; until then nothing is sent for it. Once the store is active, the WMS sends its full stock snapshot (H8). A new SKU is made for the brand of the store that uses it; Ops HQ completes it (Lengkapi data SKU).")},
            {"side": "wms", "text": T(
                "Jawaban tarik katalog: Sinkron ulang tampil Katalog diterima di Menu & toko Hiryu.",
                "The answer to a catalogue pull: Sinkron ulang shows Catalogue taken on Menu & toko Hiryu.")},
            {"side": "hiryu", "text": T(
                "Periksa problems di jawaban; perbaiki di Hiryu dan kirim lagi bagian itu.",
                "Check problems in the answer; fix them in Hiryu and send that part again.")},
        ],
    },
]


# ==========================================================================
# WMS to Hiryu: messages 3, 4, 5 (and the catalogue pull, further down)
# ==========================================================================

ENVELOPE_ANN = {
    "message_id": {"allowed": T("wms-<nomor antrean>", "wms-<queue number>"), "meaning": T(
        "WMS membuatnya, unik per pesan; percobaan ulang memakai yang sama. Juga dikirim sebagai header Idempotency-Key.",
        "The WMS makes it, unique per message; a retry reuses it. Also sent as the Idempotency-Key header.")},
    "type": {"meaning": T("Jenis pesan; isi data mengikuti jenis ini.", "The message type; what is in data follows it.")},
    "sent_at": {"allowed": T("UTC dengan Z, sampai detik", "UTC with Z, to the second"),
                "meaning": T("Saat WMS mengirim pesan ini, diisi ulang di setiap percobaan.", "When the WMS sent it, set again on every attempt.")},
    "data": {"meaning": T("Isi pesan, field di bawah.", "The message itself, the fields below.")},
}
ENVELOPE_NAMES = {
    "message_id": MSG_ID_NAME,
    "type": T("Jenis pesan", "Message type"),
    "sent_at": T("Waktu kirim", "Time sent"),
    "data": T("Isi pesan", "Message content"),
}

UTC_Z = T("UTC dengan Z, sampai detik", "UTC with Z, to the second")
CAPS = T("huruf besar", "in capitals")


# --- When and how fast (the WMS side, read from the code) --------------------

def _sender_every() -> int:
    """The sender loop's pause in main.py: how often queued messages are picked up."""
    src = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
    m = re.search(r"async def _hiryu_sender_loop\(\):(.*?)(?=\n(?:async def|def|@)\s)", src, re.S)
    body = m.group(1) if m else ""
    s = re.search(r"asyncio\.sleep\((\d+)\)", body)
    if not s or "pos_sender.loop_tick()" not in body:
        fail("main.py: _hiryu_sender_loop no longer sleeps a fixed time and calls pos_sender.loop_tick()")
        return 5
    return int(s.group(1))


SENDER_EVERY = _sender_every()
RW = retry_words()


def out_speed(first: dict) -> dict:
    """The speed sentence of a WMS to Hiryu message: its own first sentence,
    then the sender loop and the retry schedule, both from the code."""
    n = SENDER_EVERY
    return T(f"{first['id']} Pengirim WMS memeriksa antrean tiap {n} dtk, jadi pesan biasanya berangkat dalam sekitar {n} dtk. "
             f"Bila Hiryu tidak menjawab atau sibuk: coba lagi setelah {RW['id']}.",
             f"{first['en']} The WMS sender checks the queue every {n} s, so a message usually leaves within about {n} s. "
             f"If Hiryu does not answer or is busy: retried after {RW['en']}.")


ORDER_FIRST = T("Pesan pesanan: berangkat lebih dulu dari pesan stok yang sedang menunggu.",
                "An order message: it leaves ahead of any stock messages waiting.")

OUTBOUND = [
    {
        "key": "3", "no": 3, "log_type": "stock_level", "queue_type": "stock_level", "builder": "_build_stock",
        "name": T("Level stok", "Stock level"), "h": ["H3", "H8"],
        "example": {"message_id": "wms-40211", "type": "stock_level", "sent_at": "2026-10-01T02:15:04Z",
                    "data": {"hiryu_store_id": 902, "sku_code": "KHF-FW-OAC-100", "available": 7,
                             "as_of": "2026-10-01T02:15:03Z", "is_snapshot": False}},
        "names": {
            "data.hiryu_store_id": STORE,
            "data.sku_code": SKU,
            "data.available": T("Jumlah yang bisa dijual di Grab", "Units Grab can sell"),
            "data.as_of": T("Waktu angka dihitung", "Time the number was worked out"),
            "data.is_snapshot": T("Bagian dari kirim ulang semua stok?", "Part of a full stock resend?"),
        },
        "timing": {"agree": False, "event": T(
            "Angka yang bisa dijual berubah: barang ditaruh di bin, unit ditahan untuk pesanan baru atau dilepas saat batal, barang tidak ada, "
            "hitung stok disetujui, koreksi stok. Kirim ulang semua angka (snapshot penuh): tiap malam 03:00 WIB, saat sambungan dinyalakan, "
            "atau tombol Kirim ulang semua angka stok ke Hiryu di halaman Stok.",
            "The number Grab can sell changes: a delivery put away, units held for a new order or released on a cancel, a missing item, "
            "a count approved, a stock correction. Every number again (full snapshot): every night at 03:00 WIB, when the link is switched on, "
            "or the button Kirim ulang semua angka stok ke Hiryu on the Stok page."),
            "speed": out_speed(T(
                "Berangkat setelah pesan pesanan (4, 5) yang menunggu. Angka yang sama dengan angka terakhir yang dikirim tidak dikirim lagi.",
                "It leaves after any order messages (4, 5) waiting. A number equal to the last one sent is not sent again."))},
        "ann": {
            "data.hiryu_store_id": {"meaning": T(
                "Toko Hiryu yang aktif untuk merek ini di dark store ini, dengan sambungan menyala (Kahf - Cawang #902). Stok toko mana yang disetel.",
                "The active Hiryu store for this brand at this dark store, with its link on (Kahf - Cawang is #902). Which store's stock to set.")},
            "data.sku_code": {"allowed": CAPS, "meaning": T("Kode SKU Hiryu. SKU mana yang disetel.",
                                                            "The SKU's Hiryu code. Which SKU to set.")},
            "data.available": {"allowed": T("0 atau lebih", "0 or more"), "meaning": T(
                "Di rak, dikurangi yang ditahan untuk pesanan yang belum diambil, tidak pernah di bawah 0. Hiryu menyetel Units on hand ke angka ini, tidak pernah menambah atau mengurangi.",
                "On the shelf, minus units held for orders not yet picked, never below 0. Hiryu sets Units on hand to this number, never adds or subtracts it.")},
            "data.as_of": {"allowed": UTC_Z, "meaning": T(
                "Saat angka dihitung, yaitu saat dikirim. Hiryu mengabaikan angka yang lebih tua dari yang sudah ia punya.",
                "When the number was worked out, which is when it was sent. Hiryu ignores a number older than the one it has.")},
            "data.is_snapshot": {"meaning": T(
                "true untuk setiap pesan snapshot penuh (sambungan dinyalakan, 03:00 WIB, tombol Kirim ulang semua angka stok ke Hiryu di halaman Stok). Angkanya dipakai sama saja.",
                "true for every message of a full snapshot (link switched on, 03:00 WIB, the button Kirim ulang semua angka stok ke Hiryu on the Stok page). The number is used the same way.")},
        },
        "triggers": [
            {"side": "wms", "h": ["H3"], "text": T(
                "Setiap gerakan stok untuk toko dan SKU itu: barang masuk ditaruh di bin, unit ditahan untuk pesanan baru, tahanan dilepas saat batal, dikembalikan ke rak, keluar dari dark store, koreksi barang masuk.",
                "Every stock move for that store and SKU: delivery put away, units held for a new order, holds released on a cancel, units returned to the rack, units leaving the dark store, a delivery corrected.")},
            {"side": "wms", "h": ["H3", "H5"], "text": T(
                "Barang tidak ada: bin disetel ke jumlah yang ditemukan.",
                "Missing item: the bin is set to what was found.")},
            {"side": "wms", "h": ["H3"], "text": T(
                "Hitung stok disetujui, karantina atau hapus buku, koreksi stok.",
                "A count approved, quarantine or write-off, a stock correction.")},
            {"side": "wms", "h": ["H8"], "text": T(
                "Snapshot penuh: satu toko baru menjadi aktif (merek dipilih, atau Hiryu mengaktifkannya; stok toko itu), Sambungan Hiryu aktif dinyalakan (semua toko), tiap malam 03:00 WIB, atau Ops HQ menekan Kirim ulang semua angka stok ke Hiryu di halaman Stok.",
                "Full snapshot: a store becomes active (brand chosen, or Hiryu activates it; that store's stock), Sambungan Hiryu aktif switched on (every store), every night at 03:00 WIB, or Ops HQ presses Kirim ulang semua angka stok ke Hiryu on the Stok page.")},
        ],
        "rules": [
            T("Angka dihitung saat dikirim, jadi beberapa pindai beruntun mengirim satu angka saja.",
              "The number is worked out when it is sent, so a burst of scans sends one number."),
            T("Angka yang sama dengan pesan terakhir untuk SKU itu tidak dikirim lagi (snapshot selalu dikirim). Mengambil unit yang sudah ditahan biasanya tidak mengubah angka.",
              "A number equal to the last one sent for that SKU is not sent again (a snapshot always is). Picking units already held usually leaves the number unchanged."),
            T("Untuk setiap toko aktif (aktif di Hiryu, merek dipilih, dark store ada di katalog Hiryu), tanpa sakelar per toko, dan hanya SKU yang punya kode Hiryu.",
              "For every active store (active in Hiryu, brand chosen, dark store in Hiryu's catalogue), with no switch per store, and only SKUs that have a Hiryu code."),
        ],
        "next": [
            {"side": "hiryu", "text": T(
                "Setel Units on hand toko dan SKU itu ke available, lalu teruskan ke Grab seperti sekarang. Abaikan bila as_of lebih tua dari angka yang ada.",
                "Set Units on hand for that store and SKU to available, then pass it on to Grab as today. Ignore it when as_of is older than the number you have.")},
            {"side": "hiryu", "text": T(
                "Setelah Sambungan Hiryu aktif menyala, untuk setiap toko aktif (H8): tidak ada pengurangan sendiri saat Tandai siap dan tidak ada penambahan setelah batal.",
                "Once Sambungan Hiryu aktif is on, for every active store (H8): no own deduction at Mark ready and no restore after a cancel.")},
        ],
    },
    {
        "key": "4", "no": 4, "log_type": "order_ready", "queue_type": "order_ready", "builder": "_build_ready",
        "name": T("Pesanan siap", "Order ready"), "h": ["H4"],
        "example": {"message_id": "wms-40377", "type": "order_ready", "sent_at": "2026-10-01T02:48:11Z",
                    "data": {"grab_order_id": "A-7Q2K9XW3M4", "gm_number": "GM-358",
                             "packed_at": "2026-10-01T02:48:10Z"}},
        "names": {
            "data.grab_order_id": GRAB_ORDER,
            "data.gm_number": GM_NO,
            "data.packed_at": T("Waktu selesai dikemas", "Time packed"),
        },
        "timing": {"agree": False, "event": T(
            "Packer menekan Selesai dikemas.", "The packer taps Selesai dikemas."),
            "speed": out_speed(ORDER_FIRST)},
        "ann": {
            "data.grab_order_id": {"meaning": T("Pesanan dari pesan 1. Panggil MarkOrderReady di Grab untuk pesanan ini.",
                                                "The order from message 1. Call MarkOrderReady on Grab for this order.")},
            "data.gm_number": {"meaning": T("Pesanan dari pesan 1. Untuk cek dan log Hiryu.",
                                            "The order from message 1. A check, and for Hiryu's log.")},
            "data.packed_at": {"allowed": UTC_Z, "meaning": T("Saat packer menekan Selesai dikemas. Untuk log Hiryu.",
                                                              "When the packer tapped Selesai dikemas. For Hiryu's log.")},
        },
        "triggers": [
            {"side": "wms", "h": ["H4"], "text": T(
                "Packer menekan Selesai dikemas setelah mengetik nomor GM dari slip.",
                "The packer taps Selesai dikemas after typing the GM number from the slip.")},
        ],
        "rules": [
            T("Hanya untuk pesanan yang datang lewat pesan 1. Tidak pernah untuk pesanan yang batal, pesanan tempel, pesanan UJI atau lokasi latihan.",
              "Only for orders that came by message 1. Never for a cancelled order, a pasted order, a UJI test order or the training site."),
        ],
        "next": [
            {"side": "hiryu", "text": T("Tandai pesanan siap di Grab (MarkOrderReady). Staf tidak lagi menekan Tandai siap.",
                                        "Mark the order ready on Grab (MarkOrderReady). Staff no longer press Mark ready.")},
            {"side": "wms", "text": T("Driver mengambil: serah terima dicek di WMS, tidak ada pesan yang dikirim.",
                                      "The driver collects: the handover is checked in the WMS, no message is sent.")},
        ],
    },
    {
        "key": "5", "no": 5, "log_type": "item_short", "queue_type": "order_short", "builder": "_build_short",
        "name": T("Barang kurang", "Item short"), "h": ["H5", "H10"],
        "example": {"message_id": "wms-40352", "type": "item_short", "sent_at": "2026-10-01T02:45:31Z",
                    "data": {"grab_order_id": "A-7Q2K9XW3M4", "gm_number": "GM-358",
                             "hiryu_item_id": "LAB-GB-MC-100", "sku_code": "LAB-GB-MC-100",
                             "action": "replaced", "units_wanted": 3, "units_found": 0,
                             "replace_hiryu_item_id": "LAB-GB-MC-225", "replace_sku_code": "LAB-GB-MC-225",
                             "replace_units": 1}},
        "names": {
            "data.grab_order_id": GRAB_ORDER,
            "data.gm_number": GM_NO,
            "data.hiryu_item_id": T("Item menu yang kurang", "Menu item that is short"),
            "data.sku_code": SKU,
            "data.action": T("Yang dilakukan WMS", "What the WMS did"),
            "data.units_wanted": T("Unit dipesan", "Units ordered"),
            "data.units_found": T("Unit ditemukan", "Units found"),
            "data.replace_hiryu_item_id": T("Item pengganti", "Replacement item"),
            "data.replace_sku_code": T("Kode produk pengganti", "Replacement product code"),
            "data.replace_units": T("Unit pengganti diambil", "Replacement units taken"),
        },
        "timing": {"agree": False, "event": T(
            "Picker menekan Barang tidak ada dan cek di bin lain gagal. Satu pesan per baris yang berubah.",
            "The picker taps Barang tidak ada and the look-elsewhere check fails. One message per line that changed."),
            "speed": out_speed(ORDER_FIRST)},
        "ann": {
            "data.grab_order_id": {"meaning": T("Pesanan dari pesan 1. Pesanan mana yang diubah di Grab.",
                                                "The order from message 1. Which order to change on Grab.")},
            "data.gm_number": {"meaning": T("Pesanan dari pesan 1. Untuk cek dan log Hiryu.",
                                            "The order from message 1. A check, and for Hiryu's log.")},
            "data.hiryu_item_id": {"meaning": T("Item baris dari pesan 1. Item Grab yang diubah.",
                                                "The line's item from message 1. The Grab item to change.")},
            "data.sku_code": {"allowed": CAPS, "meaning": T("SKU baris. Untuk cek.", "The line's SKU. A check.")},
            "data.action": {"meaning": T(
                "Yang dilakukan WMS. cancel_order juga untuk contact_customer, tanpa instruksi (null), pengganti yang juga tidak ada, atau pengganti tak dikenal.",
                "What the WMS did. cancel_order also for contact_customer, no instruction (null), a replacement also missing, or an unknown replacement.")},
            "data.units_wanted": {"meaning": T("units baris dari pesan 1. Bersama units_found: berapa yang kurang.",
                                               "The line's units from message 1. With units_found: what is missing.")},
            "data.units_found": {"meaning": T(
                "Unit yang ditemukan picker; tetap di pesanan. Hiryu menyetel jumlah item ke yang tertutup units_found (dibagi unit per penjualan, dibulatkan ke bawah; 0 menghapus item).",
                "Units the picker found; they stay in the order. Hiryu sets the item quantity to what units_found covers (divided by units per sale, rounded down; 0 takes the item off).")},
            "data.replace_hiryu_item_id": {"when": FOR_REPLACED, "meaning": T(
                "Dari oos_instruction di pesan 1. Item yang ditambahkan di Grab. null untuk action lain.",
                "From oos_instruction in message 1. The item to add on Grab. null for any other action.")},
            "data.replace_sku_code": {"when": FOR_REPLACED, "allowed": CAPS, "meaning": T(
                "Pengganti yang dipindai picker. Untuk cek. null untuk action lain.",
                "The replacement the picker scanned. A check. null for any other action.")},
            "data.replace_units": {"when": FOR_REPLACED, "meaning": T(
                "Unit pengganti yang diambil picker. Tambahkan item: replace_units dibagi unit per penjualannya. null untuk action lain.",
                "Units of the replacement the picker took. Add the item: replace_units divided by its units per sale. null for any other action.")},
        },
        "triggers": [
            {"side": "wms", "h": ["H5", "H10"], "text": T(
                "Picker menekan Barang tidak ada, cek di bin lain gagal, dan WMS menjalankan pilihan pelanggan: replaced atau removed. Satu pesan per baris yang berubah.",
                "The picker taps Barang tidak ada, the look-elsewhere check fails, and the WMS applies the customer's choice: replaced or removed. One message per line that changed.")},
            {"side": "wms", "h": ["H5"], "text": T(
                "Sama, tetapi pilihannya cancel_order, contact_customer, tidak ada, atau penggantinya juga tidak ada: action cancel_order.",
                "The same, but the choice is cancel_order, contact_customer, none, or the replacement is also missing: action cancel_order.")},
        ],
        "rules": [
            T("Untuk cancel_order, WMS sudah menghentikan pesanan dan melepas stoknya saat mengirim ini. Untuk replaced dan removed pesanan lanjut ke kemas; bila Hiryu lalu harus membatalkan, pesan 2 menghentikannya di WMS.",
              "For cancel_order the WMS has already stopped the order and released its stock when it sends this. For replaced and removed the order goes on to packing; if Hiryu then has to cancel, message 2 stops it in the WMS."),
            T("Tidak pernah untuk pesanan tempel, pesanan UJI atau lokasi latihan.",
              "Never for a pasted order, a UJI test order or the training site."),
        ],
        "next": [
            {"side": "hiryu", "text": T(
                "replaced atau removed: Edit order di Grab bila Grab mengizinkan (H10). Bila tidak: CheckOrderCancelable, CancelOrder dengan 2001, lalu kirim pesan 2 dengan cancelled_by merchant.",
                "replaced or removed: Edit order on Grab when Grab allows it (H10). If not: CheckOrderCancelable, CancelOrder with 2001, then send message 2 with cancelled_by merchant.")},
            {"side": "hiryu", "text": T(
                "cancel_order: CheckOrderCancelable, CancelOrder dengan 2001, lalu kirim pesan 2 dengan reason_code 2001 dan cancelled_by merchant. WMS menjawab already_cancelled.",
                "cancel_order: CheckOrderCancelable, CancelOrder with 2001, then send message 2 with reason_code 2001 and cancelled_by merchant. The WMS answers already_cancelled.")},
        ],
    },
]

# ==========================================================================
# The catalogue pull: GET POS_CATALOGUE_URL (Sinkron ulang dari Hiryu)
# ==========================================================================

EX_PULL_REQUEST_ID = "wms-cat-3-1790822400"
EX_PULL_ANSWER = copy.deepcopy(EX_CATALOGUE) | {"message_id": "hy-cat-full-3-1790822400", "full": True,
                                               "request_id": EX_PULL_REQUEST_ID}

PULL = {
    "key": "catalogue_pull", "no": None, "log_type": "catalogue_pull",
    "name": T("Tarik katalog", "Catalogue pull"), "h": ["H6"],
    "call": {"method": "GET", "path": "POS_CATALOGUE_URL",
             "url": "https://<hiryu>/catalogue?request_id=" + EX_PULL_REQUEST_ID,
             "who": T("WMS memanggil Hiryu", "The WMS calls Hiryu"),
             "note": T("Satu alamat baca saja di sisi Hiryu (POS_CATALOGUE_URL, disepakati dengan Shaun). Bila kosong, WMS memakai asal POS_WEBHOOK_URL ditambah /catalogue. "
                       "Tanpa isi. Hiryu menjawab 200 dengan isi pesan 6 lengkap (full true); jawaban itu masuk lewat penangan pesan 6 yang sama.",
                       "One read-only address on Hiryu's side (POS_CATALOGUE_URL, to agree with Shaun). When it is empty, the WMS uses POS_WEBHOOK_URL's origin plus /catalogue. "
                       "No body. Hiryu answers 200 with a full message 6 body (full true); that answer goes through the same message 6 handler.")},
    "headers": [{"name": "X-Hiryu-Key", "value": "<POS_SHARED_SECRET>"},
                {"name": "Accept", "value": "application/json"}],
    "fields": [{"label": T("Nomor permintaan", "Request number"), "path": "(query) request_id", "type": "string",
                "required": True, "nullable": False, "when": None,
                "allowed": [T("wms-cat-<id dark store>-<detik unix>", "wms-cat-<dark store id>-<unix seconds>")],
                "pattern": hiryu_link._MSG_ID, "example": json.dumps(EX_PULL_REQUEST_ID),
                "meaning": T("WMS membuatnya, unik per tekanan tombol. Untuk log Hiryu; Hiryu boleh mengembalikannya di request_id jawaban, atau mengabaikannya.",
                             "The WMS makes it, unique per press of the button. For Hiryu's log; Hiryu may echo it in request_id of the answer, or ignore it.")}],
    "example": EX_PULL_ANSWER,
    "triggers": [
        {"side": "wms", "h": ["H6"], "text": T(
            "Siapa pun di dark store menekan Sinkron ulang dari Hiryu di Menu & toko Hiryu. Semua peran, sekali tiap 5 menit per dark store (yang gagal tidak dihitung); nama penekan dicatat.",
            "Anyone at the dark store presses Sinkron ulang dari Hiryu on Menu & toko Hiryu. Any role, once every 5 minutes per dark store (a failed one does not count); the name is logged.")},
    ],
    "timing": {"agree": True, "event": T(
        "Seseorang menekan Sinkron ulang dari Hiryu di Menu & toko Hiryu.",
        "Someone presses Sinkron ulang dari Hiryu on Menu & toko Hiryu."),
        "speed": T(f"Saat tombol ditekan, tanpa antrean. Hiryu menjawab paling lambat {PULL_SECS} dtk; tombol menunggu jawaban itu. (untuk disepakati dengan Shaun)",
                   f"On the button press, no queue. Hiryu answers within {PULL_SECS} s; the button waits for that answer. (to agree with Shaun)")},
    "answers": [
        {"status": 200, "body": None, "when": T(
            "Isi pesan 6 lengkap, full true: semua dark store, toko, SKU dan menu, dengan message_id baru setiap jawaban. Contohnya di samping. WMS menerapkannya dan log menampilkannya sebagai pesan 6 masuk.",
            "A full message 6 body, full true: every dark store, store, SKU and menu, with a new message_id on every answer. The example is alongside. The WMS applies it and the log shows it as message 6 in.")},
        {"status": "4xx, 5xx", "body": None, "when": T(
            "Gagal, juga untuk jawaban yang bukan pesan 6 yang sah atau full false. WMS tidak mencoba lagi sendiri: tombol menampilkan Gagal dengan alasannya dan boleh ditekan lagi saat itu juga.",
            "Failed, also for an answer that is not a valid message 6 or has full false. The WMS does not retry by itself: the button shows the failure with its reason and may be pressed again at once.")},
        {"status": "timeout", "body": None, "when": T(
            f"Tidak ada jawaban dalam {PULL_SECS} detik, atau sambungan putus: gagal, seperti di atas.",
            f"No answer within {PULL_SECS} seconds, or the connection drops: failed, as above.")},
    ],
    "next": [
        {"side": "wms", "text": T(
            "Katalog diterapkan seperti pesan 6 lainnya. Tombol menampilkan Katalog diterima dengan jam dan nama penekan; yang tidak bisa dipakai masuk Perlu tindakan.",
            "The catalogue is applied like any message 6. The button shows Catalogue taken with the time and the name; what cannot be used goes to Perlu tindakan.")},
        {"side": "hiryu", "text": T(
            "Tidak ada langkah lagi. Hiryu tetap mengirim pesan 6 sendiri (POST) setiap kali katalognya berubah.",
            "Nothing more to do. Hiryu still sends message 6 by itself (POST) whenever its catalogue changes.")},
    ],
    "rules": [
        T("Terlalu cepat: tombol mendapat 429 (Bisa lagi 09:45 WIB) dan Hiryu tidak dipanggil. Batas ini di aplikasi WMS.",
          "Too soon: the button gets 429 (Bisa lagi 09:45 WIB) and Hiryu is not called. This limit is in the WMS app."),
        T("Tarik katalog tidak menunggu POS_PUSH_ENABLED atau Sambungan Hiryu aktif: katalog datang sebelum sambungan dinyalakan. Perlu alamatnya dan POS_SHARED_SECRET.",
          "The catalogue pull does not wait for POS_PUSH_ENABLED or Sambungan Hiryu aktif: the catalogue comes before switch-on. It needs its address and POS_SHARED_SECRET."),
        T("Jawaban yang bukan pesan 6 yang sah ditolak seluruhnya dan tidak mengubah apa pun; log menampilkannya Ditolak dengan alasannya.",
          "An answer that is not a valid message 6 is refused whole and changes nothing; the log shows it as Refused with the reason."),
        T("Di Mode demo stand-in Hiryu di dalam WMS menjawab dengan katalog yang sudah ada di WMS.",
          "In Mode demo the Hiryu stand-in inside the WMS answers with the catalogue the WMS already holds."),
    ],
}


OUT_ANSWERS = [
    {"status": "2xx", "body": None, "when": T(
        "Diterima. Isi jawaban bebas; WMS menyimpannya di log.", "Taken. Any body; the WMS keeps it in the log.")},
    {"status": 409, "body": None, "when": T(
        "Sudah diterima sebelumnya: duplikat. WMS menganggapnya selesai.", "Taken before: a duplicate. The WMS treats it as done.")},
    {"status": "408, 429, 5xx", "body": None, "when": T(
        "Terlalu lambat, terlalu banyak panggilan, atau Hiryu sibuk. WMS mencoba lagi sesuai jadwal.",
        "Too slow, too many calls, or Hiryu is busy. The WMS retries on the schedule.")},
    {"status": "4xx", "body": None, "when": T(
        "4xx lain, misalnya kunci salah: gagal, WMS berhenti mencoba dan menampilkannya merah di sini.",
        "Any other 4xx, for example a wrong key: failed, the WMS stops and shows it red here.")},
    {"status": "timeout", "body": None, "when": T(
        "Tidak ada jawaban dalam 8 detik, atau sambungan putus: dicoba lagi.",
        "No answer in 8 seconds, or the connection drops: retried.")},
]


# ==========================================================================
# Reading the code
# ==========================================================================

def _resolve(node: dict, defs: dict) -> dict:
    while "$ref" in node:
        node = defs[node["$ref"].split("/")[-1]]
    return node


def _split_null(node: dict, defs: dict) -> tuple[dict, bool]:
    if "anyOf" in node:
        alts = [a for a in node["anyOf"] if a.get("type") != "null"]
        nullable = len(alts) < len(node["anyOf"])
        if len(alts) != 1:
            raise SystemExit(f"cannot read a union of {len(alts)} types")
        core = dict(_resolve(alts[0], defs))
        for k in ("description", "default"):
            if k in node:
                core.setdefault(k, node[k])
        return core, nullable
    return _resolve(node, defs), False


def _limit_words(core: dict, kind: str) -> list[dict]:
    out = []
    if kind == "integer":
        lo, hi = core.get("minimum"), core.get("maximum")
        if lo is not None and hi is not None:
            out.append(T(f"{lo:,} sampai {hi:,}".replace(",", "."), f"{lo:,} to {hi:,}"))
        elif lo is not None:
            out.append(T(f"{lo} atau lebih", f"{lo} or more"))
    if kind == "string":
        pat = core.get("pattern") or ""
        # Only a pattern that is one character class with a length says the length.
        m = re.fullmatch(r"\^\[(?:\\.|[^\]])+\]\{(\d+),(\d+)\}\$", pat)
        top = core.get("maxLength")
        if "enum" in core or "const" in core:
            pass
        elif m:
            lo, hi = int(m.group(1)), int(m.group(2))
            hi = min(hi, int(top)) if top else hi
            out.append(T(f"{lo} sampai {hi} karakter", f"{lo} to {hi} characters"))
        elif top:
            out.append(T(f"maks. {top} karakter", f"up to {top} characters"))
    if kind == "array":
        lo, hi = core.get("minItems"), core.get("maxItems")
        if lo and hi:
            out.append(T(f"{lo} sampai {hi} isi", f"{lo} to {hi} entries"))
        elif hi:
            out.append(T(f"maks. {hi:,} isi".replace(",", "."), f"up to {hi:,} entries"))
    return out


def schema_rows(model) -> list[dict]:
    """Field rows from a pydantic model, in the model's own order."""
    schema = model.model_json_schema()
    defs = schema.get("$defs", {})
    rows: list[dict] = []

    def walk(node: dict, prefix: str) -> None:
        required = set(node.get("required", []))
        for name, sub in node.get("properties", {}).items():
            path = prefix + name
            core, nullable = _split_null(sub, defs)
            kind = core.get("type", "object" if "properties" in core else None)
            row = {"path": path, "required": name in required, "nullable": nullable,
                   "pattern": None, "enum": None, "limits": []}
            if "enum" in core:
                row["enum"] = list(core["enum"])
            if "const" in core:
                row["enum"] = [core["const"]]
            if kind == "array":
                items, _ = _split_null(core.get("items", {}), defs)
                if "properties" in items:
                    row["type"] = "array<object>"
                    row["limits"] = _limit_words(core, "array")
                    rows.append(row)
                    walk(items, path + "[].")
                    continue
                row["type"] = "array<" + items.get("type", "any") + ">"
                row["limits"] = _limit_words(core, "array")
                rows.append(row)
                continue
            if "properties" in core:
                row["type"] = "object"
                rows.append(row)
                walk(core, path + ".")
                continue
            row["type"] = kind
            row["pattern"] = core.get("pattern")
            row["limits"] = _limit_words(core, kind)
            rows.append(row)

    walk(schema, "")
    return _collapse_days(rows)


DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_SET = "{" + ",".join(DAYS) + "}"


def _collapse_days(rows: list[dict]) -> list[dict]:
    """opening_hours has the same shape for all seven days: one row each."""
    out, seen = [], {}
    for r in rows:
        m = re.search(r"opening_hours\.(" + "|".join(DAYS) + r")(\b|\[)", r["path"])
        if not m:
            out.append(r)
            continue
        key = r["path"].replace("opening_hours." + m.group(1), "opening_hours." + DAY_SET, 1)
        shape = {k: v for k, v in r.items() if k != "path"}
        if key in seen:
            if seen[key] != shape:
                fail(f"opening_hours: {r['path']} differs from the other days")
            continue
        seen[key] = shape
        out.append(dict(r, path=key))
    return out


def example_at(example, path: str):
    """The example value at a row path (first entry of a list); KeyError when absent."""
    path = path.replace(DAY_SET, "mon")
    cur = example
    for part in re.findall(r"[^.\[\]]+|\[\]", path):
        if part == "[]":
            if not isinstance(cur, list) or not cur:
                raise KeyError(path)
            cur = cur[0]
        else:
            if not isinstance(cur, dict) or part not in cur:
                raise KeyError(path)
            cur = cur[part]
    return cur


def example_cell(value) -> str | None:
    if isinstance(value, dict):
        return None
    if isinstance(value, list):
        if value and all(not isinstance(v, (dict, list)) for v in value):
            return json.dumps(value, ensure_ascii=False)
        return None
    return json.dumps(value, ensure_ascii=False)


def finish_row(row: dict, ann: dict, example, names: dict) -> dict:
    a = ann.get(row["path"])
    if not a:
        fail(f"no meaning written for field {row['path']}")
        a = {"meaning": T("", "")}
    label = names.get(row["path"])
    if not label or not (label.get("id") or "").strip() or not (label.get("en") or "").strip():
        fail(f"no business name written for field {row['path']}")
        label = T("", "")
    allowed = []
    if row.get("enum"):
        allowed.append(T(" | ".join(map(str, row["enum"])), " | ".join(map(str, row["enum"]))))
    allowed += row.get("limits") or []
    if a.get("allowed"):
        allowed.append(a["allowed"])
    if "example" in a:
        ex = a["example"]
    else:
        try:
            ex = example_cell(example_at(example, row["path"].replace("(path) ", "")))
        except KeyError:
            ex = None
            if row["required"]:
                fail(f"the example has no value for required field {row['path']}")
    return {
        "label": label,
        "path": row["path"], "type": row["type"], "required": row["required"], "nullable": row["nullable"],
        "when": a.get("when"), "allowed": allowed, "pattern": row.get("pattern"), "example": ex,
        "meaning": a["meaning"],
    }


# --- the outbound builders, run on a stubbed database ---------------------

FIXED_NOW = datetime(2026, 10, 1, 2, 15, 3)


class FakeDb:
    """Just enough of db.py for the four builders. Every query the builders
    make is answered from `self.rows`; an unknown query fails the run."""

    def __init__(self, line: dict | None = None):
        self.line = line or {}

    def ready(self):
        return True

    async def fetch_one(self, sql, params=()):
        s = " ".join(sql.split())
        if "FROM skus WHERE id" in s:
            return {"id": 1, "brand_id": 1, "hiryu_sku_code": "khf-fw-oac-100"}
        if "COUNT(*) AS n FROM pos_outbox" in s:
            return {"n": 0}
        if "FROM inventory_balances" in s:
            return {"avail": 8, "rack": 9, "held": 1}
        if "FROM alert_rules" in s:
            return {"value_num": 1}
        if "SELECT available FROM pos_outbox" in s:
            return None
        if "FROM stock_movements" in s:
            return {"movement_type": "receipt_in", "reason_code": None}
        if "FROM orders o" in s:
            return {"id": 123, "external_ref": "A-7Q2K9XW3M4", "hiryu_short_no": "GM-358", "source": "link",
                    "status": "packing", "marked_ready_at": datetime(2026, 10, 1, 2, 48, 10), "completed_at": None}
        if "FROM order_lines ol" in s:
            return self.line
        raise SystemExit(f"FakeDb: a builder made a query the generator does not know: {s[:120]}")

    async def fetch_all(self, sql, params=()):
        s = " ".join(sql.split())
        if "FROM hiryu_stores" in s:
            return [{"hiryu_store_no": 902}]
        raise SystemExit(f"FakeDb: a builder made a query the generator does not know: {s[:120]}")

    async def execute(self, sql, params=()):
        return 0


def _line(action: str) -> dict:
    base = {"id": 77, "order_id": 123, "sku_id": 1, "hiryu_item_id": "LAB-GB-MC-100",
            "hiryu_sku_code": "lab-gb-mc-100", "sku_hiryu_code": "LAB-GB-MC-100", "brand_sku_code": "LAB-GB-MC-100",
            "qty_ordered": 3, "qty_picked": 0, "oos_action": action, "oos_units_wanted": 3, "oos_units_found": 0,
            "oos_replace_hiryu_item_id": "LAB-GB-MC-225", "oos_replace_sku_code": "LAB-GB-MC-225",
            "oos_replace_units": 1, "oos_done_replace_sku_code": "lab-gb-mc-225", "oos_done_replace_units": 1}
    return base


def run_builders() -> dict:
    """{message key: [(data dict, meta), ...]} from the real builders, one run
    per variant (stock: normal and snapshot; item short: each action)."""
    real_db, real_now = pos_sender.db, pos_sender._utcnow
    pos_sender._utcnow = lambda: FIXED_NOW
    out: dict[str, list] = {}

    async def go():
        row = {"id": 40211, "site_id": 3, "sku_id": 1, "order_ref": "A-7Q2K9XW3M4",
               "created_at": FIXED_NOW, "payload_json": "{}"}
        pos_sender.db = FakeDb()
        for snap in (False, True):
            r = dict(row, payload_json=json.dumps({"snapshot": True}) if snap else "{}")
            msgs, _avail, meta = await pos_sender._build_stock(r)
            out.setdefault("3", []).extend((d, meta) for _mid, d in msgs)
        msgs, meta = await pos_sender._build_ready(dict(row, payload_json="{}"))
        out["4"] = [(d, meta) for _mid, d in msgs]
        for action in ("replaced", "removed", "cancel_order"):
            pos_sender.db = FakeDb(_line(action))
            msgs, meta = await pos_sender._build_short(dict(row, payload_json=json.dumps({"order_line_id": 77})))
            out.setdefault("5", []).extend((d, meta) for _mid, d in msgs)
        pos_sender.db = FakeDb()
        env = pos_sender.envelope("wms-1", "stock_level", {})
        out["_envelope"] = [(env, {})]

    try:
        asyncio.run(go())
    finally:
        pos_sender.db, pos_sender._utcnow = real_db, real_now
    return out


def _json_type(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, str):
        return "string"
    if isinstance(v, dict):
        return "object"
    if isinstance(v, list):
        return "array"
    return type(v).__name__


def outbound_rows(spec: dict, built: list, envelope_keys: list) -> list[dict]:
    rows = []
    keys = list(built[0][0].keys())
    for data, _meta in built:
        if list(data.keys()) != keys:
            fail(f"message {spec['key']}: the builder's keys differ between variants")
    for k in envelope_keys:
        t = {"message_id": "string", "type": "string", "sent_at": "string", "data": "object"}[k]
        row = {"path": k, "type": t, "required": True, "nullable": False, "pattern": None, "limits": [],
               "enum": [spec["log_type"]] if k == "type" else None}
        rows.append(finish_row(row, ENVELOPE_ANN, spec["example"], ENVELOPE_NAMES))
    for k in keys:
        types = {_json_type(d[k]) for d, _ in built}
        nullable = None in types
        types.discard(None)
        if len(types) != 1:
            fail(f"message {spec['key']}: cannot tell the type of data.{k} from the builder ({types})")
            continue
        enum = None
        if spec["key"] == "5" and k == "action":
            enum = list(pos_sender._ACTION_WORDS.keys())
        row = {"path": "data." + k, "type": types.pop(), "required": True, "nullable": nullable,
               "pattern": None, "limits": [], "enum": enum}
        rows.append(finish_row(row, spec["ann"], spec["example"], spec["names"]))
    return rows


# ==========================================================================
# Checks
# ==========================================================================

def probe_answers(spec: dict, tc) -> None:
    """Fill the 401 and validation-422 answers by calling the real router."""
    base = copy.deepcopy(spec["example"])
    path = spec["path"].replace("{grab_order_id}", spec.get("path_example", ""))
    for ans in spec["answers"]:
        probe = ans.pop("probe", None)
        if not probe:
            continue
        body = copy.deepcopy(base)
        headers = {"X-Hiryu-Key": "map-secret"}
        if probe.get("bad_key"):
            headers = {"X-Hiryu-Key": "wrong"}
        body.update(probe.get("add", {}))
        body.update(probe.get("set", {}))
        if "set_path" in probe:
            *where, key, value = probe["set_path"]
            cur = body
            for w in where:
                cur = cur[w]
            cur[key] = value
        r = tc.post(path, json=body, headers=headers)
        if r.status_code != ans["status"]:
            fail(f"message {spec['key']}: probe expected {ans['status']}, the router answered {r.status_code} {r.text[:200]}")
        ans["body"] = r.json()
        ans["request"] = {k: v for k, v in body.items() if k not in base or base[k] != v} or None


def check_inbound(spec: dict, source: str) -> None:
    model = spec["model"]
    try:
        model.model_validate(spec["example"])
    except Exception as e:  # noqa: BLE001
        fail(f"message {spec['key']}: the example is refused by {model.__name__}: {e}")
    if spec.get("path_example") and not re.fullmatch(hiryu_link._ORDER_ID, spec["path_example"]):
        fail(f"message {spec['key']}: the path example does not match _ORDER_ID")
    for name in ("order_time", "scheduled_time", "estimated_ready_time", "cancelled_at"):
        if name in spec["example"]:
            try:
                hiryu_link._utc(spec["example"][name], name)
            except Exception as e:  # noqa: BLE001
                fail(f"message {spec['key']}: {name} is refused by _utc: {e}")
    for ans in spec["answers"]:
        if ans.get("model") is not None:
            try:
                ans["model"].model_validate(ans["body"])
            except Exception as e:  # noqa: BLE001
                fail(f"message {spec['key']}: answer {ans['body']} does not fit {ans['model'].__name__}: {e}")
            if set(ans["body"].keys()) != set(ans["model"].model_fields.keys()):
                fail(f"message {spec['key']}: answer keys {sorted(ans['body'])} differ from {ans['model'].__name__}")
        words = ans.get("source")
        if words and words not in source:
            fail(f"message {spec['key']}: the words {words!r} are no longer in hiryu_link.py")
    handler = inspect.getsource(getattr(hiryu_link, spec["handler"]))
    if f'mtype="{spec["log_type"]}"' not in handler or f"no={spec['no']}" not in handler:
        fail(f"message {spec['key']}: {spec['handler']} no longer logs type {spec['log_type']} / no {spec['no']}")
    for h in spec["h"]:
        if f'"{h}' not in handler and f" {h}\"" not in handler:
            fail(f"message {spec['key']}: {spec['handler']} no longer logs {h}")


def check_routes() -> None:
    have = {(m, r.path) for r in hiryu_link.router.routes for m in r.methods}
    for spec in INBOUND:
        if (spec["method"], spec["path"]) not in have:
            fail(f"route {spec['method']} {spec['path']} is not in hiryu_link.router")
    if ("GET", "/api/hiryu/v1/ping") not in have:
        fail("route GET /api/hiryu/v1/ping is gone")
    for r in hiryu_link.router.routes:
        deps = [d.call for d in r.dependant.dependencies]
        if outbound.hiryu_or_admin not in deps:
            fail(f"route {r.path} is not protected by outbound.hiryu_or_admin")
    if "x_hiryu_key" not in inspect.signature(outbound.hiryu_or_admin).parameters:
        fail("outbound.hiryu_or_admin no longer reads X-Hiryu-Key")
    post = inspect.getsource(pos_sender._post)
    for word in ('"X-Hiryu-Key"', '"Idempotency-Key"', "webhook_url()", "r.status_code == 409"):
        if word not in post:
            fail(f"pos_sender._post no longer has {word}")
    if not pos_sender._permanent(400) or pos_sender._permanent(408) or pos_sender._permanent(429):
        fail("pos_sender._permanent no longer matches the answers table (408 and 429 retry)")
    if pos_sender.HTTP_TIMEOUT != 8.0:
        fail("pos_sender.HTTP_TIMEOUT changed: update the answers table")


def check_outbound(spec: dict, built: list, envelope_keys: list) -> None:
    ex = spec["example"]
    if list(ex.keys()) != envelope_keys:
        fail(f"message {spec['key']}: example envelope keys {list(ex)} differ from envelope() {envelope_keys}")
    if ex.get("type") != pos_sender.CONTRACT_TYPE.get(spec["queue_type"]):
        fail(f"message {spec['key']}: type {ex.get('type')} is not CONTRACT_TYPE[{spec['queue_type']}]")
    if pos_sender.MESSAGE_NO.get(spec["queue_type"], "missing") != spec["no"]:
        fail(f"message {spec['key']}: MESSAGE_NO for {spec['queue_type']} is not {spec['no']}")
    data_keys = list(built[0][0].keys())
    if list(ex["data"].keys()) != data_keys:
        fail(f"message {spec['key']}: example data keys {list(ex['data'])} differ from the builder {data_keys}")
    for k, v in ex["data"].items():
        types = {_json_type(d.get(k)) for d, _ in built}
        if _json_type(v) not in types:
            fail(f"message {spec['key']}: data.{k} = {v!r} ({_json_type(v)}), the builder sends {types}")
    for _d, meta in built:
        for h in (meta.get("h") or "").split():
            if h not in spec["h"]:
                fail(f"message {spec['key']}: the builder logs {h}, the map lists {spec['h']}")
    for when in ("sent_at",):
        if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", ex[when]):
            fail(f"message {spec['key']}: {when} is not UTC with Z")


def check_timing(source: str) -> int:
    """What the "Kapan dan seberapa cepat" texts and the timeline say about the
    WMS side, checked against the code. Returns the ready target in minutes."""
    import ledger
    pr = ledger.PRIORITY
    order_p = {pr.get("order_ready"), pr.get("order_short")}
    stock_p = {pr.get("stock_level")}
    if len(order_p) != 1 or len(stock_p) != 1 or not min(stock_p) > max(order_p):
        fail(f"ledger.PRIORITY no longer puts order messages (4, 5) ahead of stock: {pr}")
    if "PRIORITY.get(message_type, 5)" not in inspect.getsource(ledger.enqueue_pos_message):
        fail("ledger.enqueue_pos_message no longer defaults to priority 5")
    if "o.send_priority, o.id" not in inspect.getsource(pos_sender.send_due):
        fail("pos_sender.send_due no longer sends by send_priority, then id")
    if "Angka sama dengan pesan terakhir" not in inspect.getsource(pos_sender._build_stock):
        fail("pos_sender._build_stock no longer skips a stock number equal to the last one sent")
    if "local.hour < 3" not in inspect.getsource(pos_sender.nightly_snapshot_due):
        fail("pos_sender.nightly_snapshot_due no longer starts at 03:00 WIB")
    if "queue_full_snapshot" not in inspect.getsource(hiryu_link.set_live):
        fail("switching the link on no longer queues the full snapshot")
    if "queue_full_snapshot" not in inspect.getsource(hiryu_link.snapshot):
        fail("POST /api/hiryu-link/snapshot no longer queues the full snapshot")
    if "buffer" in inspect.getsource(pos_sender.available_now).lower():
        fail("pos_sender.available_now mentions a buffer again: data.available's meaning says there is none")
    m = re.search(r'rule\("grab_ready_minutes", (\d+)\)', source)
    if not m:
        fail("hiryu_link.py no longer reads grab_ready_minutes for the ready-by")
        return 10
    return int(m.group(1))


def order_timeline(ready_minutes: int) -> dict:
    """One order's life, for the strip under the two lanes."""
    n = SENDER_EVERY
    step = lambda side, msg, text, when: {"side": side, "msg": msg, "text": text, "when": when}  # noqa: E731
    return {
        "title": T("Satu pesanan, dari Terima sampai siap", "One order, from Terima to ready"),
        "steps": [
            step("grab", None, T("Pelanggan memesan di Grab", "The customer orders on Grab"),
                 T("menit 0: jam mulai", "minute 0: the clock starts")),
            step("hiryu", "1", T("Staf menekan Terima di Hiryu, Hiryu mengirim pesan 1", "Staff press Terima in Hiryu, Hiryu sends message 1"),
                 T("saat itu juga (untuk disepakati dengan Shaun)", "at once (to agree with Shaun)")),
            step("wms", "3", T("Pesanan masuk antrean ambil, stok ditahan, WMS mengirim pesan 3", "The order joins the pick queue, stock is held, the WMS sends message 3"),
                 T(f"dalam sekitar {n} dtk", f"within about {n} s")),
            step("wms", None, T("Picker mengambil barang", "The picker picks"), None),
            step("wms", "5", T("Bila barang tidak ada: WMS mengirim pesan 5", "If an item is missing: the WMS sends message 5"),
                 T(f"dalam sekitar {n} dtk", f"within about {n} s")),
            step("wms", "4", T("Packer menekan Selesai dikemas, WMS mengirim pesan 4, Hiryu menandai siap di Grab", "The packer taps Selesai dikemas, the WMS sends message 4, Hiryu marks it ready on Grab"),
                 T(f"dalam sekitar {n} dtk", f"within about {n} s")),
        ],
        "target": T(f"Target: siap di Grab paling lambat {ready_minutes} menit setelah pelanggan memesan (order_time di pesan 1), bukan setelah Terima.",
                    f"Target: ready on Grab within {ready_minutes} minutes of the customer's order (order_time in message 1), not of Terima."),
    }


def check_pull() -> None:
    """What the catalogue pull card says, checked against the code."""
    try:
        msg = hiryu_link.CatalogueMessage.model_validate(PULL["example"])
        if not msg.full:
            fail("catalogue_pull: the example answer is not full")
    except Exception as e:  # noqa: BLE001
        fail(f"catalogue_pull: the example answer is refused by CatalogueMessage: {e}")
    if not re.fullmatch(hiryu_link._MSG_ID, EX_PULL_REQUEST_ID):
        fail("catalogue_pull: the example request_id does not match _MSG_ID")
    if pos_sender.PULL_TYPE != PULL["log_type"]:
        fail(f"catalogue_pull: pos_sender.PULL_TYPE is {pos_sender.PULL_TYPE}")
    fetch = inspect.getsource(pos_sender._fetch_catalogue)
    for word in ("client.get(", '"X-Hiryu-Key"', '"request_id"', "CATALOGUE_TIMEOUT"):
        if word not in fetch:
            fail(f"pos_sender._fetch_catalogue no longer has {word}")
    pull = inspect.getsource(pos_sender.pull_catalogue)
    for word in ("hiryu_link.handle_catalogue(", "CatalogueMessage.model_validate", "msg.full",
                 '"request_id": request_id', "standin_catalogue_body(", "asyncio.wait_for(",
                 "PULL_TYPE", "push_enabled", "link_live"):
        if word in ("push_enabled", "link_live"):
            if word in pull:
                fail(f"pos_sender.pull_catalogue now reads {word}: the card says the pull does not wait for it")
            continue
        if word not in pull:
            fail(f"pos_sender.pull_catalogue no longer has {word}")
    route = inspect.getsource(hiryu_link.request_catalogue)
    for word in ("pos_sender.pull_catalogue(", "429", "is_demo_site"):
        if word not in route:
            fail(f"POST /api/hiryu-link/catalogue-request no longer has {word}")
    if '"failed"' not in inspect.getsource(hiryu_link._resync_state) or "wait = status != \"failed\"" not in inspect.getsource(hiryu_link._resync_state):
        fail("a failed pull no longer frees the button at once (_resync_state)")
    saved = {k: os.environ.get(k) for k in ("POS_CATALOGUE_URL", "POS_WEBHOOK_URL")}
    try:
        os.environ["POS_CATALOGUE_URL"] = ""
        os.environ["POS_WEBHOOK_URL"] = "https://hiryu.example/wms/hook"
        if pos_sender.catalogue_url() != "https://hiryu.example/catalogue":
            fail(f"catalogue_url() from POS_WEBHOOK_URL gives {pos_sender.catalogue_url()}")
        os.environ["POS_CATALOGUE_URL"] = "https://hiryu.example/x/cat"
        if pos_sender.catalogue_url() != "https://hiryu.example/x/cat":
            fail("catalogue_url() no longer prefers POS_CATALOGUE_URL")
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def check_h_refs(messages: list[dict]) -> None:
    known = {h["h"] for h in H_LIST}
    for m in messages:
        for h in m["h"] + [x for t in m["triggers"] for x in t["h"]]:
            if h not in known:
                fail(f"message {m['key']}: unknown H ref {h}")


def no_dashes(text: str) -> None:
    for ch, name in (("\u2013", "en dash"), ("\u2014", "em dash")):
        if ch in text:
            at = text.index(ch)
            fail(f"an {name} in the output near: {text[max(0, at - 60):at + 20]!r}")


# ==========================================================================
# Build
# ==========================================================================

def build() -> dict:
    os.environ["POS_SHARED_SECRET"] = "map-secret"
    os.environ.pop("ALLOW_ANONYMOUS_DEV", None)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(hiryu_link.router)
    tc = TestClient(app)

    check_routes()
    source = pathlib.Path(inspect.getsourcefile(hiryu_link)).read_text(encoding="utf-8")
    r = tc.get("/api/hiryu/v1/ping", headers={"X-Hiryu-Key": "map-secret"})
    if r.status_code != 200 or r.json() != {"ok": True}:
        fail(f"ping answered {r.status_code} {r.text}")

    messages = {}
    for spec in INBOUND:
        spec = copy.deepcopy({k: v for k, v in spec.items() if k != "model"}) | {"model": spec["model"]}
        check_inbound(spec, source)
        probe_answers(spec, tc)
        rows = schema_rows(spec["model"])
        if spec.get("path_example"):
            rows.insert(0, {"path": "(path) grab_order_id", "type": "string", "required": True, "nullable": False,
                            "pattern": hiryu_link._ORDER_ID, "enum": None,
                            "limits": [T("1 sampai 64 karakter", "1 to 64 characters")]})
        ann_paths = set(spec["ann"])
        fields = [finish_row(r, spec["ann"], spec["example"] if not r["path"].startswith("(path)")
                             else {"grab_order_id": spec["path_example"]}, spec["names"]) for r in rows]
        for p in ann_paths - {r["path"] for r in rows}:
            fail(f"message {spec['key']}: a meaning is written for {p}, which the model does not have")
        for p in set(spec["names"]) - {r["path"] for r in rows}:
            fail(f"message {spec['key']}: a business name is written for {p}, which the model does not have")
        if spec.get("path_example"):
            fields[0]["example"] = json.dumps(spec["path_example"])
        messages[spec["key"]] = {
            "key": spec["key"], "no": spec["no"], "log_type": spec["log_type"], "name": spec["name"],
            "direction": "in", "from": "hiryu", "to": "wms", "h": spec["h"],
            "call": {"method": spec["method"], "path": spec["path"],
                     "url": spec["path"].replace("{grab_order_id}", spec.get("path_example", "")),
                     "who": T("Hiryu memanggil WMS", "Hiryu calls the WMS"),
                     "note": T("Jalur publik di Substrait (tanpa Google sign-in), dilindungi kunci saja.",
                               "A public path on Substrait (no Google sign-in), protected by the key only.")},
            "headers": [{"name": "X-Hiryu-Key", "value": "<POS_SHARED_SECRET>"},
                        {"name": "Content-Type", "value": "application/json"}],
            "triggers": spec["triggers"],
            "timing": spec["timing"],
            "fields": fields,
            "example": spec["example"],
            "answers": [{k: v for k, v in a.items() if k not in ("model", "source")} for a in spec["answers"]],
            "next": spec["next"],
            "rules": spec.get("rules", []),
        }

    built = run_builders()
    envelope_keys = list(built["_envelope"][0][0].keys())
    for spec in OUTBOUND:
        b = built[spec["key"]]
        check_outbound(spec, b, envelope_keys)
        fields = outbound_rows(spec, b, envelope_keys)
        ann_paths = set(spec["ann"])
        for p in ann_paths - {f["path"] for f in fields}:
            fail(f"message {spec['key']}: a meaning is written for {p}, which the builder does not send")
        for p in set(spec["names"]) - {f["path"] for f in fields}:
            fail(f"message {spec['key']}: a business name is written for {p}, which the builder does not send")
        messages[spec["key"]] = {
            "key": spec["key"], "no": spec["no"], "log_type": spec["log_type"], "name": spec["name"],
            "direction": "out", "from": "wms", "to": "hiryu", "h": spec["h"],
            "call": {"method": "POST", "path": "POS_WEBHOOK_URL", "url": None,
                     "who": T("WMS memanggil Hiryu", "The WMS calls Hiryu"),
                     "note": T(f"Satu alamat di sisi Hiryu (POS_WEBHOOK_URL, disepakati dengan Shaun). Jenis pesan di isi: \"type\": \"{spec['log_type']}\", field di dalam data. Satu pesan per panggilan.",
                               f"One address on Hiryu's side (POS_WEBHOOK_URL, to agree with Shaun). The type is in the body: \"type\": \"{spec['log_type']}\", the fields inside data. One message per call.")},
            "headers": [{"name": "X-Hiryu-Key", "value": "<POS_SHARED_SECRET>"},
                        {"name": "Idempotency-Key", "value": "<message_id>"},
                        {"name": "Content-Type", "value": "application/json"}],
            "triggers": spec["triggers"],
            "timing": spec["timing"],
            "fields": fields,
            "example": spec["example"],
            "answers": OUT_ANSWERS,
            "next": spec["next"],
            "rules": spec.get("rules", []),
        }

    check_pull()
    messages["catalogue_pull"] = {
        "key": PULL["key"], "no": PULL["no"], "log_type": PULL["log_type"], "name": PULL["name"],
        "direction": "out", "from": "wms", "to": "hiryu", "h": PULL["h"], "call": PULL["call"],
        "headers": PULL["headers"], "triggers": PULL["triggers"], "timing": PULL["timing"],
        "fields": PULL["fields"], "example": PULL["example"], "answers": PULL["answers"],
        "next": PULL["next"], "rules": PULL["rules"],
    }

    order = ["1", "2", "3", "4", "5", "6", "catalogue_pull"]
    out_messages = [messages[k] for k in order]
    check_h_refs(out_messages)
    log_types = {m["log_type"] for m in out_messages}
    if log_types != ({"order", "cancel", "catalogue", pos_sender.PULL_TYPE}
                     | set(pos_sender.CONTRACT_TYPE.values())):
        fail(f"log types {sorted(log_types)} do not cover the code's message types")

    ready_minutes = check_timing(source)

    return {
        "title": T("Peta pesan Hiryu dan WMS", "Hiryu and WMS message map"),
        "contract": "docs/hiryu-link-v1.md v1.2",
        "generated_by": "python tools/gen_message_map.py",
        "retry": {"seconds": list(pos_sender.BACKOFF), "words": retry_words(),
                  "timeout_seconds": int(pos_sender.HTTP_TIMEOUT)},
        "sender_every_seconds": SENDER_EVERY,
        "timeline": order_timeline(ready_minutes),
        "rules": general_rules(),
        "h_list": H_LIST,
        "messages": out_messages,
    }


def main() -> int:
    check_only = "--check" in sys.argv[1:]
    data = build()
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    no_dashes(text)
    if PROBLEMS:
        print("gen_message_map: the map does not match the code:", file=sys.stderr)
        for p in PROBLEMS:
            print("  - " + p, file=sys.stderr)
        return 1
    n_fields = sum(len(m["fields"]) for m in data["messages"])
    if check_only:
        old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if old != text:
            print(f"gen_message_map: {OUT.relative_to(ROOT)} is stale; run python tools/gen_message_map.py",
                  file=sys.stderr)
            return 1
        print(f"gen_message_map: checks pass, {OUT.relative_to(ROOT)} is current "
              f"({len(data['messages'])} messages, {n_fields} fields)")
        return 0
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"gen_message_map: checks pass; wrote {OUT.relative_to(ROOT)} "
          f"({len(data['messages'])} messages, {n_fields} fields, {len(text):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
