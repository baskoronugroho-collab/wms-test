# Hiryu link, version 1 (draft for Shaun)

**Version 1.1, 5 Oct 2026.** Changes from 1.0: message 1 carries the customer's
out-of-stock instruction per line (`oos_instruction`, H9); message 2 carries
`cancelled_by`; message 3 carries `is_snapshot`; message 5 says what the WMS did
with the line (`action`); message 6 carries dark stores, and stores point to a
dark store instead of a typed hub code and brand; the WMS can ask for the full
catalogue (`catalogue_request`). The canvas board 11d shows every field in a
table; this file and 11d use the same names and examples.

The WMS side of PRD §0.6, as built on dev. Everything here is a proposal until
Shaun agrees it (§0.6.4). Field names are the WMS's; Hiryu can map to them or we
rename once. Items marked **(to agree with Shaun)** are not agreed yet.

## Common rules

- HTTPS only. Every call carries the header `X-Hiryu-Key: <shared secret>`. The
  secret is different on dev and production (`POS_SHARED_SECRET`). Missing or
  wrong: `403`, nothing changes.
- Every message has a `message_id`, unique per sender. A message received twice
  gets the same answer twice and changes nothing the second time. The WMS also
  sends `Idempotency-Key: <message_id>`; Hiryu may send it too, but the WMS goes
  by `message_id`.
- Times are ISO 8601 with a zone (`2026-10-01T09:41:00+07:00`) or UTC with `Z`.
  A time with no zone is refused.
- Numbers are absolute, never "+2".
- Keys: `grab_order_id` for orders; `hiryu_store_id` for stores;
  `hiryu_dark_store_id` for dark stores (hubs); `sku_code` for SKUs, the Hiryu
  SKU code, compared ignoring capitals.
- **No customer data.** Never sent, in either direction: customer name, phone,
  address, customer notes, payment, driver details. The WMS refuses any field
  not listed here (`422`), so none of these can ride along by mistake.
- Order messages (1, 2, 4, 5) go ahead of stock and catalogue messages (3, 6).

### Answers, and what the sender does

| Answer | Means | The sender |
|---|---|---|
| `200`, `201` | Taken | Done |
| `409` | Taken before: a duplicate. Nothing changed | Done |
| `422` | Refused, `detail` says why | Do not retry. Show it as failed (WMS: *Integrasi Hiryu*) and fix the cause |
| `408`, `429` | Too slow, or too many calls | Retry on the schedule |
| other `4xx` | For example `403`: wrong or missing key | Stop. Show it as failed and alert |
| `5xx`, or no answer in 8 s | The other side is down or busy | Retry on the schedule |

Retry schedule, both sides: 10 s, 30 s, 1 min, 2 min, 5 min, then every 10 min,
until the other side answers `2xx`. Both sides keep unsent messages in a queue
that survives a restart; a message waiting more than 5 minutes shows red.

## Hiryu to WMS

Base path: `/api/hiryu/v1`. These paths are opened as public paths on Substrait
(no Google sign-in) and are protected by the shared secret only.

### 1. Order to pick: `POST /api/hiryu/v1/orders`

Sent the moment staff press **Accept** in Hiryu (H1, H9).

```json
{
  "message_id": "hy-ord-8f2c",
  "grab_order_id": "A-7Q2K9XW3M4",
  "gm_number": "GM-358",
  "hiryu_store_id": 903,
  "order_time": "2026-10-01T09:41:00+07:00",
  "scheduled_time": null,
  "estimated_ready_time": null,
  "lines": [
    {"hiryu_item_id": "LAB-GB-MC-100", "item_qty": 3,
     "sku_code": "LAB-GB-MC-100", "units": 3, "item_price": 45000,
     "oos_instruction": {"type": "replace",
                         "replace_hiryu_item_id": "LAB-GB-MC-225",
                         "replace_sku_code": "LAB-GB-MC-225",
                         "replace_units": 1}}
  ]
}
```

