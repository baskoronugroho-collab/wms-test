# Ninja Kilat WMS: requirements and working instruction

| | |
|---|---|
| **Product** | Ninja Kilat WMS |
| **Version** | v3.0: one page for everyone. Part A is the working instruction with screen drafts, Part B the requirements, Part C the decisions and open points. Section numbers changed from v2.x |
| **Date** | 25 September 2026 |
| **Owner** | Baskoro Nugroho |
| **Status** | Spec for review. Screens in Part A are drafts, not the live app |
| **Governed by** | *QC Systems: Hiryu, WMS, TMS* (ChangWen, 11 Sep 2026), `docs/canonical/qc-oms-wms.html`, for the long-term design. Where the first build needs a stopgap (no Hiryu link yet), this page says so |
| **Supersedes** | v2.7 of 21 September (kept at `docs/archive/PRD-v2.7.md`) and every earlier version |
| **Platform** | Substrait · FastAPI · OceanBase · static frontend |
| **Live** | wms-test.ninjavan.apps.substrait.build |
| **Go-live** | **Kahf and Labore** at **MA5 Cawang** first, then **KJ5 Kemanggisan** |
| **Scale** | 10 to 30 dark stores within 6 months |

---

# Part A. Working instruction

Who reads what: **Ops HQ** reads A2, **staff** read A3 to A5, the **SPV** (hub supervisor) reads A6 and A7. Everyone reads A1 once. The numbered dots on each screen match the numbered steps under it.

## A1. How the pilot works

**Three systems, no link between Hiryu and the WMS yet.**

| System | Who uses it | What it does |
|---|---|---|
| **Grab** | The customer | Takes the order, pays, sends a Grab rider |
| **Hiryu** | Staff and SPV at the hub | Ninja's POS. Receives every Grab order, prints the packing slip, holds the menu, prices and the stock number Grab shows. Staff press *Mark ready* here |
| **WMS** | Staff, SPV, Ops HQ | Knows where every unit sits: which rack, which bin. Tells the picker where to go, checks every unit by scan, counts the shelf, receives deliveries, raises restock requests to the brand |

Hiryu and the WMS do not talk to each other yet. Until they do, **people carry the information across**:

- **Orders go from Hiryu to the WMS by copy and paste.** Staff copy the Hiryu order page and paste it into the WMS (A4).
- **Stock goes from the WMS to Hiryu by typing.** The WMS lists the numbers; the SPV types them into Hiryu's Stock tab (A7).
- **Customer details never enter the WMS.** Names, phone numbers, addresses and payment stay in Hiryu.

**A day at the hub**

| When | Who | What | Section |
|---|---|---|---|
| Opening | SPV | Type the WMS stock into Hiryu | A7 |
| Every order | Staff | Paste, pick, pack, *Mark ready* in Hiryu, hand to the driver | A4 |
| Delivery from the brand | Staff | Receive by AWB, put away | A3 |
| Something wrong | Anyone | *Laporkan masalah* | A5 |
| During the day | SPV | Answer the second-bin question, decide on problems, check bags waiting for a driver | A6 |
| Closing | SPV | End-of-day report: stock into Hiryu, order check, problems | A7 |

**In the first build, and later**

| First build (go-live) | Later |
|---|---|
| Dark stores only (MA5, KJ5) | Central warehouse (Logos), crossdock, transfers between hubs |
| Brand delivers straight to the dark store | Supplier to central warehouse to dark store |
| Grab orders by copy and paste | One-click button, then the real Hiryu link |
| Grab channel | WhatsApp orders, built inside the WMS first, after launch |

## A2. Ops HQ: set up a hub and its products

Do these once per hub, in this order, before the first delivery.

### A2.1 Build the racks

<!--screen:rack-builder-->

