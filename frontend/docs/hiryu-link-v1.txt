# Hiryu link, version 1 (draft for Shaun)

The WMS side of PRD §0.6, as built on dev. Everything here is a proposal until
Shaun agrees it (§0.6.4). Field names are the WMS's; Hiryu can map to them or we
rename once.

## Common rules

- HTTPS only. Every call carries the header `X-Hiryu-Key: <shared secret>`. The
  secret is different on dev and production (`POS_SHARED_SECRET`).
- Every message has a `message_id`, unique per sender. A message received twice
  gets the same answer twice and changes nothing the second time.
- Times are ISO 8601 with a zone (`2026-10-01T09:15:00+07:00`) or UTC with `Z`.
- Numbers are absolute, never "+2".
- Keys: `grab_order_id` for orders; `hiryu_store_id` for stores; `sku_code` for
  SKUs, the Hiryu SKU code, compared ignoring capitals.
- **No customer data.** The order message refuses any field not listed here.
- Answers: `200` or `201` = taken; `409` = taken before (duplicate), no change;
  `422` = refused, with `detail` saying why (do not retry); `5xx` or no answer =
  retry with a growing wait.

## Hiryu to WMS

Base path: `/api/hiryu/v1`. These paths are opened as public paths on Substrait
(no Google sign-in) and are protected by the shared secret only.

### 1. Order to pick: `POST /api/hiryu/v1/orders`

Sent the moment staff press **Accept** in Hiryu.

```json
{
  "message_id": "hy-ord-8f2c",
  "grab_order_id": "A-7Q2K9XW3M4",
  "gm_number": "GM-358",
  "hiryu_store_id": 901,
  "order_time": "2026-10-01T09:15:00+07:00",
  "scheduled_time": null,
  "estimated_ready_time": null,
  "lines": [
    {"sku_code": "LAB-GB-MC-100", "units": 2, "hiryu_item_id": "LAB-GB-MC-100-2P",
     "item_qty": 1, "item_price": 89000}
  ]
}
```

- `units` = item quantity × units per sale, worked out by Hiryu.
- `item_price` = the item's menu price that day in rupiah, used only for the
  brand's sales report.
- Answer `201`: `{"order_id": 123, "status": "accepted"}`. The same
  `grab_order_id` again answers `200` with `"status": "duplicate"`.
- A SKU code the WMS does not know answers `422` and flags Ops HQ.

### 2. Order cancelled: `POST /api/hiryu/v1/orders/{grab_order_id}/cancel`

```json
{"message_id": "hy-can-11ab", "reason_code": "2001",
 "reason": "Item out of stock", "cancelled_at": "2026-10-01T09:21:00+07:00"}
```

A cancel for an order the WMS has not seen yet is kept and applied when the
order arrives.

### 6. Catalogue: `POST /api/hiryu/v1/catalogue`

Sent when a store, menu, item, bundle or SKU changes; `full: true` when it is the
whole list (anything missing from a full list turns inactive).

```json
{
  "message_id": "hy-cat-77",
  "full": false,
  "stores": [
    {"hiryu_store_id": 901, "name": "Kahf MA5", "dark_store": "MA5",
     "brand": "KAHF", "status": "active"}
  ],
  "skus": [
    {"sku_code": "KHF-FW-OIL-100", "name": "Kahf Oil and Acne Care Face Wash 100 ml",
     "barcodes": ["8993137696212"]}
  ],
  "menus": [
    {"hiryu_store_id": 901, "items": [
      {"item_id": "KHF-FW-OIL-100", "name": "Kahf Face Wash Oil & Acne 100 ml",
       "sku_code": "KHF-FW-OIL-100", "units_per_sale": 1, "price": 45000,
       "available": true}
    ]}
  ]
}
```

- `dark_store` is the WMS hub code; `brand` is the WMS brand code.
- A SKU code the WMS has not seen creates a WMS SKU for that brand; Ops HQ then
  completes its bin size and stock numbers (*Lengkapi data SKU*).

### Health: `GET /api/hiryu/v1/ping`

Answers `{"ok": true}` when the secret is right.

## WMS to Hiryu

One address on Hiryu's side (`POS_WEBHOOK_URL`, open item 2), the type in the
body. The WMS sends with `X-Hiryu-Key` and `Idempotency-Key: <message_id>`, one
message per call, order messages ahead of stock messages, and retries with a
growing wait (10 s, 30 s, 1 min, 2 min, 5 min, then every 10 min) until Hiryu
answers `2xx`. A `4xx` other than `408` and `429` stops retrying and shows as
failed on *Integrasi Hiryu*.

```json
{"message_id": "wms-40211", "type": "stock_level",
 "sent_at": "2026-10-01T02:15:04Z", "data": {}}
```

### 3. Stock level: `"type": "stock_level"`

```json
{"hiryu_store_id": 901, "sku_code": "KHF-FW-OIL-100", "available": 7,
 "as_of": "2026-10-01T02:15:03Z"}
```

`available` = on the shelf − held for orders not yet picked − Grab buffer, never
below 0. Worked out when the message is sent, so a burst of scans sends one
number. A full snapshot (every SKU of every store) goes at switch-on and every
night at 03:00 WIB.

### 4. Order ready: `"type": "order_ready"`

```json
{"grab_order_id": "A-7Q2K9XW3M4", "gm_number": "GM-358",
 "packed_at": "2026-10-01T02:23:40Z"}
```

Sent when the packer taps *Selesai dikemas*. Hiryu marks the order ready on Grab.

### 5. Item short: `"type": "item_short"`

```json
{"grab_order_id": "A-7Q2K9XW3M4", "gm_number": "GM-358",
 "sku_code": "LAB-GB-MC-100", "units_wanted": 2, "units_found": 1}
```

Sent after the picker's look-elsewhere check fails. Hiryu cancels with 2001 (or
edits the order, open item 1) and sends message 2 back. The WMS has already
stopped the order and released its stock when it sends this.

## Switches on the WMS side

| Setting | Where | Effect |
|---|---|---|
| `POS_PUSH_ENABLED` | Substrait env | `false`: messages 3 to 5 queue but are not sent |
| `POS_WEBHOOK_URL` | Substrait env | Hiryu's address for messages 3 to 5 |
| `POS_SHARED_SECRET` | Substrait env (secret) | The `X-Hiryu-Key` value, both directions |
| *Sambungan Hiryu aktif* | WMS, *Integrasi Hiryu* (Ops HQ) | On: paste and the stock sheet are off; orders come only from message 1 |