| Field | Type | Required | Where Hiryu gets it | What the WMS does with it |
|---|---|---|---|---|
| `message_id` | string, up to 96 | Yes | Hiryu makes it, unique per message; a retry reuses it | A repeat gets the same answer and changes nothing |
| `grab_order_id` | string, up to 64 | Yes | The Grab order ID | The order's key; the same ID again answers `200` duplicate |
| `gm_number` | string, `GM-` + up to 16 | Yes | The short number on Live Orders and the slip | Shown big to picker and packer; the packer types it to check the slip |
| `hiryu_store_id` | integer | Yes | Hiryu's store number (Labore - Cawang is #903) | Finds hub and brand; unknown or inactive store answers `422` and flags Ops HQ |
| `order_time` | time with zone | Yes | When the customer ordered on Grab | Starts the clock (not *Accept*): ready-by is order time plus 10 minutes |
| `scheduled_time` | time or null | No | Grab's scheduled time; null for an order now | The order waits in *Terjadwal* and goes to a picker 20 minutes before |
| `estimated_ready_time` | time or null | No | Grab's estimated ready time, when Grab gives one | Stored for reference only; not the ready-by |
| `lines` | list, 1 to 100 | Yes | The items on the Grab order, one entry per menu item | One pick line per entry |
| `lines[].hiryu_item_id` | string, up to 64 | Yes | The Hiryu menu item ordered | Kept on the line, sent back in message 5 |
| `lines[].item_qty` | integer, 1 to 999 | Yes | How many of that item | Brand sales report |
| `lines[].sku_code` | string, up to 64 | Yes | The SKU the item uses in Bundles | Finds the WMS product; unknown code answers `422` and flags Ops HQ |
| `lines[].units` | integer, 1 to 999 | Yes | `item_qty` × units per sale from Bundles | Units to pick; held at once |
| `lines[].item_price` | integer, rupiah | No | The item's menu price that day | Brand sales report only |
| `lines[].oos_instruction` | object or null | Yes, may be null | The customer's out-of-stock choice for the item on the Grab order | Shown to the picker after *Barang tidak ada*; null is treated as `cancel_order` |
| `oos_instruction.type` | string | Yes | `replace`, `remove`, `cancel_order` or `contact_customer` | `contact_customer` is handled as `cancel_order` in the pilot |
| `oos_instruction.replace_hiryu_item_id` | string or null | For `replace` | The replacement item the customer picked | Sent back in message 5 |
| `oos_instruction.replace_sku_code` | string or null | For `replace` | The SKU of the replacement item in Bundles | Names the replacement and its bin |
| `oos_instruction.replace_units` | integer or null | For `replace` | Replacement item quantity × its units per sale | Units of the replacement to pick |

- `units` = item quantity × units per sale, worked out by Hiryu.
- `item_price` = the item's menu price that day in rupiah, used only for the
  brand's sales report.
- `oos_instruction` is `null` when Grab gives no instruction; the WMS then
  treats the line as `cancel_order`.
- A `replace_sku_code` the WMS does not know does not refuse the order: the line
  is treated as `cancel_order` and Ops HQ is flagged.
- Answer `201`: `{"order_id": 123, "status": "accepted"}`. The same
  `grab_order_id` again answers `200` with `"status": "duplicate"`.
- A store or SKU code the WMS does not know answers `422` and flags Ops HQ.

### 2. Order cancelled: `POST /api/hiryu/v1/orders/{grab_order_id}/cancel`

Sent on any cancel: by the customer, by Grab, or by the merchant (Hiryu or its
staff, including after message 5) (H2). The example is GM-347, cancelled
with `2001` after its missing line (`POST /api/hiryu/v1/orders/A-3H6PV8N2RT/cancel`).

```json
{"message_id": "hy-can-11ab", "reason_code": "2001",
 "reason": "Item out of stock", "cancelled_by": "merchant",
 "cancelled_at": "2026-10-01T08:55:00+07:00"}
```

| Field | Type | Required | Where Hiryu gets it | What the WMS does with it |
|---|---|---|---|---|
| `grab_order_id` (in the path) | string, up to 64 | Yes | The cancelled order's Grab order ID | Finds the order |
| `message_id` | string, up to 96 | Yes | Hiryu makes it | A repeat changes nothing |
| `reason_code` | string or null | Yes, may be null | `2001` Item out of stock, `2002` Store closed, `2003` Too busy, `2004` Customer requested; null when Grab gives no reason | Kept on the order; reports count `2001` as a missing-item cancel |
| `reason` | string or null | No | The words that go with the code, never the customer's own words | Shown next to the code |
| `cancelled_by` | string | Yes | `customer`, `grab` or `merchant` | Shown on the red order and in reports |
| `cancelled_at` | time with zone | Yes | When the order was cancelled | Kept on the order |

- The WMS releases the holds, sends picked units to *Kembalikan ke rak*, and a
  parcel on the ready shelf shows *Dibatalkan*.