1. **Rak & bin → Tambah rak.** Give the rack a letter and choose the rack type. The two types in stock are the 1 m catalog rack and the 206 cm long-span rack from inventory.
2. **Bays.** A long rack can be split into bays, the sections between the uprights. Enter how many and the clear width of each.
3. **Each level.** Enter the clear height (from the shelf to the one above) and pick one bin size for that level. Each level holds one bin size only.
4. **Positions and stack** fill in by themselves: positions = how many bins fit across, stack = how many bins fit on top of each other (at most the bin type's limit). You can lower them, for example to leave a gap for a hand.
5. **Check the bin codes and save.** Codes read `HUB-RACK BAY-LEVEL-POSITION` and a stack letter: `MA5-A1-3-05T` is rack A, bay 1, level 3, position 5, top bin. With two bins stacked the letters are B (bottom) and T (top); with three, B, M (middle) and T.

Print the bin labels from the WMS on A4 sticker sheets once the layout is final (bin labels are printed centrally, see the procurement notes).

### A2.2 Register a SKU

<!--screen:sku-form-->

1. **Brand and SKU code.** Use the brand's own code. The same code must be used in Hiryu when its SKUs are built, because the two systems match on it.
2. **Barcode.** Scan or type the barcode on the pack if it has one. A SKU can have more than one (for example an old and a new pack). If the brand gives none, leave it empty: staff will bind the barcode the first time the product arrives.
3. **Pack size and weight** if known. They are optional, but they let the WMS choose the bin size and the paper bag or carton. Missing values use the category default. The data sheet to request from the brand is in Appendix B.
4. **Bin size.** The WMS suggests Small (JX-2) or Large (JX-4): the smallest bin that holds 15 units with one divider. Without pack sizes it suggests from the category.
5. **Full number.** Leave it empty unless a similar SKU in the same bin size already has one; then use *Salin dari SKU mirip*. The WMS learns it later from the SPV (A6.1).
6. **Restock point R, target P, safety stock S, Grab buffer.** P is required; R fills in as 25% of P; S and the Grab buffer are optional (Grab buffer: see §13.6).

The SKU then appears on every hub's *Perlu rak* list with its bin size. The SPV of each hub picks a free bin of that size.

### A2.3 Connect the Hiryu menu and stores

<!--screen:hiryu-map-->

1. **Export the menu from Hiryu** (*Menus → the menu → Export CSV*) and upload it here, one file per brand. Upload again every time the menu changes in Hiryu.
2. Items whose barcode matches a WMS barcode connect by themselves at 1 unit per sale. The rest wait on **Perlu dipetakan**.
3. For each one, choose the SKU and how many units one sale takes. A 2-pack is 2 units of one SKU. A kit made of different products cannot be mapped in the first build; keep kits off the Hiryu menu for now.
4. **Hiryu stores.** Enter each Hiryu store number once and which hub and brand it belongs to. The pilot has four.

A Grab order with an unmapped item cannot be pasted, so keep *Perlu dipetakan* empty.

## A3. Staff: a delivery arrives

The brand delivers straight to the hub with a Surat Jalan. The WMS only accepts a delivery whose AWB the SPV or Ops HQ has already recorded (§5.2).

1. Unload into the **temporary inbound bins** near the bench. One SKU per temporary bin.
2. **Barang masuk → scan or type the AWB.** The WMS shows what the brand said it sent.
3. Scan each unit. The screen shows *cocok*, *kurang N* or *lebih N* per SKU while you scan.
4. Put each unit where the screen says. The number on the screen tells you how many are in.

<!--screen:putaway-full-->

5. **If the bin is full, tap Bin penuh.** The WMS gives you an empty bin of the same size, as near as possible. Put the rest there.
6. The SPV is then asked whether the first bin was really full (A6.1). You do not need to wait for the answer.
7. **Finish.** *Selesai batch ini* if more of this AWB is still in the temporary bins, or *Semua barang AWB sudah diterima* when everything is in. Differences go to the SPV.

An unknown barcode: search the product list by name, pick the one in your hand. Not on the list: photograph it, count it, send it to Ops HQ, and leave it in the temporary bin.

## A4. Staff: a Grab order

About 20 seconds of copying, then the pick. Grab gives the hub **15 minutes** from when the order reaches Hiryu.

### A4.1 Copy the order from Hiryu

<!--screen:hiryu-copy-->

1. Hiryu plays the new-order sound and prints the packing slip. Open the order. **Leave Raw payload closed.** Its button must read *Show*.
2. Click once on the title **Order GM-…**. It is plain text, so clicking it does nothing in Hiryu. Do not click near the buttons.
3. Press **Ctrl + A**, then **Ctrl + C**.

### A4.2 Paste it into the WMS

<!--screen:paste-->

1. In the WMS open **Tempel pesanan Grab**, click the grey box and press **Ctrl + V**.
2. Check the GM number matches the slip and the green tick shows. The tick means the lines and units match Hiryu's count.
3. Press **Mulai ambil**.

| The WMS says | Do this |
|---|---|
| *Salinan tidak lengkap* | Go back to Hiryu, click the title, Ctrl + A, Ctrl + C again |
| *Tutup "Raw payload" dulu* | In Hiryu press *Hide* on Raw payload, copy again |
| *Barang belum dipetakan* | Tell the SPV. Ops HQ maps the item, then paste again |
| *Pesanan sudah ada* | It was pasted before; the WMS opens its pick |
| *Toko ini milik hub lain* | Wrong hub. Tell the SPV |

### A4.3 Pick

<!--screen:pick-->

1. Go to the bin on screen. Rack and level are highlighted.
2. Take the number shown, from the **oldest divider** first.
3. **Scan every unit.** A wrong product stops the pick; put it back and take the right one. If the wrong product was sitting in this bin, tap *Barang ini salah tempat*.
4. Not there, or not enough: **Barang tidak ada** (A5.1).

### A4.4 Pack

<!--screen:pack-->

1. Take the pack the WMS names: **paper bag** or **carton**. If it really does not fit, *Ganti kemasan* and choose a reason.
2. Scan the order label to finish.
3. **Press Mark ready in Hiryu** for the same GM number, then tap *Sudah tekan Mark ready*. Put the bag on the ready shelf.

### A4.5 Hand over to the Grab driver

<!--screen:handover-->

1. **Serah ke driver** lists the bags waiting. Amber means waiting more than 20 minutes.
2. Ask the driver for the order number. When it matches the label, tap **Ya, sudah diambil driver**. Hiryu updates by itself when Grab sees the pickup.

If Hiryu shows the order as cancelled, do not hand it over: paste the cancelled order page into *Tempel pesanan Grab* and unpack (A5.3).

## A5. Staff: something is wrong

### A5.1 An item is missing or short

<!--screen:short-->

1. **Barang tidak ada**, then say what you found: *Tidak ada sama sekali*, or set the number with − and +.
2. The WMS shows what the customer asked Grab to do if an item is sold out: **replace** with another product (it shows the bin), **remove** the item, **cancel** the whole order, or **contact** the customer. Replace: pick the replacement. Cancel or contact: call the SPV.
3. Carry on with the rest of the order. The SPV is told and handles Hiryu.

### A5.2 Report a problem

<!--screen:report-->

1. **Laporkan masalah** from any screen, then choose what happened:

| Choose | When |
|---|---|
| Rusak atau bocor | Broken, crushed, leaking, seal open |
| Kedaluwarsa | Past its date, or too close to sell (the SPV decides) |
| Salah tempat | A product in a bin that is not its own |
| Barang ditemukan | A unit somewhere the WMS does not expect: floor, wrong bin, back of the shelf |
| Kembalian dari driver | The driver brings back an order that was not delivered |
| Lainnya | Anything else |

2. Scan or pick the product, set the number, add a photo if you can. No photo of the packing slip: it can show the customer's name.
3. **Pindahkan ke KARANTINA.** Put the units in the hub's quarantine tray. They leave sellable stock straight away. *Salah tempat* and *Barang ditemukan* skip quarantine: the WMS names the right bin.

### A5.3 A cancelled order

1. Hiryu shows the order as CANCELLED. Open it in Hiryu, click the title, Ctrl + A, Ctrl + C.
2. Paste into *Tempel pesanan Grab*. The WMS shows *Pesanan dibatalkan*.
3. Anything already picked goes to **Kembalikan ke rak**: scan each unit back into its bin.

## A6. SPV: during the day

### A6.1 The second-bin question

<!--screen:second-bin-->

Whenever a SKU gets a second bin at a hub, whether a staffer tapped *Bin penuh* or you added it on *Rak & bin*, the WMS asks why.

1. Choose the reason. **Bin pertama penuh** is the one that matters.
2. If full: the WMS proposes the number now in the first bin as the **full number** for that SKU in that bin size. It applies to this hub, and to every other hub that has no number yet. Ops HQ can change it.
3. Other reasons (promo delivery, bin moved, undo) do not set a full number.

From then on the WMS sends new stock to the first bin until it holds the full number, then to the second.

### A6.2 Problems and quarantine

<!--screen:exceptions-->

1. **Tanggungan** shows who bears the cost under the reason chosen (table in §12.3). You can change the reason if the report was wrong.
2. Decide each report within 24 hours: **Kembali ke stok** (the unit is fine), **Hapus stok** (write off), or **Retur ke merek** (goes on the brand's next return list).
3. A write-off above 3 units or Rp300,000 in one report waits for Ops HQ to sign. Both limits are settings.

### A6.3 Also watch

- **Pengingat**: restock drafts to send to the brand, deliveries past their date, variances to acknowledge.
- **Serah ke driver**: a bag amber for 20 minutes or more. Check the order in Hiryu; if Grab cancelled it, have it unpacked (A5.3).
- **Item short**: after a picker's *Barang tidak ada*, follow the customer's choice in Hiryu, and if the SKU is now empty, type its new stock into Hiryu at once (A7 step 3 for one SKU).

## A7. SPV: end of day (and opening)

<!--screen:eod-->

1. **Order check.** In Hiryu, *Orders*, set Dark store = this hub and From / To = today. Click the title *Orders*, Ctrl + A, Ctrl + C, and paste into *Cek pesanan*. Fix every row the WMS lists: an order never pasted, a cancel never pasted, or an order the WMS has and Hiryu does not.
2. Wait until Hiryu **Live Orders** shows 0 under *Pending accept*, *Pending packing* and *Packed, awaiting pickup*.
3. **Stok untuk Hiryu.** For each store (the pilot has two per hub): open Hiryu *Stores → the store → Stock*, and type the WMS number from **Ketik di Hiryu** into **Units on hand** for each tinted row. Press **Save stock** in Hiryu.
4. Tap **Sudah disimpan di Hiryu** in the WMS.
5. Decide any problem still open, or leave a note for tomorrow's SPV.

Never use Hiryu's *Arrived → Add to stock*: the WMS number already includes the delivery, so it would be counted twice.

Do steps 2 to 4 at opening too, after each delivery is put away, and after each count is signed.

---

# Part B. Requirements

## 1. Summary and scope

Ninja Van fulfils quick-commerce orders for brands from small dark stores. For **GrabMart Kilat**, Grab takes the order and sends the rider; Ninja holds the stock, picks and packs. Ninja's POS, **Hiryu**, already receives Grab orders and holds the menu. The **WMS** is the layer underneath: where a unit goes, where a picker finds it, whether it is really there, and what arrived against what the brand said it sent.

**First build** *(decided 25 Sep)*: dark stores only; brand delivers direct; Grab orders by copy and paste from Hiryu; stock back to Hiryu by the SPV typing it in; Kahf and Labore at MA5 then KJ5.

**Target design** (governing document): every order enters through Hiryu, only Hiryu talks to the WMS, only the WMS counts the shelf, in five messages (§13.1). The first build keeps that shape so the stopgaps can be switched off one by one.

## 2. Principles

- **2.1** **The WMS never talks to Grab.** Channels connect to Hiryu. In the first build a person carries orders from Hiryu to the WMS (§13.2).
- **2.2** **One shelf count.** The WMS ledger is the only count of the shelf. Hiryu's number is corrected from it (§13.4) until Hiryu stops keeping its own.
- **2.3** **Every stock movement is scanned.** Picking has a scan check with no staff override.
- **2.4** **The ledger is append-only.** Balances are built from movements; negative stock is refused; every scan can be retried without counting twice.
- **2.5** **Red means failure and nothing else.** Every state has colour, an icon and words.
- **2.6** **No free text on the floor.** Quantities come from steppers and keypads.
- **2.7** **Bahasa Indonesia by default**, English one tap away, on every string.
- **2.8** **Online only, and it says so.** A dropped connection blocks work visibly.
- **2.9** **Training never touches real stock.**
- **2.10** **All stock belongs to the brand** (§6.5).
- **2.11** **Customer data stays in Hiryu.** The WMS never receives, stores, logs or shows a customer's name, phone, address, note or payment, and no table has a field for them (§13.2.1).

## 3. Users and roles

| Role | Where | Does |
|---|---|---|
| **Staff** | Dark store floor | Receive by AWB, put away, paste Grab orders, pick, pack, hand over, count, report problems |
| **SPV** | Their own hubs | Racks and bins, SKU to bin, the second-bin question, problem decisions, restock requests for their hubs, variance acknowledgement, count sign-off, end-of-day report |
| **Ops HQ** | Every hub | Brands, SKUs, photos, thresholds and Grab buffer, Hiryu menu and store maps, write-off and variance sign-off, staff accounts and sites |
| **Superadmin** | Everything | Everything Ops HQ does, granting superadmin, viewing the app as another role (read only) |

- **3.1** The server enforces every permission; the console hides screens a role cannot use.
- **3.2** The *hub operator* role for the central warehouse is hidden in the first build and returns with it (§20).
- **3.3** **Two surfaces.** *Station* for the floor: large type, one decision per screen, a scan area that keeps focus; works on a laptop with a scanner, a tablet, or a phone (installable, camera scan, type the code). *Console* for SPV and Ops HQ: tables, filters, queues.

## 4. Hubs, racks and bins

### 4.1 Sites

- **4.1.1** The first build has **dark stores only**. The central warehouse site type, transfers and tote dispatch stay in the code but are hidden (§20).
- **4.1.2** Each dark store keeps **temporary inbound bins** by the receiving bench and a **quarantine tray** (location `KARANTINA`). Neither holds sellable stock.

### 4.2 Layout is configurable **[DECIDED 25 Sep]**

A hub's layout is **racks → bays → levels → positions → stack**.

| Part | Set by | Rule |
|---|---|---|
| **Rack** | Ops HQ or SPV | A letter per hub, and a rack type (outer size, number of levels, clear width per bay) |
| **Bay** | Rack type, editable | A section between uprights. The 1 m catalog rack has 1; the 206 cm long-span can be set as 1 or 2 |
| **Level** | Per bay | Clear height, and **one bin size** per level |
| **Position** | Worked out | ⌊bay clear width ÷ bin width⌋, may be lowered |
| **Stack** | Worked out | min(⌊level clear height ÷ bin height⌋, the bin type's stack limit), may be lowered |

- **4.2.1** **Location code** `HUB-RACK BAY-LEVEL-POSITION[STACK]`, e.g. `MA5-A1-3-05T`. Stack letters: none for a single bin; B and T for two; B, M and T for three. Existing single-bay racks become bay 1 when migrated; no bin labels have been printed yet, so nothing is reprinted.
- **4.2.2** **Bin types** are a list Ops HQ keeps: code, name, outer and inner size (W × D × H mm), stack limit. Starting values:

| Bin | Outer W × D × H mm | Stack limit | Use |
|---|---|---|---|
| Small, Lion Star Jolly Box No.200 (JX-2) | 135 × 225 × 120 | 3 | Tubes, small bottles, compacts |
| Large, Lion Star Jolly Box No.400 (JX-4) | 198 × 356 × 170 | 2 | Bottles 150 ml and up, kits |

- **4.2.3** Inner bin sizes are not published: measure the first sample and correct the list.
- **4.2.4** **Stacked bins are picked from the front** (both types are open-front). The WMS draws a stack as one column, top on top.
- **4.2.5** Racks can grow: add a rack, a bay, a level, or positions. A bin, level or bay can be removed only if it has **never held stock**.
- **4.2.6** **One bin holds one SKU.** Dividers inside a bin separate deliveries (§7.8), never SKUs.

## 5. Restocking from the brand

### 5.1 One route in the first build **[DECIDED 25 Sep]**

**Brand → dark store**, direct. Supplier to central warehouse to dark store, and crossdock, are later builds (§20).

### 5.2 Restock request to the brand **[built 17 Sep]**

The stock is on consignment: the brand owns it until it sells. Ninja raises the restock request and gives the brand the consignment form. Ops HQ runs it for every hub; the SPV for their own hubs.

| Step | Who | What happens |
|---|---|---|
| **Alert** | WMS | A SKU at a hub falls to its restock point R (all its bins together). It appears on *Needs restock* with a suggested quantity up to P |
| **Draft** | WMS, then Ops HQ or SPV | The WMS drafts one request per hub and brand by itself; a person checks and adjusts it |
| **Sent** | Ops HQ or SPV | The request text is copied and sent to the brand outside the WMS (WhatsApp or email) and marked sent. Quantities freeze |
| **Confirmed** | Ops HQ or SPV | Records the brand's AWB, Surat Jalan number, arrival date and the quantity the brand will really send |
| **Received** | Staff | Received by AWB (A3). If everything matches, the request closes and those numbers are billed |
| **Variance** | SPV, then Ops HQ | Differences: the SPV enters the final count and a reason; Ops HQ signs. The signed number is billed |

- **5.2.1** Reference `RPL-<hub>-<yymm>-<n>`. One AWB belongs to one open request.
- **5.2.2** A delivery without a recorded AWB cannot be received; it waits in the temporary bins.
- **5.2.3** The SPV and Ops HQ steps of a variance are two different people.
- **5.2.4** Still to agree with the brands (through Grab): safety stock, how often to restock, expiry and slow-mover returns, and a restock fee separate from the 5% fulfilment fee. They become settings (§8.6), not a rebuild.

### 5.3 Monthly sell-out report to the brand

Ninja sends each brand a monthly report: units sold and units left per SKU, per hub, with sales value. Units come from the WMS; value = units × the SKU's list price (the WMS takes no prices from orders, §2.11). The *Penjualan* tab of the end-of-day report (§13.5) builds it day by day; Ops HQ downloads a month as CSV.

## 6. Products

### 6.1 Registering a SKU **[updated 25 Sep]**

Ops HQ registers each SKU **once for every hub** (A2.2):

| Field | Required | Notes |
|---|---|---|
| Brand, SKU code, name, size, category | Yes | SKU code = the brand's code, and the same code in Hiryu |
| **Barcode(s)** | If the pack has one | One barcode belongs to one SKU, ever. A SKU may have several |
| Pack L × W × H mm, weight g | Optional | Drive bin size and packaging. Appendix B |
| Liquid in a bottle; large bottle (150 ml or more) | Optional | Drive the carton rule (§14) |
| **Bin size** | Yes | Suggested from pack size, else from category |
| **Full number** | Optional | Only if known from a similar SKU in the same bin size (§8.2) |
| P, R, S | P yes | R defaults to 25% of P; S optional |
| Grab buffer | Optional | Default 0 (§13.6) |
| Photo | Optional | 1:1, at least 800 × 800, white background |

- **6.1.1** **Bulk import**: the SKU master sheet (Appendix B) imports as a CSV with the same columns, with a preview before anything is saved.
- **6.1.2** A SKU registered at HQ appears on every hub's *Perlu rak* list **with its bin size**. The SPV picks a free bin of that size; the WMS suggests the most comfortable height first (level 3, then 2, 4, 1, 5).
- **6.1.3** A SKU with no bin at a hub can be received there (staff are given a bin during inbound) but not picked.

### 6.2 Barcodes

- **6.2.1** Barcodes can be entered at registration, or bound the first time a unit arrives: staff search the product list, pick the product in their hand, and the barcode is bound for good.
- **6.2.2** An unknown product at inbound goes to Ops HQ with a photo and count (A3); it is not stock until HQ answers.
- **6.2.3** Ninja's own unit labels (for brands without barcodes) stay built but hidden. Kahf and Labore are barcoded.

### 6.3 Pack data

The WMS asks the brand for pack size and weight but must work without them. Missing data never blocks a delivery or a pick: category defaults fill in and screens show *perkiraan* (estimate).

### 6.4 Photos

Ops HQ uploads the product photo; for near-identical products the photo is what the picker checks.

### 6.5 Stock owner and listing model **[DECIDED 25 Sep]**

- **6.5.1** **All stock is owned by the brand.** Ninja owns no stock and Grab owns no stock in this operation. Every movement and balance records the brand as owner.
- **6.5.2** What differs between brands is **who lists the store on Grab**, a setting per brand:

| Listing model | Who is the merchant on Grab | Example |
|---|---|---|
| `grab_3pl` | Grab brings the brand and asks Ninja to be its 3PL | **Kahf, Labore** (pilot) |
| `ninja_merchant` | Ninja finds the brand and registers its own merchant on Grab | Malaysia today |

- **6.5.3** The listing model does not change how the floor works. It sets who receives reports and who the restock request goes through.
- **6.5.4** The old owner values *grab* and *ninja* are retired by migration.

## 7. Inbound

- **7.1** **Inbound starts from the AWB** or the RPL reference (§5.2). The receipt opens with the brand's confirmed quantities and compares per SKU while scanning.
- **7.2** **Batches.** One temporary bin holds one SKU; a hub's number of temporary bins is set on *Rak & bin*. One AWB can be received in several batches.
- **7.3** **Where each unit goes.** New stock goes to the SKU's first bin until it holds the **full number**, then to the next bin. With **no full number** yet, everything goes to the first bin until staff tap **Bin penuh** (A3).
- **7.4** **Bin penuh** during putaway: the WMS offers the nearest free bin of the SKU's bin size at that hub, registers it as the SKU's next bin, and raises the second-bin question to the SPV (§8.2). Staff do not wait.
- **7.5** **Sellable from the putaway scan.** Nothing waits for a signature. The SKU appears on the stock sheet for Hiryu (§13.4).
- **7.6** **Putaway list.** A frozen record of what went where, the day colour and the 24-hour claim deadline; the SPV signs it for compliance.
- **7.7** **24 hours.** Differences against the brand must be raised within 24 hours of receipt; after that the hub bears the loss.

### 7.8 Day colours and FIFO

Each delivery goes behind its own coloured divider in the bin; the colour is the week of delivery, with the date written on the white divider. The WMS does not track dividers. It sends the picker to the bin holding the oldest stock, and the screen says *ambil dari sekat paling lama*. No expiry dates are recorded in the first build.

## 8. Storage and thresholds

### 8.1 The numbers per SKU per hub

| Number | Measured on | What it does |
|---|---|---|
| **Full** | One bin | New stock moves on to the next bin |
| **Restock point R** | All the SKU's bins | Drafts a restock request to the brand |
| **Target P** | All the SKU's bins | What a restock fills up to |
| **Safety stock S** | All the SKU's bins | A critical flag. Must be R or lower |

- **8.1.1** The WMS refuses settings that cannot work (R below zero, S above R, full of zero).
- **8.1.2** R defaults to 25% of P (a setting).

### 8.2 The full number is learned **[DECIDED 25 Sep]**

Bin sizes and pack sizes differ, so the full number cannot be known for every SKU at launch.

- **8.2.1** **Stored per SKU × bin size**, shared by all hubs, with an optional value per hub that overrides it.
- **8.2.2** **At registration** Ops HQ may copy it from a similar SKU in the same bin size. Otherwise it stays empty.
- **8.2.3** **Learned from the SPV.** Whenever a SKU gets a second bin at a hub, by *Bin penuh* (§7.4) or by the SPV on *Rak & bin*, the WMS asks the SPV why:

| Answer | Effect |
|---|---|
| **First bin is full** | Full = the units now in the first bin. Saved for this hub; also saved for all hubs if the SKU × bin size has no shared number yet |
| Much more stock than usual arrived (promo) | Second bin kept, no full number set |
| Moved bin (damaged bin, better place) | Stock moves, no full number set |
| Undo | The second bin is released once empty |

- **8.2.4** If a hub's learned number differs from the shared number by more than 20%, Ops HQ gets a flag to choose which one stands.
- **8.2.5** Ops HQ can set or change any full number at any time on the hub map.

### 8.3 Where the picker is sent

The picker goes to whichever of the SKU's bins holds the **oldest stock**. There is no task to move stock from one bin to another; the picker simply follows the oldest.

### 8.4 Hub map (Ops HQ)

Every hub in one table: bins used and free, SKUs without a bin, units held, SKUs low, out, or without R, deliveries on the way, open variances, open problems. Clicking a hub opens its layout map, one square per bin, coloured by stock or by availability.

### 8.5 Reminders and flags **[built 21 Sep]**

| Flag | Level | Default |
|---|---|---|
| Out of stock, or at or below S | Critical | on |
| Restock draft waiting to be sent | Info | on |
| Draft not sent after N hours | Action | 4 h |
| Brand has not confirmed after N hours | Action | 24 h |
| Delivery N days past its date | Action | 1 day |
| Variance waiting after N hours | Action | 24 h |
| Unknown product waiting for HQ after N hours | Action | 24 h |
| SKU without a bin N days after registration | Action | 2 days |
| **Second-bin question unanswered after N hours** | Action | 4 h *(new)* |
| **Problem report undecided after N hours** | Action | 24 h *(new)* |
| **Bag ready, not collected after N minutes** | Action | 20 min *(new)* |
| **Stock not typed into Hiryu N hours after a change** | Action | 2 h *(new)* |
| Slow mover: not picked for N days | Info | off, 30 days |

### 8.6 Settings instead of rebuilds

Every number above, the write-off limits (§12.2), the Grab buffer rule (§13.6) and the packaging limits (§14) are settings Ops HQ changes on *Aturan pengingat*, so terms still open with the brands become settings, not code.

## 9. Orders

- **9.1** **One channel in the first build: GrabMart Kilat.** An order reaches the WMS by paste (§13.2). WhatsApp orders are a later build (§20).
- **9.2** Every order carries its Grab order ID (the key), the GM number (for people), the Hiryu store, the hub, and **ready-by = the Hiryu order time + 15 minutes**.
- **9.3** **Stock is held for an order as soon as it is pasted**, so two orders can never be given the last unit. Held means the units stay on the shelf but are no longer free for another order.
- **9.4** **Pick queue**: three lanes (waiting, being picked, done today), sorted by time left before ready-by, not by age. A picker who holds an order too long is flagged; the SPV can release it.
- **9.5** **Grab's own stock behaviour** *(confirmed 25 Sep)*: Grab lowers the stock it shows as soon as an order is placed, and **does not put it back when the order is cancelled**. So after a cancel, Grab shows fewer units than the hub has until the SPV types the stock in again. The WMS marks those SKUs as changed on the stock sheet.

## 10. Picking, packing and handover

### 10.1 Guided pick

- **10.1.1** The picker is sent to **one bin at a time**, in walking order, with the bin code, the product photo and the number to take.
- **10.1.2** **Each unit is scanned.** A wrong product stops the pick with both products side by side. No override.
- **10.1.3** Picking several orders at once is not in the first build. It pays only above about 15 orders an hour per picker; the pilot plans about 7 a day per hub.

### 10.2 When an item is missing **[rewritten 25 Sep]**

What happens, in plain words:

1. The picker gets to the bin and the product is not there, or there are fewer than needed.
2. The picker taps **Barang tidak ada** and says how many were found: none, or a number set with − and +. Two taps, no typing.
3. The WMS shows **what the customer asked Grab to do if an item is sold out**, copied from the Hiryu order: replace with another product (and where it is), remove the item, cancel the order, or contact the customer. For a replacement the picker picks it straight away; it is scanned like any other line.
4. The picker carries on with the rest of the order.

What the WMS does at that moment:

- **Fixes the bin's count to what was found**, so no other order is sent to an empty bin.
- **Lets go of the hold** on the units that were not found.
- **Puts the SKU on the stock sheet** so the SPV lowers the number in Hiryu (and Grab).
- **Tells the SPV**, naming the picker, so the SPV can act in Hiryu.

Why a picker may change stock without the SPV: every other stock correction needs the SPV, but waiting here means Grab keeps selling a product the hub does not have. To stop misuse, the SPV sees every declaration with the picker's name, and the SKU goes onto the next count list.

The WMS never decides the customer's outcome. The SPV follows the customer's choice in Hiryu (what to press is open question Q2).

### 10.3 Pack

- **10.3.1** The WMS names the pack before the pick starts (§14). The packer can change it in two taps with a reason from a list.
- **10.3.2** Scanning the order label marks the order **packed**. The screen then asks staff to press *Mark ready* in Hiryu and to confirm they did (*Sudah tekan Mark ready*). The WMS records the confirmation.

### 10.4 Handover to the Grab driver **[DECIDED 25 Sep]**

- **10.4.1** Packed orders wait on the **ready shelf**. *Serah ke driver* lists them with how long they have waited.
- **10.4.2** When the driver arrives, staff match the order number the driver gives with the label and tap **Sudah diambil driver**. The WMS records who handed over and when. The order is **done** in the WMS.
- **10.4.3** A bag waiting more than 20 minutes (setting) is amber and flags the SPV.
- **10.4.4** No photo is stored in the WMS: the packing slip on the bag can show the customer's name (§2.11).

### 10.5 Order states in the WMS

| State | Set by |
|---|---|
| Waiting | Paste |
| Being picked | Picker claims it |
| Packed | Pack scan |
| Mark ready confirmed | Staff tap after pressing *Mark ready* in Hiryu |
| Collected | Staff tap *Sudah diambil driver* |
| Cancelled | Paste of a cancelled order |

### 10.6 Cancellation

Pasting a cancelled order lets go of the hold. Units already picked go to **Kembalikan ke rak**: any staff member scans each unit back into the bin it came from, and each scan puts it back in stock. A packed bag is unpacked first.

## 11. Stock count

- **11.1** **Cadence**: the top 20% of SKUs by units picked over four weeks are counted weekly; the rest monthly. New SKUs count as top until they have history. SKUs with a *Barang tidak ada* go on the next count list.
- **11.2** **How**: the staffer picks a bin, it is locked to them, they scan every unit. The system number stays hidden. Any difference flags; the staffer recounts once before the number is shown.
- **11.3** **Sign-off**: counting never moves stock by itself. The SPV reviews the difference, picks a reason and approves; only then does the stock change.

## 12. Exceptions

*Designed 25 September.*

### 12.1 One path for every stock problem

1. **Report.** Anyone taps *Laporkan masalah*, picks the reason, the product and the number, adds a photo if possible (A5.2).
2. **Quarantine.** Units leave sellable stock straight away into `KARANTINA` (a tray per hub), except *salah tempat* and *ditemukan*, which go straight to the right bin.
3. **Decide.** The SPV decides within 24 hours: **back to stock**, **write off**, or **return to the brand**.
4. **Sign.** Write-offs above the limit wait for Ops HQ.
5. **Review.** Ops HQ sees write-offs by reason, SKU, hub and person each month; returns to the brand go on the brand's next return list with the Surat Jalan.

### 12.2 Limits (settings)

The SPV may write off up to **3 units and Rp300,000** (at list price) in one report. Above that, Ops HQ signs. The person who reports cannot also approve.

### 12.3 Reasons and who bears the cost

| Reason | When found | Goes to | Cost borne by |
|---|---|---|---|
| Arrived damaged, short or wrong | At receiving, within 24 h | Delivery variance (§5.2) | Brand |
| Damaged in the hub | Any time | Quarantine | Ninja |
| Faulty pack (leak, seal) with no handling cause | Any time | Quarantine | Brand |
| Expired or too close to sell | Pick, count, putaway | Quarantine, return to brand | Brand (terms to confirm) |
| Wrong place | Pick, count | Moved to its own bin | Nobody |
| Found | Anywhere | Back to stock after SPV check; reverses an earlier short if there was one | Nobody |
| Lost | Count sign-off, or short never found | Written off at count sign-off | Ninja |
| Returned by the driver, intact | Handover desk | Back to shelf, unit by unit | Nobody |
| Returned by the driver, damaged | Handover desk | Quarantine | To confirm with Grab |

### 12.4 Order problems

| Problem | What the WMS does | Who acts |
|---|---|---|
| Paste refused (unmapped item) | Item goes to HQ's *Perlu dipetakan*; the order waits | Ops HQ maps it; staff paste again |
| Order in Hiryu, never pasted | Shows on the end-of-day order check | SPV. If it was already handed over, the SPV pastes it with **Catat pesanan terlewat**: the WMS takes the stock off without a pick and marks it unscanned |
| Cancel never pasted | Shows on the order check | SPV pastes it; picked units go back to the shelf |
| Bag not collected | Amber after 20 min, flag to SPV | SPV checks Hiryu; if cancelled, unpack |
| Driver returns an undelivered order | *Kembalian dari driver*: find the order by GM number, scan each unit good or damaged | Staff, then SPV |

## 13. Working with Hiryu

### 13.1 The target: five messages

When the Hiryu link is built, exactly five messages cross between the two systems:

| Name | From → to | When |
|---|---|---|
| **Order to pick** | Hiryu → WMS | An order is accepted |
| **Order cancelled** | Hiryu → WMS | The customer or Grab cancels |
| **Stock update** | WMS → Hiryu | After every change: available = on the shelf minus held for orders |
| **Order ready** | WMS → Hiryu | Pack scan |
| **Item short** | WMS → Hiryu | A picker declares a missing item |

Rules for that day: whole numbers, never "plus 2"; every message safe to resend; messages queue if the other side is down; the training site sends nothing. Today the WMS works out and queues these messages but **sends none**, because the link does not exist yet.

### 13.2 Now: orders by copy and paste **[DECIDED 21 Sep, first build]**

Two ways in, one reader, one endpoint:

| | Paste the order page | One-click button |
|---|---|---|
| Staff do | Copy the whole Hiryu order page, paste in the WMS (A4.1, A4.2) | Click **Kirim ke WMS** in the bookmarks bar with the Hiryu order open |
| Build | **First** | After paste is live, and after a heads-up to Shaun and NV security |
| Touches Hiryu? | No | Reads the visible page only, like a copy |

#### 13.2.1 Customer data stays in Hiryu

- The pasted text is **read in the browser** and never sent. The page takes out only the fields in 13.2.2, sends those, and clears the box whether the paste worked or not.
- The server accepts those fields and nothing else; unknown fields are refused and every text field has a strict pattern.
- **Raw payload is refused**: a paste containing Hiryu's raw data (which holds the customer's name and contact) is thrown away with *Tutup "Raw payload" dulu, lalu salin ulang*.
- Staff names and emails from Hiryu's History card are ignored. Prices and totals are ignored.

#### 13.2.2 What the reader takes

Grab order ID; GM number; Hiryu status; Hiryu store number; order time; Hiryu's own *N lines · M units*; per line the quantity, the Hiryu item ID, and the out-of-stock choice (replace, remove, cancel, contact) with the replacement item and quantity.

- **The key is the Grab order ID, never the GM number.** GM numbers repeat (Malaysia already has two different GM-482).
- **Check**: lines found and units summed must equal Hiryu's *N lines · M units*, or nothing is sent.
- **Build against real pastes**: before building, collect 10 pastes from Malaysia (several statuses, bundles, both out-of-stock types, a cancel) with customer data removed by hand. If Hiryu's page changes, the reader refuses clearly and never guesses.

#### 13.2.3 What a paste does

| Hiryu status in the paste | WMS |
|---|---|
| RECEIVED, ACCEPTED | New order: hold stock, queue, start the guided pick. Units per SKU = quantity × units per sale |
| Same order again, still open | Opens the existing pick |
| CANCELLED, REJECTED, FAILED | Cancel: let go of the hold; picked units back to the shelf |
| DRIVER_ALLOCATED or later, never pasted | Refused; the SPV uses *Catat pesanan terlewat* if it was really handed over |
| Store of another hub | Refused, naming the right hub |

Endpoint `POST /api/hiryu/paste`, open to staff and up at that hub; records who pasted, when, and whether by paste or button.

#### 13.2.4 The one-click button, later

A bookmark named **Kirim ke WMS** in the packing PC's normal Chrome profile (not the kiosk-printing one). It reads the visible text of the open Hiryu order page, runs the same reader, and opens the WMS paste screen filled in, waiting for *Mulai ambil*. It calls nothing in Hiryu and reads no login.

### 13.3 Maps kept by Ops HQ

| Map | Holds | Filled by |
|---|---|---|
| Hiryu items | Hiryu item ID → SKU and units per sale | Upload of Hiryu's menu CSV (columns used: `item_id`, `item_name`, `barcode`, `available_status`); barcode matches map at 1 unit; the rest by hand |
| Hiryu stores | Store number → hub and brand | Typed once per store |

### 13.4 Now: stock by typing **[DECIDED 25 Sep, first build]**

- **13.4.1** *Stok untuk Hiryu*, one table per Hiryu store: SKU code, name, WMS available, Grab buffer, **Ketik di Hiryu**, last value typed, and a changed mark. Sorted by SKU code like Hiryu's Stock tab.
- **13.4.2** **Ketik di Hiryu = available − Grab buffer, never below 0.** Available = on the shelf minus held for orders.
- **13.4.3** A row is marked changed when its number differs from the last value typed, and always after a cancel of that SKU (Grab does not restore its count, §9.5).
- **13.4.4** The SPV types the changed rows into Hiryu's *Units on hand*, saves in Hiryu, then taps **Sudah disimpan di Hiryu**; the WMS records each value as typed.
- **13.4.5** Only when Hiryu Live Orders shows no order in progress for that hub, until Shaun confirms when Hiryu takes a sale off its own count (Q1).
- **13.4.6** Never Hiryu's *Arrived → Add to stock*.

### 13.5 End-of-day report **[DECIDED 25 Sep]**

One screen per hub, **Laporan akhir hari**, for the SPV to close the day in Hiryu:

| Tab | Holds |
|---|---|
| **Stok untuk Hiryu** | §13.4, every SKU, changed rows first |
| **Cek pesanan** | Paste Hiryu's order list for the day (it holds no customer data; the WMS keeps Grab order IDs, GM numbers, stores and statuses only). Three lists: in Hiryu not in the WMS; cancelled in Hiryu, open in the WMS; in the WMS not in Hiryu |
| **Masalah hari ini** | Reports, decisions, anything still open |
| **Penjualan** | Units sold per SKU today; feeds the monthly sell-out report (§5.3) |

Downloadable as CSV. The same *Stok untuk Hiryu* tab is used at opening and after each delivery.

### 13.6 Grab buffer **[DECIDED 25 Sep]**

Ninja sets the Grab buffer, as the stock planner for its own dark stores. It is a number of units per SKU held back from what Grab can sell, so a miscount or a damaged unit does not become a cancelled Grab order. Ops HQ sets it per SKU, or a rule for many (for example 1 unit when available is 5 or fewer). Default 0. In the first build the WMS applies it on the stock sheet; once Hiryu is linked the same number moves to Hiryu's own buffer setting.

## 14. Packaging rule

*Updated 25 September.*

**Two packs only: a paper bag and a carton.** No ziplock, no bubble wrap in the logic.

| Pack | Inner size | Usable volume | Max load (assumed) |
|---|---|---|---|
| Paper bag, kraft 70 gsm with handles (Berkah PBG15) | 18 × 10 × 33 cm | 18 × 10 × 27 cm × 80% = **3.9 L** | **3.0 kg** |
| Carton, single wall (Maxellpack CCM-36) | 25 × 20 × 10 cm | 25 × 20 × 10 cm × 80% = **4.0 L** | **5.0 kg** |

### 14.1 The rule

For each order the WMS adds up:

- **V** = the sum of units × pack volume;
- **G** = the sum of units × weight;
- **L** = the longest pack in the order;
- **N** = how many large bottles (150 ml or more).

1. **Paper bag** if V ≤ 3.9 L, G ≤ 3.0 kg, L ≤ 27 cm and N < 2.
2. Otherwise **carton** if V ≤ 4.0 L, G ≤ 5.0 kg and L ≤ 25 cm.
3. Otherwise **two packs**: the WMS splits the lines, heavy and large items into the carton first, and marks the order *2 kemasan*.

### 14.2 Why these numbers

Grab has no bag or carton spec, so every number is an assumption to test:

- **Usable volume.** The bag loses 6 cm at the top to fold it shut. Both packs are counted at 80% full, because rigid boxes and bottles never fill a space completely; about a fifth stays air.
- **Paper bag 3.0 kg.** Small kraft bags with twisted handles are usually sold as carrying 3 to 5 kg. We take the bottom of that range because the bag also swings in a rider's box.
- **Carton 5.0 kg.** A single-wall carton this size carries far more than that. The limit is what the bottom tape and a rider's box handle comfortably.
- **Two large bottles means a carton.** Two heavy bottles in a paper bag press on one spot, tear the bottom and crush the small items beside them. In the earlier order simulation this sent about 13% of orders to a carton.
- **Longest item.** A bag takes items up to its folded height (27 cm) standing; the carton up to its length (25 cm).

When pack data is missing: volume from the SKU list estimate; weight = content (ml or g) × 1.0 plus 20% for the pack (plastic) or 60% (glass); category default if neither is known. The suggestion then shows *perkiraan*.

### 14.3 Test before go-live, then set

1. Fill a bag to 3.0 kg with real products (for example 2 Labore 225 ml cleansers and the rest small tubes).
2. Lift it by the handles, shake it 10 times, hang it for a minute, drop it from 30 cm onto a hard floor.
3. If it holds, try 4.0 kg the same way. The limit becomes the last weight that passed, minus 20%.
4. Do the same for the carton, then set both limits on *Aturan pengingat*. Every change of pack by a packer (with its reason) is counted weekly, so a limit that is wrong shows up.

## 15. Admin, access, training and security

- **15.1** Sign-in is Google SSO through the Substrait proxy; the app stores no passwords. Superadmin and Ops HQ see every hub; others see their own. Nobody changes their own role.
- **15.2** At go-live, automatic staff accounts are switched off and Ops HQ creates accounts.
- **15.3** A separate training site with a banner, one-tap reset, test barcodes and a Hiryu order simulator. It never reaches real stock.
- **15.4** **Security**: Substrait's security team reviews the app when it is deployed and says what to fix. That replaces the earlier question of who reviews scan findings.

## 16. Service targets and scale

| Measure | Definition | Target |
|---|---|---|
| On time | Orders packed before ready-by | **95%** |
| Pick and pack | Paste → packed | **under 5 min** |
| Items short | Order lines with *Barang tidak ada* | **under 3%** |
| Count accuracy | Bins counted with no difference | **98%** |
| Pick accuracy | Lines picked with no wrong-product stop | 99.5% or better (tracked) |

Before the second hub goes live: every list pages and runs in one query; screens that watch live state update by push; a short scan buffer holds scans across a Wi-Fi blip.

## 17. Build status

As of 25 September 2026. *Verified* = driven end to end on the training site; *built* = written and checked, not yet driven.

| Area | State |
|---|---|
| Ledger, audit, stock owner | Verified |
| Receive by AWB, batches, putaway list, unknown product to HQ | Verified / built 17 to 21 Sep |
| Restock to the brand, variance sign-off, reminders and auto draft | Built 17 to 21 Sep |
| Guided pick, wrong-product stop, pack, short pick, cancel and return to shelf | Verified |
| Stock count, blind, recount, sign-off | Verified |
| Racks and bins, stacked T/B, hub map | Built 17 to 21 Sep |
| Station on a phone | Built 21 Sep |
| **Configurable bays, stack from bin size, bin types (§4.2)** | **Specified 25 Sep** |
| **Learned full number and the second-bin question (§8.2)** | **Specified 25 Sep** |
| **SKU form: barcodes, pack data, bin size, Grab buffer; master import (§6.1)** | **Specified 25 Sep** |
| **Hiryu maps, paste, cancel by paste (§13.2, §13.3)** | **Specified 21 Sep**, build first |
| **Handover to driver, Mark ready confirmation (§10.3, §10.4)** | **Specified 25 Sep** |
| **Exceptions and quarantine (§12)** | **Specified 25 Sep** |
| **Stock sheet, end-of-day report, Grab buffer (§13.4 to §13.6)** | **Specified 25 Sep** |
| **Packaging, two packs (§14)** | **Specified 25 Sep** |
| One-click button (§13.2.4) | Specified, after paste |
| Central warehouse, transfers, unit labels, WhatsApp simulator | Built, hidden in the first build |

**Build order proposed**: (1) Hiryu maps and SKU form; (2) paste an order; (3) handover, Mark ready confirmation, cancel by paste; (4) stock sheet and end-of-day report; (5) exceptions; (6) bays and learned full number; (7) packaging; then the button.

---

# Part C. Decisions and open points

## 18. Decisions of 25 September

| Topic | Decision |
|---|---|
| Central warehouse (Logos) | Not in the first build |
| Rack layout | Configurable racks, bays, levels, positions; stack from bin size (§4.2) |
| Handover | The WMS records the Grab driver pickup (§10.4) |
| Stock back to Hiryu | The WMS lists it; the SPV types it (§13.4, §13.5) |
| Go-live brands | Kahf and Labore; 105 SKUs after the recheck (Appendix B) |
| Stock owner | Always the brand; listing model per brand (§6.5) |
| SKU registration | Includes barcodes, bin size, optional pack data and full number (§6.1) |
| Full number | Learned from the SPV's second-bin answer (§8.2) |
| Short pick | Rewritten in plain words (§10.2) |
| Packaging | Paper bag and carton only; rule and assumptions explained (§14) |
| Malaysia PRD | Not merged for now |
| Grab stock | Lowers on order, not restored on cancel (§9.5) |
| Rider dispatch | Out of scope for the WMS |
| Grab buffer | Set by Ninja (§13.6) |
| WhatsApp | A later build inside the WMS, after launch (§20) |
| Restocking | Brand direct to dark store; central warehouse and crossdock later |
| Exceptions | Designed (§12) |
| Security | Substrait security review at deploy |
| Pack data | Asked from the brands, not required (Appendix B) |

**Split orders**, explained: one customer order filled from **two dark stores** (or two parts sent separately) because neither hub has every item. It needs two riders for one small basket, so it costs more than it earns. The WMS does not split orders; for Grab it never arises, because a Grab order belongs to one store and so to one hub.

## 19. Open questions

| # | Question | Who |
|---|---|---|
| Q1 | When does Hiryu take a sale off its own count (received, ready or completed), and does a cancel put it back? | Shaun |
| Q2 | What must the hub press in Hiryu for each out-of-stock choice (replace, remove, cancel, contact)? Can Hiryu edit an order? | Shaun |
| Q3 | Can a hub staff login open the Hiryu order page and copy it? What prefix do Indonesia item IDs use? | Shaun |
| Q4 | Is the one-click bookmark acceptable on the packing PC? | Shaun, NV security |
| Q5 | Consignment terms with Kahf and Labore: safety stock, restock frequency, expiry and slow-mover returns, restock fee | Grab, Paragon |
| Q6 | Who bears a unit damaged in delivery and returned by the driver? | Grab |
| Q7 | Will Paragon give barcodes, pack sizes and weights (Appendix B)? | Grab, Paragon |
| Q8 | Bag and carton limits after the load test (§14.3) | Ops |
| Q9 | Inner sizes of JX-2 and JX-4 from the first samples (§4.2.3) | Ops |

## 20. Later builds

| Build | When | Note |
|---|---|---|
| **One-click button** | After paste is live | §13.2.4 |
| **Hiryu link (five messages)** | When Hiryu's team takes it on | Replaces paste and the stock sheet; the maps stay |
| **WhatsApp orders** | After the WMS is launched and stable | Self-contained inside the WMS first; may move behind Hiryu later. The simulator is built |
| **Central warehouse** (Logos) | Later | Supplier to warehouse to dark store, transfers, tote dispatch, the hub operator role |
| **Crossdock** | With the central warehouse | Staging with a dwell limit |
| **Expiry dates** | If the brands require it | Would add dates at receiving and expiry flags |
| **Merge with the Malaysia PRD** | Not now | |

## 21. Not doing

| Not doing | Why |
|---|---|
| Any link to Grab | Only Hiryu talks to Grab |
| Rider dispatch | Grab assigns its riders; Ninja's own fleet is outside the WMS |
| Split orders | See §18 |
| Customer data | Not needed to pick or pack, and a risk if held (§2.11) |
| Calling Hiryu's internal API | Not ours to depend on; the WMS reads only what staff can see |
| Tracking dividers | FIFO inside a bin is by eye, guided by colour |
| Automatic slotting | SPVs place SKUs by brand and category |
| Substitution decided by the WMS | The customer's choice, applied in Hiryu |
| Picking several orders at once | Pays only at much higher volume |
| Settlement and billing | Finance, outside the system |

## Appendix A. Glossary

| Term | Meaning |
|---|---|
| **Hiryu** | Ninja's POS for Grab: orders, menu, prices, the stock Grab shows |
| **Grab order ID** | Grab's order reference, e.g. `0012…-C8E3PBB2NJU2NT`; the key for a pasted order |
| **GM number** | Hiryu's short order number, e.g. `GM-358`; for people, not unique |
| **Hiryu item ID** | Hiryu's ID for a menu item; maps to a SKU and units per sale |
| **Available** | Units on the shelf minus units held for orders |
| **Held** | Units kept for an order that has not been picked yet |
| **Grab buffer** | Units per SKU kept back from what Grab may sell (§13.6) |
| **Bay** | A section of a rack between uprights |
| **Bin size** | Small (JX-2) or Large (JX-4); one size per level |
| **Full number** | How many units of a SKU fill one bin; learned (§8.2) |
| **R, P, S** | Restock point, target, safety stock |
| **Karantina** | The hub's quarantine tray; not sellable |
| **Temporary inbound bin** | Where a delivery waits before putaway; not stock |
| **Day colour** | Sticker colour for the week a delivery arrived, with the date on the divider |
| **Listing model** | Who is the merchant on Grab: Grab's 3PL model or Ninja's own merchant (§6.5) |
| **Split order** | One order filled from two hubs (§18) |
| **Stock sheet** | *Stok untuk Hiryu*: the numbers the SPV types into Hiryu |

## Appendix B. SKU master for Kahf and Labore

**Go-live range after the 25 Sep recheck: 105 SKUs**, 68 Kahf (67 products and 1 factory kit) and 37 Labore (33 products and 4 factory kits). The recheck found 1 new Kahf SKU and 15 new Labore SKUs; 41 rows were set aside (marketplace bundles, duplicates, likely discontinued). 56 of the 105 already have a barcode from public sources; no pack sizes were found. Details: `SKU-RECHECK-25SEP.md` in the Grab Kilat project folder.

The SKU list and the data sheet for the brands is `11 SKU Master Kahf Labore.xlsx` in the same folder. It has one row per SKU, yellow cells for the brand to fill, and the columns the WMS imports (§6.1.1):

| Column | Required | Notes |
|---|---|---|
| Brand, SKU code, product name, variant, size, category | Yes | From the brand |
| Barcode (EAN-13) | Yes if printed | More than one allowed, separated by a comma |
| Pack length, width, height (mm) | Asked | The retail box or bottle, standing |
| Weight (g) | Asked | Gross, with pack |
| Liquid in a bottle (Y/N); large bottle 150 ml or more (Y/N) | Asked | For the carton rule |
| Units per carton, carton size | Asked | For receiving |
| Shelf life (months), BPOM number | Asked | For expiry terms |
| Bin size, full number | Ninja fills | Suggested by the WMS from the pack size |

Where the brand gives nothing, the WMS uses the estimates in the sheet and marks them *perkiraan*.