- A cancel for an order the WMS has not seen yet is kept and applied when the
  order arrives.
- Answer `200` with `"status"` `cancelled`, `already_cancelled` or `pending`.

### 6. Catalogue: `POST /api/hiryu/v1/catalogue`

Sent when a dark store, store, menu, item, bundle or SKU changes (H6); `full:
true` when it is the whole list (anything missing from a full list turns
inactive).

```json
{
  "message_id": "hy-cat-77",
  "full": false,
  "request_id": null,
  "dark_stores": [
    {"hiryu_dark_store_id": 13, "name": "Cawang",
     "address": "Jl. Raya Kalibata No. 4, Jakarta Timur",
     "opening_hours": {
       "mon": [{"open": "08:00", "close": "22:00"}],
       "tue": [{"open": "08:00", "close": "22:00"}],
       "wed": [{"open": "08:00", "close": "22:00"}],
       "thu": [{"open": "08:00", "close": "22:00"}],
       "fri": [{"open": "08:00", "close": "22:00"}],
       "sat": [{"open": "08:00", "close": "22:00"}],
       "sun": [{"open": "08:00", "close": "22:00"}]}}
  ],
  "stores": [
    {"hiryu_store_id": 902, "name": "Kahf - Cawang", "hiryu_dark_store_id": 13,
     "status": "active", "order_acceptance": "MANUAL"}
  ],
  "skus": [
    {"sku_code": "KHF-FW-OAC-100", "name": "Kahf Oil and Acne Care Face Wash 100 ml",
     "barcodes": ["8993137000101"]}
  ],
  "menus": [
    {"hiryu_store_id": 902, "items": [
      {"item_id": "KHF-FW-OAC-100", "name": "Kahf Face Wash Oil & Acne 100 ml",
       "sku_code": "KHF-FW-OAC-100", "units_per_sale": 1, "price": 45000,
       "available": true}
    ]}
  ]
}
```

| Field | Type | Required | Where Hiryu gets it | What the WMS does with it |
|---|---|---|---|---|
| `message_id` | string, up to 96 | Yes | Hiryu makes it | A repeat changes nothing |
| `full` | boolean | Yes | `true` when Hiryu sends the whole list | Anything missing from a full list turns inactive |
| `request_id` | string or null | No | The `request_id` of the WMS's `catalogue_request` this answers; null otherwise **(to agree with Shaun)** | Marks *Sinkron ulang* as done |
| `dark_stores` | list | No | Hiryu, Dark stores | One hub per dark store |
| `dark_stores[].hiryu_dark_store_id` | integer | Yes | The dark store's number in Hiryu | The hub's key; a new one creates the hub (*Baru dari Hiryu*), Ops HQ adds only the WMS data |
| `dark_stores[].name` | string, up to 160 | Yes | The dark store's name | Hub name, read-only in the WMS |
| `dark_stores[].address` | string, up to 255 | Yes | The dark store's address | Read-only on *Hub & mulai operasi* |
| `dark_stores[].opening_hours` | object | Yes | The hours set in Hiryu, the ones Grab shows **(shape to agree with Shaun)** | The hub's open hours |
| `opening_hours.mon` ... `.sun` | list of `{open, close}` | Yes | One entry per opening period, WIB, 24 h; `[]` = closed that day | As above |
| `stores` | list, up to 500 | No | Hiryu, Stores; one store per brand per dark store | One WMS store per entry |
| `stores[].hiryu_store_id` | integer | Yes | The store's number | The store's key; a new store waits for Ops HQ (see below) |
| `stores[].name` | string, up to 160 | Yes | The store's name | Shown on *Menu & toko Hiryu* |
| `stores[].hiryu_dark_store_id` | integer | Yes | The dark store the store is assigned to | Puts the store on that hub |
| `stores[].status` | string | Yes | `active` or `inactive` | Inactive: no stock sent, orders refused |
| `stores[].order_acceptance` | string | No | The store's order acceptance setting **(to agree with Shaun)** | Shown as *terima MANUAL*; Ops HQ is warned when it is not MANUAL |
| `skus` | list, up to 10000 | No | Hiryu, SKUs | Products in the WMS |
| `skus[].sku_code` | string, up to 64 | Yes | The Hiryu SKU code | Finds the product, ignoring capitals; a new code creates one |
| `skus[].name` | string, up to 255 | Yes | The SKU's name | The product name on every screen |
| `skus[].barcodes` | list of strings, up to 10 | No | The SKU's barcodes | Registered for scanning; a barcode on another product goes to `problems` |
| `menus` | list, up to 500 | No | Hiryu, Menus; one menu per store | Each store's items |
| `menus[].hiryu_store_id` | integer | Yes | The store the menu belongs to | Links the items to the store |
| `menus[].items` | list, up to 3000 | Yes | The menu's items | One menu item per entry |
| `items[].item_id` | string, up to 64 | Yes | The menu item ID, the same as `hiryu_item_id` in message 1 | The item's key |
| `items[].name` | string, up to 255 | Yes | The item's name on the menu | Shown on *Menu & toko Hiryu* |
| `items[].sku_code` | string or null | Yes, may be null | The SKU in Bundles; null when not linked yet | null shows as *Item tanpa SKU*: orders for it cannot be picked |
| `items[].units_per_sale` | integer, 1 to 99 | Yes | Units of the SKU in one item (Bundles) | Shown on the menu |
| `items[].price` | integer, rupiah | No | The item's menu price today | Kept per day for the brand sales report |
| `items[].available` | boolean | Yes | The item's on/off switch | Shown on the menu list |

- There is no brand record in Hiryu. A new store waits on *Menu & toko Hiryu*
  until Ops HQ picks its brand and its Grab merchant account (the brand's own,
  or Ninja Van's as Nemu Mart). Until then nothing is sent for it and it cannot
  be switched on.
- A SKU gets its brand from the store whose menu uses it. A SKU code the WMS has
  not seen creates a WMS SKU for that brand; Ops HQ then completes its bin size
  and stock numbers (*Lengkapi data SKU*).
- Answer `200`: `{"stores": 1, "skus_created": 0, "skus_updated": 1, "items": 1,
  "problems": []}`. What cannot be placed is skipped and listed in `problems`;
  the rest is taken.

### Health: `GET /api/hiryu/v1/ping`

Answers `{"ok": true}` when the secret is right.

## WMS to Hiryu

One address on Hiryu's side (`POS_WEBHOOK_URL`, **to agree with Shaun**), the
type in the body. The WMS sends with `X-Hiryu-Key` and
`Idempotency-Key: <message_id>`, one message per call, order messages ahead of
stock messages, and retries on the schedule above until Hiryu answers `2xx`. A
`4xx` other than `408` and `429` stops retrying and shows as failed on
*Integrasi Hiryu*.

```json
{"message_id": "wms-40211", "type": "stock_level",
 "sent_at": "2026-10-01T02:15:04Z", "data": {}}
```

Types: `stock_level`, `order_ready`, `item_short`, `catalogue_request`. The
fields below go inside `data`.

### 3. Stock level: `"type": "stock_level"`

Sent after every stock move for that store and SKU (H3). A full snapshot (every
SKU of every store) goes at switch-on (H8) and every night at 03:00 WIB.

```json
{"hiryu_store_id": 902, "sku_code": "KHF-FW-OAC-100", "available": 7,
 "as_of": "2026-10-01T02:15:03Z", "is_snapshot": false}
```

| Field | Type | Required | Where the WMS gets it | What Hiryu does with it |
|---|---|---|---|---|
| `hiryu_store_id` | integer | Yes | The active Hiryu store for this brand at this hub | Which store's stock to set |
| `sku_code` | string | Yes | The SKU's Hiryu code, in capitals | Which SKU to set |
| `available` | integer, 0 or more | Yes | See below | Set Units on hand to this number; never add or subtract it; pass it on to Grab as today |
| `as_of` | time, UTC | Yes | When the number was worked out | Ignore a number older than the one Hiryu already has |
| `is_snapshot` | boolean | Yes | `true` for every message of a full snapshot, `false` otherwise | Hiryu may show when the last full resync landed; the number is used the same way |

`available` = on the shelf, minus held for orders not yet picked, minus the
Grab buffer (1 by default), never below 0. Worked out when the message is sent,
so a burst of scans sends one number.

### 4. Order ready: `"type": "order_ready"`

```json
{"grab_order_id": "A-7Q2K9XW3M4", "gm_number": "GM-358",
 "packed_at": "2026-10-01T02:48:10Z"}
```

| Field | Type | Required | Where the WMS gets it | What Hiryu does with it |
|---|---|---|---|---|
| `grab_order_id` | string | Yes | The order from message 1 | Call `MarkOrderReady` on Grab |
| `gm_number` | string | Yes | The order from message 1 | A check, and for Hiryu's log |
| `packed_at` | time, UTC | Yes | When the packer tapped *Selesai dikemas* | For Hiryu's log |

Sent when the packer taps *Selesai dikemas* (H4); never for a cancelled order.
Hiryu marks the order ready on Grab. Staff no longer press Mark ready.

### 5. Item short: `"type": "item_short"`

```json
{"grab_order_id": "A-7Q2K9XW3M4", "gm_number": "GM-358",
 "hiryu_item_id": "LAB-GB-MC-100", "sku_code": "LAB-GB-MC-100",
 "action": "replaced", "units_wanted": 3, "units_found": 0,
 "replace_hiryu_item_id": "LAB-GB-MC-225",
 "replace_sku_code": "LAB-GB-MC-225", "replace_units": 1}
```

Sent after the picker's look-elsewhere check fails and the WMS has applied the
customer's instruction (H5, H10). One message per line that changed.

| Field | Type | Required | Where the WMS gets it | What Hiryu does with it |
|---|---|---|---|---|
| `grab_order_id` | string | Yes | The order from message 1 | Which order to change on Grab |
| `gm_number` | string | Yes | The order from message 1 | A check, and for Hiryu's log |
| `hiryu_item_id` | string | Yes | The line's item from message 1 | The Grab item to change |
| `sku_code` | string | Yes | The line's SKU, in capitals | A check |
| `action` | string | Yes | What the WMS did: `replaced`, `removed` or `cancel_order` | See below |
| `units_wanted` | integer | Yes | The line's `units` from message 1 | With `units_found`, what is missing |
| `units_found` | integer | Yes | Units the picker found; they stay in the order | Set the item quantity to what `units_found` covers (divided by units per sale, rounded down; 0 takes the item off) **(to agree with Shaun)** |
| `replace_hiryu_item_id` | string or null | For `replaced` | From `oos_instruction` in message 1 | The item to add on Grab |
| `replace_sku_code` | string or null | For `replaced` | The replacement the picker scanned | A check |
| `replace_units` | integer or null | For `replaced` | Units of the replacement the picker took | Add the item: `replace_units` divided by its units per sale |

- `action` is `cancel_order` for an instruction `cancel_order` or
  `contact_customer`, for no instruction (`null`), and when the replacement is
  also missing.
- Hiryu applies it on Grab: `replaced` or `removed` with Edit order if Grab
  allows it, otherwise cancel with `2001`; `cancel_order`: check, then cancel
  with `2001`. If the order ends up cancelled, Hiryu sends message 2 with
  `cancelled_by` `merchant`.
- For `cancel_order` the WMS has already stopped the order and released its
  stock when it sends this. For `replaced` and `removed` the order goes on to
  packing; if Hiryu then has to cancel it, message 2 stops it in the WMS.

### Catalogue request: `"type": "catalogue_request"` (to agree with Shaun)

```json
{"request_id": "wms-cat-0940", "requested_at": "2026-10-01T02:40:00Z"}
```

| Field | Type | Required | Where the WMS gets it | What Hiryu does with it |
|---|---|---|---|---|
| `request_id` | string | Yes | The WMS makes it, unique per request | Echo it in `request_id` of message 6 |
| `requested_at` | time, UTC | Yes | When the button was pressed | For Hiryu's log |

Sent when anyone presses *Sinkron ulang dari Hiryu* on *Menu & toko Hiryu*. Any
role may press it, once every 5 minutes per hub; the WMS enforces the wait and
logs the name. Hiryu answers `2xx` at once, then sends message 6 with
`full: true` and the same `request_id`. Other option for Shaun: a `GET` on
Hiryu's side that returns the message 6 body.

## Switches on the WMS side

| Setting | Where | Effect |
|---|---|---|
| `POS_PUSH_ENABLED` | Substrait env | `false`: messages 3 to 5 queue but are not sent |
| `POS_WEBHOOK_URL` | Substrait env | Hiryu's address for messages 3 to 5 and the catalogue request |
| `POS_SHARED_SECRET` | Substrait env (secret) | The `X-Hiryu-Key` value, both directions |
| *Sambungan Hiryu aktif* | WMS, *Integrasi Hiryu* (Ops HQ) | On: paste and the stock sheet are off; orders come only from message 1 |
