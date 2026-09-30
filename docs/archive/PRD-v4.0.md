# Ninja Kilat WMS: requirements and working instruction

| | |
|---|---|
| **Product** | Ninja Kilat WMS |
| **Version** | v4.0: the same content as v3.3, arranged by process. Part A holds what everyone reads once; Part B has one section per process, each with the steps in both systems (Hiryu first), the rules, and the open points still to refine; Part C holds build status and decisions |
| **Date** | 29 September 2026 |
| **Owner** | Baskoro Nugroho |
| **Status** | Spec for review, process by process. WMS screens are drafts; the first build is on dev |
| **Governed by** | *QC Systems: Hiryu, WMS, TMS* (ChangWen, 11 Sep 2026), `docs/canonical/qc-oms-wms.html`, for the long-term design. Where the first build needs a stopgap (no Hiryu link yet), this page says so |
| **Supersedes** | v3.3 of 28 September (kept at `docs/archive/PRD-v3.3.md`; its section numbers are in Appendix C) and every earlier version |
| **Platform** | Substrait · FastAPI · OceanBase · static frontend |
| **Live** | Dev: wms-test--dev.ninjavan.apps.substrait.build (first build, 28 Sep). Production: wms-test.ninjavan.apps.substrait.build |
| **Go-live** | **Kahf and Labore** at **MA5 Cawang** first, then **KJ5 Kemanggisan** |
| **Scale** | 10 to 30 dark stores within 6 months |

---

# Part A. Foundation

What every reader needs once: the three systems, the rules that hold everywhere, the order of going live, and the targets. Part B then has one section per process, in the order a hub meets them. Each process gives the steps in both systems (**Hiryu first**), then the rules the WMS follows, then **open points**: what is not decided or not written yet. Screens with a green Hiryu sidebar are Hiryu, redrawn from Hiryu Malaysia; the others are WMS drafts. The numbered dots on a screen match the numbered steps under it.

## 0. The pilot and its rules

### 0.1 How the pilot works

**Three systems, no link between Hiryu and the WMS yet.**

| System | Who uses it | What it does |
|---|---|---|
| **Grab** | The customer | Takes the order, pays, sends a Grab rider |
| **Hiryu** | Ops HQ, SPV and staff | Ninja's POS. Holds the Grab stores, the menu, prices and the stock number Grab shows. Receives every Grab order and prints the packing slip. Staff press *Mark ready* here |
| **WMS** | Ops HQ, SPV and staff | Knows where every unit sits: which rack, which bin. Tells the picker where to go, checks every unit by scan, counts the shelf, receives deliveries, raises restock requests to the brand |

Hiryu and the WMS do not talk to each other yet. Until they do, **people carry the information across**:

- **Orders go from Hiryu to the WMS by copy and paste.** Staff copy the Hiryu order page and paste it into the WMS (§6).
- **Stock goes from the WMS to Hiryu by typing.** The WMS lists the numbers; the SPV types them into Hiryu's Stock tab (§9).
- **Customer details never enter the WMS.** Names, phone numbers, addresses and payment stay in Hiryu.

### 0.2 Summary and scope

Ninja Van fulfils quick-commerce orders for brands from small dark stores. For **GrabMart Kilat**, Grab takes the order and sends the rider; Ninja holds the stock, picks and packs. Ninja's POS, **Hiryu**, already receives Grab orders and holds the menu. The **WMS** is the layer underneath: where a unit goes, where a picker finds it, whether it is really there, and what arrived against what the brand said it sent.

**First build** *(decided 25 Sep)*: dark stores only; brand delivers direct; Grab orders by copy and paste from Hiryu; stock back to Hiryu by the SPV typing it in; Kahf and Labore at MA5 then KJ5.

**Target design** (governing document): every order enters through Hiryu, only Hiryu talks to the WMS, only the WMS counts the shelf, in five messages (§0.6). The first build keeps that shape so the stopgaps can be switched off one by one.

### 0.3 Principles

- **0.3.1** **The WMS never talks to Grab.** Channels connect to Hiryu. In the first build a person carries orders from Hiryu to the WMS (§6.6).
- **0.3.2** **One shelf count.** The WMS ledger is the only count of the shelf. Hiryu's number is corrected from it (§9.4) until Hiryu stops keeping its own.
- **0.3.3** **Every stock movement is scanned.** Picking has a scan check with no staff override.
- **0.3.4** **The ledger is append-only.** Balances are built from movements; negative stock is refused; every scan can be retried without counting twice.
- **0.3.5** **Red means failure and nothing else.** Every state has colour, an icon and words.
- **0.3.6** **No free text on the floor.** Quantities come from steppers and keypads.
- **0.3.7** **Bahasa Indonesia by default**, English one tap away, on every string.
- **0.3.8** **Online only, and it says so.** A dropped connection blocks work visibly.
- **0.3.9** **Training never touches real stock.**
- **0.3.10** **All stock belongs to the brand** (§2.11).
- **0.3.11** **Customer data stays in Hiryu.** The WMS never receives, stores, logs or shows a customer's name, phone, address, note or payment, and no table has a field for them (§6.6.1).
- **0.3.12** **Hiryu first** *(decided 28 Sep)*. Hiryu is the interface with Grab and what the customer sees. In every step that touches both systems, the Hiryu part is done first and the WMS records it after: the dark store and logins, SKUs and the menu, *Mark ready*, cancels. The one exception is the stock number itself, which is counted in the WMS and then typed into Hiryu.

### 0.4 Going live at a new hub, in order

Before the first Grab order, these steps happen **in this order**. Each step names who does it and in which system.

| # | Who | Where | Step | See |
|---|---|---|---|---|
| 1 | Ops HQ (ADMIN) | Hiryu | Country and currency once; the dark store, its hours, the SPV's MANAGER login | §2.1.1 |
| 2 | Ops HQ | WMS | Register the same dark store and its people (SPV first) | §2.1.2, §1.3 |
| 3 | SPV | WMS | Temporary inbound bins and the quarantine tray, then the racks | §3.1, §3.2 |
| 4 | SPV | Hiryu, then WMS | Staff logins in Hiryu, then staff accounts in the WMS | §1.3.1 |
| 5 | Ops HQ | Hiryu | SKUs, then the menu, then each item connected to its SKU | §2.2.1 to §2.2.3 |
| 6 | Ops HQ | WMS | Add the brand, register each SKU with its Hiryu code, upload the Hiryu menu | §2.2.4 to §2.2.6 |
| 7 | SPV | WMS | Give each SKU a bin at the hub | §3.3 |
| 8 | SPV and staff | WMS | First delivery from the brand: restock request, AWB, receive | §4.1, §5 |
| 9 | Ops HQ | Hiryu | Create the Grab store, give it the hub and the menu | §2.4.1 to §2.4.3 |
| 10 | SPV | Hiryu | Type the opening stock | §9 |
| 11 | Ops HQ + the outlet's Grab manager login | Hiryu + Grab | Activate the store on Grab, check the menu reached Grab, test order | §2.4.4 to §2.4.6 |

**Hiryu first.** Whenever a step touches both systems, do the Hiryu part first and record it in the WMS after. Hiryu is the interface with Grab: it is what customers see.

### 0.5 Service targets and scale

| Measure | Definition | Target |
|---|---|---|
| On time | Orders packed before ready-by | **95%** |
| Pick and pack | Paste → packed | **under 5 min** |
| Ready | Order reaches Hiryu → *Mark ready* | **within 10 min** |
| Items short | Order lines with *Barang tidak ada* | **under 3%** |
| Count accuracy | Bins counted with no difference | **98%** |
| Pick accuracy | Lines picked with no wrong-product stop | 99.5% or better (tracked) |

Before the second hub goes live: every list pages and runs in one query; screens that watch live state update by push; a short scan buffer holds scans across a Wi-Fi blip.

### 0.6 Later: the Hiryu link in five messages

When the Hiryu link is built, exactly five messages cross between the two systems:

| Name | From → to | When |
|---|---|---|
| **Order to pick** | Hiryu → WMS | An order is accepted |
| **Order cancelled** | Hiryu → WMS | The customer or Grab cancels |
| **Stock update** | WMS → Hiryu | After every change: available = on the shelf minus held for orders |
| **Order ready** | WMS → Hiryu | Pack scan |
| **Item short** | WMS → Hiryu | A picker declares a missing item |

Rules for that day: whole numbers, never "plus 2"; every message safe to resend; messages queue if the other side is down; the training site sends nothing. Today the WMS works out and queues these messages but **sends none**, because the link does not exist yet.

### 0.7 Open points

- **Go or no-go for KJ5.** Which numbers must MA5 reach before KJ5 opens (on time, missing items, count accuracy from §0.5), and for how long? *Proposal:* two weeks at MA5 on target. *Decides:* Ops HQ.
- **Grab's service level** (Q13): the 10-minute ready-by is our reading of Hiryu, not a figure from Grab.

# Part B. Processes

Fifteen processes. Each starts with who does it, in which system, and what is already on dev.

## 1. Login and user access

**Who**: Ops HQ, SPV · **Systems**: Hiryu first, then the WMS · **On dev**: Google sign-in and the user list. The roles of 28 Sep (Ops Head, an SPV adds staff only): not yet

### 1.1 Signing in to Hiryu

<!--screen:hiryu-login-->

1. Choose **Indonesia**. Malaysia is a separate list of stores and users.
2. **Hub staff and the SPV** sign in with the **email and password** of their dark store's Hiryu login (made in §1.3.1). They see Live Orders, Orders, the order page and their stores' Stock tab, nothing else.
3. **Ninja office staff** (Ops HQ) use **Sign in with Google**, with a Hiryu account an Indonesia ADMIN has created (§2.1.1).

**Who holds which Hiryu role**

| Hiryu role | Given to | Can |
|---|---|---|
| **ADMIN** | Ops HQ lead (the project owner grants it) | Everything, including users, settings and *Activate on Grab* |
| **EDITOR** | Ops HQ | Stores, menus, SKUs, stock, hours, hub staff |
| **VIEWER** | Anyone who only needs to look | Read only |
| **MANAGER** (hub login) | The hub's SPV | Orders, Live Orders, typing stock, the hub's own staff logins |
| **STAFF** (hub login) | Hub staff | Orders, Live Orders, the order page |

### 1.2 Users and roles

| Role | Where | Does |
|---|---|---|
| **Staff** | Dark store floor | Receive by AWB, put away, paste Grab orders, pick, pack, hand over, count, report problems |
| **SPV** | Their own hubs | Temporary inbound bins, racks and bins, SKU to bin, the second-bin question, missing-item decisions, problem decisions, restock requests for their hubs, variance acknowledgement, count sign-off, end-of-day report, **registering staff** |
| **Ops HQ** | Every hub | **Adding brands**, SKUs, photos, stock numbers and Grab buffer, Hiryu menu and store maps, approving write-offs, variance sign-off, linking deliveries without a recorded AWB, **registering dark stores and users and assigning roles** |
| **Ops Head** | Every hub | The last signature on every write-off (§11.5). Sees everything Ops HQ sees |
| **Superadmin** | Everything | Everything Ops HQ does, granting Ops Head and superadmin, viewing the app as another role (read only) |

**Who registers whom** *(decided 25 Sep)*:

| | Register a dark store | Add a brand | Register a user | Roles they can give |
|---|---|---|---|---|
| **Superadmin** | Yes | Yes | Yes | Any, including Ops Head and superadmin |
| **Ops Head** | No | No | No | None |
| **Ops HQ** | Yes | Yes | Yes | Staff, SPV, Ops HQ |
| **SPV** | No | No | Yes, at their own hubs | Staff only |
| **Staff** | No | No | No | None |

Hiryu has its own roles (ADMIN, EDITOR, VIEWER for office staff; MANAGER and STAFF for hub logins). Who holds which is in §1.1.

- **1.2.1** The server enforces every permission; the console hides screens a role cannot use.
- **1.2.2** The *hub operator* role for the central warehouse is hidden in the first build and returns with it (§19).
- **1.2.3** **Two surfaces.** *Station* for the floor: large type, one decision per screen, a scan area that keeps focus; works on a laptop with a scanner, a tablet, or a phone (installable, camera scan, type the code). *Console* for SPV and Ops HQ: tables, filters, queues.

### 1.3 Accounts for a new person

1. **Tambah pengguna.** Enter the person's Google email (@ninjavan.co), name, role and hubs. Ops HQ can give Staff, SPV and Ops HQ. Only a superadmin can give Ops Head or superadmin.
2. **An SPV** sees only *Tambah pengguna*, and can only add **Staff** at their own hubs.

#### 1.3.1 Staff accounts in both systems

1. **Hiryu first: Dark stores → your hub → Staff → Add staff**, role **STAFF** (use MANAGER only for a deputy SPV). Give each person the temporary password Hiryu shows once.
2. **Then the WMS: Dark store & pengguna → Tambah pengguna**, role Staff, your hub.

### 1.4 Admin, access, training and security

- **1.4.1** Sign-in is Google SSO through the Substrait proxy; the app stores no passwords. Superadmin and Ops HQ see every hub; others see their own. Nobody changes their own role.
- **1.4.2** At go-live, automatic staff accounts are switched off; accounts are created as in 15.5.
- **1.4.5** **Registering** *(decided 25 and 28 Sep)*: superadmin and Ops HQ register dark stores, add brands, register users and assign roles (Ops HQ up to Ops HQ; only a superadmin grants Ops Head or superadmin). An SPV registers staff only, at their own hubs, and can deactivate them. Nobody changes their own role.
- **1.4.6** **Hiryu access** *(28 Sep)*: the project owner holds Hiryu ADMIN for Indonesia and grants it (or EDITOR, VIEWER) to Ops HQ. Hub logins (MANAGER for the SPV, STAFF for staff) are made on the dark store's Staff tab in Hiryu, by an ADMIN, an EDITOR or the hub's MANAGER. Hiryu shows a temporary password once; the person sets their own at first sign-in.
- **1.4.3** A separate training site with a banner, one-tap reset, test barcodes and a Hiryu order simulator. It never reaches real stock.
- **1.4.4** **Security**: Substrait's security team reviews the app when it is deployed and says what to fix. That replaces the earlier question of who reviews scan findings.

### 1.5 Open points

- **Hub staff without a company Google account.** The WMS signs people in with Google (§1.3). If hub staff are contract or daily workers, they may not have one. *Proposal:* check with HR and NV IT this week; if not, ask Substrait for another way to sign in before go-live. *Decides:* Ops HQ with NV IT.
- **Someone leaves.** No steps yet for closing a person's Hiryu login and WMS account on their last day, or for a forgotten Hiryu password. *Proposal:* Hiryu first, then the WMS, the same day, by the SPV; Ops HQ checks both user lists once a month.
- **The shared laptop.** Hiryu keeps one login per browser, so the next person must sign out the last one (§12.1). Nothing checks it. *Proposal:* sign-out is the last step of every shift (§13).
- **Who is the Ops Head** for the pilot, and who stands in when they are away. Every write-off, count difference and delivery difference waits for their signature.
- **Brands.** Brands sign in to neither system and receive reports (§15). Confirm, or say what a brand may see.

## 2. Registration and store setup: hub, brand, SKU, Grab store

**Who**: Ops HQ (Hiryu ADMIN or EDITOR) · **Systems**: Hiryu first, then the WMS, then Grab · **On dev**: *Menu & toko Hiryu* (menu upload, item connections, store map), 28 Sep. The brand form and the new SKU form: not yet

### 2.1 Ops HQ: register a new hub

#### 2.1.1 In Hiryu: the instance, the dark store, the SPV login

Needs a Hiryu **ADMIN** login.

1. **Once for Indonesia:** *Settings*. Check that the instance serves **Indonesia**, the currency is **IDR**, and the business day is Jakarta time (WIB). The currency can only be changed while no menu exists, so do this first.
2. **Users → Invite user** for each Ops HQ person who needs Hiryu: work email (a company Google account, no password), name, and role **EDITOR** (or VIEWER to look only).
3. **Dark stores → New dark store.** Name it as the WMS does (*Cawang*). One per physical hub.
4. **The dark store → Hours.** Set the opening hours. Every Grab store fulfilled from this hub follows them.
5. **The dark store → Staff → Add staff** for the SPV: email, name, role **MANAGER**. Hiryu shows a **temporary password once**: give it to the SPV straight away. They choose their own at first sign-in.

<!--screen:hiryu-darkstore-->

#### 2.1.2 In the WMS: the dark store

<!--screen:admin-setup-->

1. **Dark store & pengguna → Tambah dark store.** Superadmin or Ops HQ only. Enter the hub code (MA5), the name, the address, the dark store's name in Hiryu, and the hub's SPV.
2. The WMS makes the **quarantine tray** (`MA5-KARANTINA`) by itself: every hub has one, it cannot be switched off. The SPV sets up the temporary inbound bins (§3.1).

### 2.2 Ops HQ: add a brand and its products

Hiryu first, then the WMS, so the WMS can be given the Hiryu code of each SKU.

#### 2.2.1 In Hiryu: create the SKUs

<!--screen:hiryu-skus-->

1. **SKUs → New SKU.**
2. **Code**: use the brand's SKU code if it has one, otherwise a clear code of your own (`LAB-GB-MC-100`). Hiryu upper-cases it. This code is what the WMS calls **Kode SKU di Hiryu**.
3. **Name**: brand, product and size (*Labore GentleBiome Mild Cleanser 100 ml*). **Create.**

A SKU is **what sits on the shelf**. A menu item is **what the customer buys**. One SKU can be sold as a single and as a 2-pack.

#### 2.2.2 In Hiryu: build the menu

<!--screen:hiryu-menu-->

1. **Menus → New menu** (*Labore*), one menu per brand, shared by the brand's stores at every hub. Then **Add category** (*Cleanser*, *Moisturiser*).
2. **Add item** in each category: Item ID (unique in the menu; use the SKU code for a single), name with size, price in IDR, sequence, description (shoppers see it), and up to **4 photos**, square (1:1). **Add to draft.**
3. **Save menu.** Nothing reaches Grab until you save. Saving sends the menu to every store that uses it.

For many items at once: **Export CSV**, fill it in, **Import CSV**. Import **replaces the whole menu** for every store using it, so export first to keep a copy.

#### 2.2.3 In Hiryu: connect each item to its SKU

<!--screen:hiryu-bundles-->

1. On the menu, open **Bundles**.
2. For each item choose its **SKU**.
3. Set **Units per sale**: 1 for a single, 2 for a 2-pack of the same product.

**One SKU per item** does it for a whole menu of singles in one click (each item gets a SKU with the item's code). An item left as *Not counted* can be sold even when the shelf is empty, so every packaged product must be connected. The *Not counted only* filter on **SKUs** shows any you missed.

#### 2.2.4 Add the brand in the WMS

<!--screen:brand-form-->

1. **Merek → Tambah merek.** Ops HQ or superadmin. Name, short code, the brand's company.
2. **Model listing di Grab**: *Grab minta Ninja jadi 3PL* (Grab brings the brand, as for Kahf and Labore) or *Ninja daftar merchant sendiri* (Ninja lists the brand on Grab itself). The stock always belongs to the brand.
3. **Kontak restock**: who at the brand receives restock requests.
4. **Dijual di hub**: which hubs carry the brand.

#### 2.2.5 In the WMS: register each SKU with its Hiryu code

<!--screen:sku-form-->

1. **Produk → Daftarkan SKU.** Type the **Kode SKU di Hiryu** first. The WMS shows the Hiryu SKU name it matches once the menu has been uploaded (§2.2.6), so you can check you have the right one.
2. Brand, the brand's own SKU code, name, **barcode** (scan the pack; a SKU may have more than one; leave empty if the brand has none yet), and pack size and weight if known.
3. **Bin size**: the WMS suggests small (JX-2) or large (JX-4), the smallest that holds 15 units with one divider.
4. **The stock numbers.** Each has a plain name and an example on screen. The ones marked *unit or %* take either a number of units or a percentage:

| On screen | What it means | Takes | Example |
|---|---|---|---|
| **Isi sampai** | A restock fills the hub's stock up to this | Units | 15 |
| **Pesan ulang saat sisa** | When the hub's stock falls to this, the WMS drafts a restock request to the brand | Unit or % of *isi sampai* | 25% = 4 units |
| **Batas kritis** | At or below this the SKU is flagged red: nearly out | Unit or % of *isi sampai* | 1 unit |
| **Cadangan Grab** | Units kept back from what Grab may sell, in case of a miscount (§9.5) | Unit or % of what is available (rounded up) | 1 unit (the default) |
| **Isi maks. per bin** | How many units fit in one bin before the next is used. May stay empty: the WMS learns it from the SPV (§4.2) | Units | 12 |

*Isi sampai* is required. *Pesan ulang saat sisa* fills in as 25% unless you change it.

#### 2.2.6 In the WMS: upload the Hiryu menu

<!--screen:hiryu-map-->

1. In Hiryu, **Menus → the menu → Export CSV**. In the WMS, **Menu Hiryu → Unggah CSV menu**, one file per brand. Do it again every time the menu changes in Hiryu.
2. Items whose barcode matches connect by themselves at 1 unit per sale. The rest wait on **Perlu dihubungkan**: choose the WMS SKU and units per sale, the same as in Hiryu's Bundles.
3. **Hiryu stores**: enter each Hiryu store number once, with its hub and brand (after §2.4.1).

A Grab order with an unconnected item cannot be pasted, so keep *Perlu dihubungkan* empty.

### 2.3 Later: a new product, a price change, a product stopped

| Change | In Hiryu | In the WMS |
|---|---|---|
| **New product** | New SKU (§2.2.1), add the item to the menu and Save menu (§2.2.2), connect it in Bundles (§2.2.3) | Register the SKU (§2.2.5), upload the menu again (§2.2.6), SPV gives it a bin (§3.3) |
| **Price change** | Edit the item's price, Save menu, check it shows *Synced* (§2.4.5) | Nothing |
| **Stop selling a product** | Set the item to UNAVAILABLE or SOLD OUT, Save menu | Stop restock: set *Isi sampai* to 0 |
| **A pack changes** (for example a single becomes a 2-pack) | Change the item's *Units per sale* in Bundles | Upload the menu again the same day and set the same units on *Perlu dihubungkan* |

The link from a menu item to its SKU (and how many units one sale takes) is kept in **two places**: Hiryu's *Bundles* and the WMS's item list. Hiryu uses its copy to count down its stock; the WMS uses its copy to know what to pick. If one is changed and the other is not, the two counts drift apart. So every change is made in **Hiryu first, then the WMS, on the same day**, and once a month Ops HQ compares the WMS item list (*Menu Hiryu → Unduh daftar item*) with Hiryu's Bundles page.

**Tip:** Hiryu's menu file has a **barcode** column. Filling each item's barcode in Hiryu (by CSV) lets the WMS connect single items to their SKU by itself.

### 2.4 Ops HQ: link each Grab store to Hiryu

One Grab store per brand per hub: the pilot has four (Kahf and Labore at MA5 and KJ5). **Before you start** you need: the Grab store already made by Grab with the hub's address; the **outlet's Grab manager login** (from Grab or the brand); the brand's menu with SKUs connected (§2.2); stock on the shelf and in the WMS (§5).

#### 2.4.1 Create the store

**Stores → New store.** Name it exactly as customers should read it, brand and hub: *Labore - Cawang*. It starts INACTIVE with no Grab link.

#### 2.4.2 Give it the hub

**Dark stores → the hub → Stores → tick the store → Assign.** Do this **before** activating: an order for a store with no hub reaches no Live Orders board.

#### 2.4.3 Give it the menu and the opening stock

1. **The store → Overview → Menu**: choose the brand's menu.
2. **The store → Stock**: the SPV types the opening stock from the WMS (§9.3).

#### 2.4.4 Activate it on Grab

<!--screen:hiryu-store-activate-->

1. On the store's **Overview**, check the menu is set. *Start activation* stays grey until the menu has at least one saved item, because Grab rejects an empty menu.
2. Press **Start activation** (ADMIN only). Hiryu gives you a link.
3. **Open link.** Grab's own pages open:

<!--screen:grab-activate-->

4. **Sign in with the outlet's Grab manager login** (for example `labore.cawang.manager`).
5. **Choose the store** to connect (check the address is the hub's) and connect it.
6. **Enable the integration.** Grab warns that the POS menu becomes the main menu and changes made in the GrabMerchant app are cancelled. That is expected: from now on the menu, prices and stock come from Hiryu.
7. Back in Hiryu, reload the store. It reads **ACTIVE** with the **Grab merchant ID** filled in.

#### 2.4.5 Check the menu reached Grab

**Menus → the menu → Stores using this menu**: every store should read **Synced**. *Syncing…* means wait. *Not sent* shows Grab's reason; fix it and press *Retry*. A message about syncing too often means wait the minutes it says before retrying.

#### 2.4.6 Test order, then open

Place one test order on Grab for the store, run it through §6 end to end (paste, pick, pack, *Mark ready*, handover), then cancel or complete it as agreed with Grab.

### 2.5 Sites

- **2.5.1** The first build has **dark stores only**. The central warehouse site type, transfers and tote dispatch stay in the code but are hidden (§19).
- **2.5.2** **Temporary inbound bins and the quarantine tray** *(revised 28 Sep)*. The **quarantine tray** (`HUB-KARANTINA`) is made automatically when Ops HQ registers the dark store and cannot be switched off: it is the one place for units that must not be sold (damaged, leaking, expired, doubtful), so they never sit in a bin a picker can reach. The **SPV** sets up the **temporary inbound bins** (§3.1): how many and what size. The WMS gives each its own location and label, `HUB-IN-01` onwards, one SKU each, used while a delivery is counted; it names the one to use per SKU. Neither ever holds sellable stock. The number of temporary bins can change at any time; a delivery with more SKUs than temporary bins is received in batches (§5.3.2).

### 2.6 Registering a SKU **[updated 25 Sep]**

Ops HQ registers each SKU **once for every hub** (§2.2.5), **after it exists in Hiryu** *(decided 28 Sep)*: the SKU is created in Hiryu first (§2.2.1 to §2.2.3), so its Hiryu code is known and typed first in the WMS. Once the Hiryu menu is uploaded (§2.12), the WMS shows the Hiryu SKU name that matches the code, as a check.

| Field | Required | Notes |
|---|---|---|
| Brand, brand SKU code, name, size, category | Yes | The brand's own code |
| **Kode SKU di Hiryu** | Yes | The code of the matching SKU in Hiryu (Hiryu *SKUs*). Fills in with the brand code; change it only if Hiryu uses another. The stock sheet lists rows by this code so they line up with Hiryu's Stock tab *(decided 25 Sep)* |
| Hiryu menu items | Shown, not typed | From the menu upload (§2.12): each item ID that sells this SKU, and its units per sale |
| **Barcode(s)** | If the pack has one | One barcode belongs to one SKU, ever. A SKU may have several |
| Pack L × W × H mm, weight g | Optional | Drive bin size and packaging. Appendix B |
| Liquid in a bottle; large bottle (150 ml or more) | Optional | Drive the carton rule (§6.10) |
| **Bin size** | Yes | Suggested from pack size, else from category |
| **Isi maks. per bin** | Optional | Only if known from a similar SKU in the same bin size (§4.6) |
| *Isi sampai* | Yes | Units (§4.5) |
| *Pesan ulang saat sisa*, *Batas kritis* | *Pesan ulang* fills in | Units or a percentage of *Isi sampai* (§4.5) |
| *Cadangan Grab* (Grab buffer) | Optional | Units or a percentage of what is available. Default 0 (§9.5) |
| Photo | Optional | 1:1, at least 800 × 800, white background |

- **2.6.1** **Bulk import**: the SKU master sheet (Appendix B) imports as a CSV with the same columns, with a preview before anything is saved.
- **2.6.2** A SKU registered at HQ appears on every hub's *Perlu rak* list **with its bin size**. The SPV picks a free bin of that size; the WMS suggests the most comfortable height first (level 3, then 2, 4, 1, 5).
- **2.6.3** A SKU with no bin at a hub can be received there (staff are given a bin during inbound) but not picked.

### 2.7 Brands **[DECIDED 28 Sep]**

A new brand is added by **Ops HQ or a superadmin** (§2.2.4), before any of its SKUs: name, short code, company, listing model (§2.11), the brand's restock contact, which hubs carry it, and whether its packs carry barcodes. An SPV cannot add a brand.

### 2.8 Barcodes

- **2.8.1** Barcodes can be entered at registration, or bound the first time a unit arrives: staff search the product list, pick the product in their hand, and the barcode is bound for good.
- **2.8.2** An unknown product at inbound goes to Ops HQ with a photo and count (§5); it is not stock until HQ answers.
- **2.8.3** Ninja's own unit labels (for brands without barcodes) stay built but hidden. Kahf and Labore are barcoded.

### 2.9 Pack data

The WMS asks the brand for pack size and weight but must work without them. Missing data never blocks a delivery or a pick: category defaults fill in and screens show *perkiraan* (estimate).

### 2.10 Photos

Ops HQ uploads the product photo; for near-identical products the photo is what the picker checks.

### 2.11 Stock owner and listing model **[DECIDED 25 Sep]**

- **2.11.1** **All stock is owned by the brand.** Ninja owns no stock and Grab owns no stock in this operation. Every movement and balance records the brand as owner.
- **2.11.2** What differs between brands is **who lists the store on Grab**, a setting per brand:

| Listing model | Who is the merchant on Grab | Example |
|---|---|---|
| `grab_3pl` | Grab brings the brand and asks Ninja to be its 3PL | **Kahf, Labore** (pilot) |
| `ninja_merchant` | Ninja finds the brand and registers its own merchant on Grab | Malaysia today |

- **2.11.3** The listing model does not change how the floor works. It sets who receives reports and who the restock request goes through.
- **2.11.4** The old owner values *grab* and *ninja* are retired by migration.

### 2.12 Maps kept by Ops HQ

| Map | Holds | Filled by |
|---|---|---|
| Hiryu items | Hiryu item ID → SKU and units per sale | Upload of Hiryu's menu CSV (columns used: `item_id`, `item_name`, `barcode`, `available_status`); barcode matches map at 1 unit; the rest by hand |
| Hiryu stores | Store number → hub and brand | Typed once per store |
| Hiryu SKU code | On each WMS SKU (§2.6) | Typed by Ops HQ from Hiryu *SKUs*; fills in with the brand code. Compared ignoring capitals, because Hiryu upper-cases codes |
| Hiryu item prices | Item ID → price, with the date of each upload | The `price` column of the same menu CSV; used only for the sell-out value (§15.1) |

### 2.13 Open points

- **The existing Grab listings.** Kahf and Labore's Official Store listings move to the hub stores (§17, fourth round). Not written: who moves them and when, what happens to ratings and reviews, and whether the old listing closes. *Decides:* Grab with the brands.
- **Menu content.** Who supplies each item's name, description, 4 square photos and price, and who approves a price change the brand asks for. *Proposal:* the brand supplies; Ops HQ enters it in Hiryu within 2 working days.
- **Bundles.** 41 marketplace bundles were set aside at the recheck. Will any be sold on Grab as 2-packs (units per sale 2)? Decide per brand before the menu is built.
- **Store hours and holidays.** The dark store's hours in Hiryu apply to every store it fulfils (§2.1.1). The pilot's hours, and who changes them for public holidays, are not set.
- **Closing things down.** No steps for closing a Grab store, removing a menu item for good, or closing a hub.
- **Monthly item-link check** (§2.3): the WMS download *Unduh daftar item* is not built yet.

## 3. Racking setup

**Who**: SPV, Ops HQ · **Systems**: WMS · **On dev**: racks and bins with one bay. The rack picture, bays and temporary inbound bins: not yet

### 3.1 Temporary inbound bins and the quarantine tray

<!--screen:inbound-area-->

1. **Rak & bin → Area barang masuk.** Enter how many **temporary inbound bins** the hub has and their size. Each bin gets its own label: 10 bins give `MA5-IN-01` to `MA5-IN-10`. A delivery is counted into these, one SKU per bin, before it goes onto the racks. You can change the number later; a delivery with more SKUs than temporary bins is simply received in batches (§5).
2. **The quarantine tray** (*baki karantina*) is already there. It is one labelled box or crate for units that must not be sold: damaged, leaking, expired or doubtful. It keeps them out of the picker's way until you decide what happens to them (§11.2). Put it away from the picking racks.
3. **Print the labels** (A4 sticker sheets) and stick them on the temporary bins and the tray. Put the temporary bins on a shelf or pallet next to the receiving bench.

### 3.2 Build the racks

<!--screen:rack-builder-->

The rack builder is a **picture of the rack from the front, drawn to scale**. The picture above works: try it.

1. **Choose the rack type**: the 1 m catalog rack or the 206 cm long-span rack from inventory.
2. **Choose how many bays** (the sections between the uprights) **and levels.**
3. **Click a level**, then pick its bin: **small**, **large** or **empty**. One bin size per level. The picture redraws and says how many bins sit side by side and how many stack, and why.
4. **Point at any bin** to read its code. `MA5-A1-3-05T` is rack A, bay 1, level 3, position 5, top bin. Stacked bins are B (bottom), M (middle) and T (top).
5. **Save**, then print the bin labels.

### 3.3 Give each SKU a bin

When Ops HQ has registered a SKU (§2.2.5), it appears on **Rak & bin → Perlu rak** with its bin size. Pick a free bin of that size; the WMS suggests the most comfortable height first.

### 3.4 Layout is configurable **[DECIDED 25 Sep]**

A hub's layout is **racks → bays → levels → positions → stack**.

| Part | Set by | Rule |
|---|---|---|
| **Rack** | Ops HQ or SPV | A letter per hub, and a rack type (outer size, number of levels, clear width per bay) |
| **Bay** | Rack type, editable | A section between uprights. The 1 m catalog rack has 1; the 206 cm long-span can be set as 1 or 2 |
| **Level** | Per bay | Clear height, and **one bin size** per level |
| **Position** | Worked out | ⌊bay clear width ÷ bin width⌋, may be lowered |
| **Stack** | Worked out | min(⌊level clear height ÷ bin height⌋, the bin type's stack limit), may be lowered |

- **3.4.1** **Location code** `HUB-RACK BAY-LEVEL-POSITION[STACK]`, e.g. `MA5-A1-3-05T`. Stack letters: none for a single bin; B and T for two; B, M and T for three. Existing single-bay racks become bay 1 when migrated; no bin labels have been printed yet, so nothing is reprinted.
- **3.4.2** **Bin types** are a list Ops HQ keeps: code, name, outer and inner size (W × D × H mm), stack limit. Starting values:

| Bin | Outer W × D × H mm | Stack limit | Use |
|---|---|---|---|
| Small, Lion Star Jolly Box No.200 (JX-2) | 135 × 225 × 120 | 3 | Tubes, small bottles, compacts |
| Large, Lion Star Jolly Box No.400 (JX-4) | 198 × 356 × 170 | 2 | Bottles 150 ml and up, kits |

- **3.4.3** Inner bin sizes are not published: measure the first sample and correct the list.
- **3.4.4** **Stacked bins are picked from the front** (both types are open-front). The WMS draws a stack as one column, top on top.
- **3.4.5** Racks can grow: add a rack, a bay, a level, or positions. A bin, level or bay can be removed only if it has **never held stock**.
- **3.4.6** **One bin holds one SKU.** Dividers inside a bin separate deliveries (§5.4), never SKUs.
- **3.4.7** **The rack builder is a picture first** *(decided 25 Sep)*: a front view to scale, levels chosen by clicking them, a bin size chosen with one tap, and the numbers shown with their reason in plain words (§3.2). A table of the same numbers is there for Ops HQ, below the picture.

### 3.5 Hub map (Ops HQ)

Every hub in one table: bins used and free, SKUs without a bin, units held, SKUs low, out, or without a reorder number, deliveries on the way, open variances, open problems. Clicking a hub opens its layout map, one square per bin, coloured by stock or by availability.

### 3.6 Open points

- **The real racks.** Which racks, how many bays and levels, and a floor plan of MA5 and KJ5, are not written. The SPV needs them before building the racks in the WMS.
- **Printing labels.** Bin labels and temporary bin labels are printed on A4 sticker sheets (§3.1), but no sheet printer is in the device list (§12.1). *Proposal:* print at the office and bring them to the hub.
- **Where each SKU goes.** The WMS suggests a height, but there is no grouping rule. *Proposal:* keep each brand together, fast movers at levels 2 to 4 nearest the pack bench.
- **Moving a SKU to another bin** (damaged bin, better place): only the second-bin answer *Pindah bin* covers it today. Steps are not written.

## 4. Replenishment and thresholds

**Who**: SPV, Ops HQ · **Systems**: WMS, plus WhatsApp or email to the brand · **On dev**: restock requests, variance sign-off, reminders. *Catat pengiriman* fields, units or %, learned bin max: not yet

### 4.1 Restock from the brand, and recording the AWB

1. **Pengingat** shows a **restock draft** when a SKU falls to its *pesan ulang saat sisa* number. The WMS collects every SKU that needs it into one draft per brand for your hub.
2. **Restock ke merek → the draft.** Check the quantities (they fill up to *isi sampai*), change any that need it, add a SKU by hand if needed.
3. **Salin teks** and send it to the brand's restock contact by WhatsApp or email, then press **Tandai terkirim**. The quantities freeze.
4. When the brand replies with the shipment, open the request and press **Catat pengiriman**:

<!--screen:restock-awb-->

5. Enter the **AWB number**, the **Surat Jalan number**, the expected arrival date, and **how many of each SKU the brand is really sending** (it may be fewer than you asked).
6. **Simpan pengiriman.** Staff can now receive the delivery by that AWB (§5.1). You can correct these details until the goods arrive.

If goods arrive before you record the AWB, staff start §5.2 and you or Ops HQ link the AWB there.

### 4.2 The second-bin question

<!--screen:second-bin-->

Whenever a SKU gets a second bin at a hub, whether a staffer tapped *Bin penuh* or you added it on *Rak & bin*, the WMS asks why.

1. Choose the reason. **Bin pertama penuh** is the one that matters.
2. If full: the WMS proposes the number now in the first bin as the **isi maks. per bin** for that SKU in that bin size. It applies to this hub, and to every other hub that has no number yet. Ops HQ can change it.
3. Other reasons (promo delivery, bin moved, undo) set nothing.

### 4.3 One route in the first build **[DECIDED 25 Sep]**

**Brand → dark store**, direct. Supplier to central warehouse to dark store, and crossdock, are later builds (§19).

### 4.4 Restock request to the brand **[built 17 Sep]**

The stock is on consignment: the brand owns it until it sells. Ninja raises the restock request and gives the brand the consignment form. Ops HQ runs it for every hub; the SPV for their own hubs.

| Step | Who | What happens |
|---|---|---|
| **Alert** | WMS | A SKU at a hub falls to its *pesan ulang saat sisa* number (all its bins together). It appears on *Needs restock* with a suggested quantity up to *isi sampai* |
| **Draft** | WMS, then Ops HQ or SPV | The WMS drafts one request per hub and brand by itself; a person checks and adjusts it |
| **Sent** | Ops HQ or SPV | The request text is copied and sent to the brand outside the WMS (WhatsApp or email) and marked sent. Quantities freeze |
| **Confirmed** | Ops HQ or SPV | Records the brand's AWB, Surat Jalan number, arrival date and the quantity the brand will really send |
| **Received** | Staff | Received by AWB (§5). If everything matches, the request closes and those numbers are billed |
| **Variance** | SPV, then Ops HQ, then Ops Head | Differences: the SPV enters the final count and a reason; Ops HQ approves; the Ops Head signs. The signed number is billed |

- **4.4.1** Reference `RPL-<hub>-<yymm>-<n>`. One AWB belongs to one open request.
- **4.4.1a** **Recording the shipment** *(28 Sep)*: on the request, **Catat pengiriman** takes the AWB, the Surat Jalan number, the expected arrival date and the quantity per SKU the brand is really sending (§4.1). The SPV or Ops HQ can correct it until the goods arrive.
- **4.4.2** **A delivery whose AWB is not recorded** *(decided 25 Sep)* is not turned away. Staff enter the AWB from the Surat Jalan, a photo of it, the brand and the number of cartons; Ops HQ is flagged at once. Staff count the units into the temporary bins while the driver is there; they are not stock. Ops HQ then links the AWB to an open restock request, records it as an unplanned delivery from the Surat Jalan, or rejects it (goods back to the brand). Only after that can the units be put away (§5.2).
- **4.4.3** The SPV, Ops HQ and Ops Head steps of a variance are three different people *(decided 28 Sep)*.
- **4.4.4** Still to agree with the brands (through Grab): safety stock, how often to restock, expiry and slow-mover returns, and a restock fee separate from the 5% fulfilment fee. They become settings (§4.8), not a rebuild.

### 4.5 The numbers per SKU per hub **[renamed 25 Sep]**

The screens use plain Indonesian names with a one-line example under each field (§2.2.5). The letters R, P and S stay only in the code and database.

| On screen | English | Code | Measured on | Takes | What it does |
|---|---|---|---|---|---|
| **Isi maks. per bin** | Bin max | `full` | One bin | Units | New stock moves on to the next bin |
| **Pesan ulang saat sisa** | Reorder at | `R` | All the SKU's bins | Units or % of *isi sampai* | Drafts a restock request to the brand |
| **Isi sampai** | Fill up to | `P` | All the SKU's bins | Units | What a restock fills up to |
| **Batas kritis** | Critical level | `S` | All the SKU's bins | Units or % of *isi sampai* | A red flag: nearly out. Must be *pesan ulang* or lower |
| **Cadangan Grab** | Grab buffer | `buffer` | Per SKU | Units or % of available | Units kept back from Grab (§9.5) |

- **4.5.1** The WMS refuses settings that cannot work (reorder below zero, critical above reorder, bin max of zero).
- **4.5.2** *Pesan ulang saat sisa* fills in as 25% of *Isi sampai* (a setting).
- **4.5.3** **Units or a percentage** *(decided 28 Sep)*. Each field marked *units or %* has a unit switch next to it. A percentage is stored as a percentage, so it follows when *isi sampai* (or what is available) changes, and the screen shows what it means in units right beside it. Percentages turn into units by rounding up; *pesan ulang saat sisa* is never less than 1 unit.

### 4.6 Isi maks. per bin is learned **[DECIDED 25 Sep]**

Bin sizes and pack sizes differ, so how many units fill a bin cannot be known for every SKU at launch.

- **4.6.1** **Stored per SKU × bin size**, shared by all hubs, with an optional value per hub that overrides it.
- **4.6.2** **At registration** Ops HQ may copy it from a similar SKU in the same bin size. Otherwise it stays empty.
- **4.6.3** **Learned from the SPV.** Whenever a SKU gets a second bin at a hub, by *Bin penuh* (§5.3.4) or by the SPV on *Rak & bin*, the WMS asks the SPV why:

| Answer | Effect |
|---|---|
| **First bin is full** | Full = the units now in the first bin. Saved for this hub; also saved for all hubs if the SKU × bin size has no shared number yet |
| Much more stock than usual arrived (promo) | Second bin kept, no bin max set |
| Moved bin (damaged bin, better place) | Stock moves, no bin max set |
| Undo | The second bin is released once empty |

- **4.6.4** If a hub's learned number differs from the shared number by more than 20%, Ops HQ gets a flag to choose which one stands.
- **4.6.5** Ops HQ can set or change any bin max at any time on the hub map.

### 4.7 Reminders and flags **[built 21 Sep]**

| Flag | Level | Default |
|---|---|---|
| Out of stock, or at or below *batas kritis* | Critical | on |
| **Delivery with an AWB not recorded** (to Ops HQ) | Critical | on, then every 2 h *(new)* |
| Restock draft waiting to be sent | Info | on |
| Draft not sent after N hours | Action | 4 h |
| Brand has not confirmed after N hours | Action | 24 h |
| Delivery N days past its date | Action | 1 day |
| Variance waiting after N hours | Action | 24 h |
| Unknown product waiting for HQ after N hours | Action | 24 h |
| SKU without a bin N days after registration | Action | 2 days |
| **Second-bin question unanswered after N hours** | Action | 4 h *(new)* |
| **Unit in quarantine without a decision** | Action | 24 h to the SPV, 7 days to Ops HQ *(new)* |
| **Missing item waiting for the SPV after N minutes** | Critical | 3 min *(new)* |
| **Bag ready, not collected after N minutes** | Action | 20 min *(new)* |
| **Stock not typed into Hiryu N hours after a change** | Action | 2 h *(new)* |
| Slow mover: not picked for N days | Info | off, 30 days |

### 4.8 Settings instead of rebuilds

Every number above, the Grab buffer rule (§9.5) and the packaging limits (§6.10) are settings Ops HQ changes on *Aturan pengingat*, so terms still open with the brands become settings, not code.

### 4.9 Open points

- **Opening quantities.** *Isi sampai* and *pesan ulang saat sisa* are not set for any of the 105 SKUs, so the first request to each brand has no numbers. *Proposal:* 15 units per SKU (one bin) and 25%, then adjust every week from sales. *Decides:* Ops HQ with the brands.
- **Consignment terms** (Q5): restock frequency, lead time, minimum order, safety stock, restock fee. They become settings once agreed (§4.8).
- **Chasing the brand.** Flags exist for a brand that has not confirmed (24 h) or a late delivery (1 day), but who chases the brand, and how, is not written.
- **Transport cost** of a restock delivery: the brand or Ninja.

## 5. Inbound and putaway

**Who**: staff, SPV · **Systems**: WMS · **On dev**: receive by AWB in batches, putaway list. ED per batch and a delivery without a recorded AWB: not yet

### 5.1 Receive a delivery

The brand delivers straight to the hub with a Surat Jalan.

1. **Barang masuk → scan or type the AWB** on the Surat Jalan. The WMS shows what the brand said it sent.
2. Scan each unit. The WMS names a **temporary inbound bin** for each SKU (`MA5-IN-01`, `MA5-IN-02` and so on) and shows *cocok*, *kurang N* or *lebih N* per SKU while you scan.
3. **Expiry date (ED).** When you scan the first unit of each SKU, the WMS asks for the **ED printed on the pack**: month and year. If the brand's Surat Jalan already lists it, the WMS shows it: just check it. No date on the pack, or you cannot read it: *Tidak ada ED*. Two dates for one SKU in the same delivery: add the second date and scan those units under it. Write the ED on the white divider as today.
4. When the temporary bins are full, finish this batch and put it away before counting the rest (*Selesai batch ini*).
5. **Put away**: take each SKU from its temporary bin to the rack bin on screen.

<!--screen:putaway-full-->

6. **If the rack bin is full, tap Bin penuh.** The WMS gives you an empty bin of the same size, as near as possible. Put the rest there.
7. The SPV is then asked whether the first bin was really full (§4.2). You do not wait for the answer.
8. **Finish.** *Semua barang AWB sudah diterima* when everything is in. Differences go to the SPV.

An unknown barcode: search the product list by name and pick the one in your hand. Not on the list: photograph it, count it, send it to Ops HQ, and leave it in its temporary bin.

### 5.2 If the AWB is not in the WMS

<!--screen:inbound-noawb-->

1. The WMS says *AWB ini belum dicatat Ops HQ*. Do not send the driver away.
2. Photograph the Surat Jalan, choose the brand, enter the number of cartons, and press **Kirim ke Ops HQ, lalu hitung**. Ops HQ gets a flag at once.
3. **Count while the driver is still there**: scan each unit into the temporary bin the WMS names. Sign the Surat Jalan for the cartons received. The counted units are **not stock yet**.
4. When Ops HQ has linked the AWB, **Taruh di rak** appears and you put away as in §5.1. If Ops HQ rejects the delivery, the goods stay in the temporary bins until they go back to the brand.

### 5.3 Inbound rules

- **5.3.1** **Inbound starts from the AWB** or the RPL reference (§4.4). The receipt opens with the brand's confirmed quantities and compares per SKU while scanning.
- **5.3.2** **Batches.** One temporary bin holds one SKU; a hub's number of temporary bins is set on *Rak & bin*. One AWB can be received in several batches.
- **5.3.3** **Where each unit goes.** New stock goes to the SKU's first bin until it holds its **isi maks. per bin**, then to the next bin. With **no number** yet, everything goes to the first bin until staff tap **Bin penuh** (§5).
- **5.3.4** **Bin penuh** during putaway: the WMS offers the nearest free bin of the SKU's bin size at that hub, registers it as the SKU's next bin, and raises the second-bin question to the SPV (§4.6). Staff do not wait.
- **5.3.5** **Sellable from the putaway scan.** Nothing waits for a signature. The SKU appears on the stock sheet for Hiryu (§9.4).
- **5.3.6** **Putaway list.** A frozen record of what went where, the day colour and the 24-hour claim deadline; the SPV signs it for compliance.
- **5.3.7** **24 hours.** Differences against the brand must be raised within 24 hours of receipt; after that the hub bears the loss.

### 5.4 Day colours and FIFO

Each delivery goes behind its own coloured divider in the bin; the colour is the week of delivery, with the date written on the white divider. The WMS does not track dividers. It sends the picker to the bin holding the stock that **expires first** (or, with no expiry date, the oldest stock), and the screen says *ambil dari sekat paling lama*.

### 5.5 Expiry dates at receiving **[DECIDED 28 Sep]**

- **5.5.1** **Where the date comes from.** The brand is asked to list the ED (expiry date) of each SKU on the Surat Jalan; the SPV or Ops HQ types it into *Catat pengiriman* (§4.1). Otherwise staff read it off the pack when they scan the first unit of each SKU at receiving (§5.1). Month and year are enough; *Tidak ada ED* is allowed.
- **5.5.2** **Stored per batch**: a batch is one SKU in one delivery with one ED. A delivery with two EDs for a SKU is two batches. Balances keep the batch, so the WMS knows which bin holds which date.
- **5.5.3** **Used for**: sending the picker to the earliest ED first; the ED shown on putaway, pick and count screens; and a flag **ED dekat** a set number of days before expiry (default 90 days, a setting until the consignment terms say otherwise), so the SPV can ask the brand to take it back.
- **5.5.4** The ED is still written on the white divider in the bin.

### 5.6 Open points

- **Receiving hours.** When brands may deliver, and who receives when the SPV is off.
- **Minimum shelf life at receiving.** No rule yet for refusing units that expire soon (for example less than 6 months left). It ties to the *ED dekat* flag (90 days, §5.5.3), Q5 and Q15.
- **Damage found at receiving.** The 24-hour claim rule is there (§5.3.7), but not the staff steps: photo, count it as short, and where the unit goes.
- **The first, large delivery** is accepted as a known risk (§17). A time estimate per 100 units would help plan staff for the first day.

## 6. Pick and pack

**Who**: the packer at the laptop, the picker with the phone · **Systems**: Hiryu first, then the WMS · **On dev**: *Tempel pesanan Grab* (screen 20), guided pick, 10-minute ready-by, 28 Sep. The pack rule and the scheduled lane: not yet

### 6.1 Copy the order from Hiryu

About 20 seconds of copying, then the pick. Hiryu counts an order **late after 10 minutes**, so the aim is *Mark ready* within **10 minutes** of the order arriving.

<!--screen:hiryu-copy-->

1. Hiryu plays the new-order sound and prints the packing slip. Open the order. If it shows **Accept** (the store is on manual acceptance), press **Accept** first. **Leave Raw payload closed**: its button must read *Show*.
2. Click once on the title **Order GM-…**. It is plain text, so clicking it does nothing in Hiryu. Do not click near the buttons.
3. Press **Ctrl + A**, then **Ctrl + C**.

### 6.2 Paste it into the WMS

<!--screen:paste-->

1. In the WMS open **Tempel pesanan Grab**, click the grey box and press **Ctrl + V**.
2. Check the GM number matches the slip and the green tick shows. The tick means the lines and units match Hiryu's count.
3. Press **Mulai ambil**.

| The WMS says | Do this |
|---|---|
| *Salinan tidak lengkap* | Go back to Hiryu, click the title, Ctrl + A, Ctrl + C again |
| *Tutup "Raw payload" dulu* | In Hiryu press *Hide* on Raw payload, copy again |
| *Barang belum dihubungkan* | Tell the SPV. Ops HQ connects the item (§2.2.6), then paste again |
| *Pesanan sudah ada* | It was pasted before; the WMS opens its pick |
| *Toko ini milik hub lain* | Wrong hub. Tell the SPV |
| *Tekan Accept di Hiryu dulu* | The store is on manual acceptance and the order is not accepted yet. Press **Accept** in Hiryu, then copy again |
| *Pesanan terjadwal* | A scheduled order. It is queued for its time; pick it when the WMS moves it to the top |

### 6.3 Pick

<!--screen:pick-->

1. Go to the bin on screen. Rack and level are highlighted.
2. Take the number shown, from the **oldest divider** first.
3. **Scan every unit.** A wrong product stops the pick; put it back and take the right one. If the wrong product was sitting in this bin, tap *Barang ini salah tempat*.
4. Not there, or not enough: **Barang tidak ada** (§8.1).

### 6.4 Pack

<!--screen:pack-->

1. When every unit is scanned, take the pack the WMS names: **paper bag** or **carton**. If it really does not fit, *Ganti kemasan* and choose a reason.
2. Pack it. Put the Hiryu slip in or on the pack with the GM number showing.
3. **Hiryu first**: press **Mark ready** for the same GM number. Hiryu tells Grab the bag is ready and takes the units off its own stock count. (Hiryu will add a photo of the packed bag; when it does, take it there, before *Mark ready*. The WMS keeps no photos.)
4. **Then the WMS**: tap **Sudah Mark ready di Hiryu**. The slip is Grab's design and has no code to scan, so this tap is the WMS's record that the order is packed. Put the bag on the ready shelf.

### 6.5 Orders

- **6.5.1** **One channel in the first build: GrabMart Kilat.** An order reaches the WMS by paste (§6.6). WhatsApp orders are a later build (§19).
- **6.5.2** Every order carries its Grab order ID (the key), the GM number (for people), the Hiryu store, the hub, and **ready-by = the Hiryu order time + 10 minutes** *(changed 28 Sep)*: Hiryu counts an order late after 10 minutes, and Grab's own estimate in the Malaysia data was about 7 minutes. Grab's real service level is to be confirmed (Q13).
- **6.5.2a** **Scheduled orders.** Hiryu shows a *Scheduled time* on scheduled orders. The WMS reads it; ready-by = scheduled time minus a lead time Ops HQ sets (default 20 minutes) until Grab confirms what the scheduled time means. The order waits in a *Terjadwal* lane and rises to the top at its time.
- **6.5.2b** **Acceptance follows Hiryu.** Hiryu shows *Acceptance: AUTO* or *MANUAL* on the order. On a MANUAL store, a pasted order still showing RECEIVED is refused with *Tekan Accept di Hiryu dulu*, so the WMS never starts an order Hiryu has not accepted.
- **6.5.3** **Stock is held for an order as soon as it is pasted**, so two orders can never be given the last unit. Held means the units stay on the shelf but are no longer free for another order.
- **6.5.4** **Pick queue**: three lanes (waiting, being picked, done today), sorted by time left before ready-by, not by age. A picker who holds an order too long is flagged; the SPV can release it.
- **6.5.5** **Grab's own stock behaviour** *(confirmed 25 Sep)*: Grab lowers the stock it shows as soon as an order is placed, and **does not put it back when the order is cancelled**. So after a cancel, Grab shows fewer units than the hub has until the SPV types the stock in again. The WMS marks those SKUs as changed on the stock sheet.

### 6.6 Now: orders by copy and paste **[DECIDED 21 Sep, first build]**

Two ways in, one reader, one endpoint:

| | Paste the order page | One-click button |
|---|---|---|
| Staff do | Copy the whole Hiryu order page, paste in the WMS (§6.1, §6.2) | Click **Kirim ke WMS** in the bookmarks bar with the Hiryu order open |
| Build | **First** | After paste is live, and after a heads-up to Shaun and NV security |
| Touches Hiryu? | No | Reads the visible page only, like a copy |

#### 6.6.1 Customer data stays in Hiryu

- The pasted text is **read in the browser** and never sent. The page takes out only the fields in 13.2.2, sends those, and clears the box whether the paste worked or not.
- The server accepts those fields and nothing else; unknown fields are refused and every text field has a strict pattern.
- **Raw payload is refused**: a paste containing Hiryu's raw data (which holds the customer's name and contact) is thrown away with *Tutup "Raw payload" dulu, lalu salin ulang*.
- Staff names and emails from Hiryu's History card are ignored. Prices and totals are ignored.

#### 6.6.2 What the reader takes

Grab order ID; GM number; Hiryu status; Hiryu store number; order time; Hiryu's own *N lines · M units*; per line the quantity, the Hiryu item ID, and the out-of-stock choice (replace, remove, cancel, contact) with the replacement item and quantity.

- **Also read**: *Acceptance* (AUTO or MANUAL, §6.5.2b) and *Scheduled time* when there is one (§6.5.2a).
- **Customer notes are thrown away.** The Items card can show a customer's note under a line; the reader never takes it as an item name and never sends it.
- **Item IDs are matched against the item map, not recognised by their prefix**, so it does not matter what prefix Indonesian item IDs use.
- **The key is the Grab order ID, never the GM number.** GM numbers repeat (Malaysia already has two different GM-482).
- **Check**: lines found and units summed must equal Hiryu's *N lines · M units*, or nothing is sent.
- **Build against real pastes**: before building, collect 10 pastes from Malaysia (several statuses, bundles, both out-of-stock types, a cancel) with customer data removed by hand. If Hiryu's page changes, the reader refuses clearly and never guesses.

#### 6.6.3 What a paste does

| Hiryu status in the paste | WMS |
|---|---|
| RECEIVED, ACCEPTED | New order: hold stock, queue, start the guided pick. Units per SKU = quantity × units per sale |
| Same order again, still open | Opens the existing pick |
| CANCELLED, REJECTED, FAILED | Shows the same confirmation as the *Dibatalkan di Hiryu* button (§8.4) |
| DRIVER_ALLOCATED or later, never pasted | Refused; the SPV uses *Catat pesanan terlewat* if it was really handed over |
| Store of another hub | Refused, naming the right hub |

Endpoint `POST /api/hiryu/paste`, open to staff and up at that hub; records who pasted, when, and whether by paste or button.

#### 6.6.4 The one-click button, later

A bookmark named **Kirim ke WMS** in the packing PC's normal Chrome profile (not the kiosk-printing one). It reads the visible text of the open Hiryu order page, runs the same reader, and opens the WMS paste screen filled in, waiting for *Mulai ambil*. It calls nothing in Hiryu and reads no login.

### 6.7 Guided pick

- **6.7.1** The picker is sent to **one bin at a time**, in walking order, with the bin code, the product photo and the number to take.
- **6.7.2** **Each unit is scanned.** A wrong product stops the pick with both products side by side. No override.
- **6.7.3** Picking several orders at once is not in the first build. It pays only above about 15 orders an hour per picker; the pilot plans about 7 a day per hub.

### 6.8 Where the picker is sent

The picker goes to whichever of the SKU's bins holds the **oldest stock**. There is no task to move stock from one bin to another; the picker simply follows the oldest.

### 6.9 Packing rules

- **6.9.1** The WMS names the pack before the pick starts (§6.10). The packer can change it in two taps with a reason from a list.
- **6.9.2** **There is no label to scan** *(25 Sep; order changed 28 Sep)*. The Hiryu packing slip is Grab's design and carries no code the WMS can read, so the pick scans are the check. When the order is packed, staff press *Mark ready* in **Hiryu first**, then tap **Sudah Mark ready di Hiryu** in the WMS, which marks the order **packed and ready** (§0.3.12).

### 6.10 Packaging rule

*Updated 25 September.*

**Two packs only: a paper bag and a carton.** No ziplock, no bubble wrap in the logic.

| Pack | Inner size | Usable volume | Max load (assumed) |
|---|---|---|---|
| Paper bag, kraft 70 gsm with handles (Berkah PBG15) | 18 × 10 × 33 cm | 18 × 10 × 27 cm × 80% = **3.9 L** | **3.0 kg** |
| Carton, single wall (Maxellpack CCM-36) | 25 × 20 × 10 cm | 25 × 20 × 10 cm × 80% = **4.0 L** | **5.0 kg** |

#### 6.10.1 The rule

For each order the WMS adds up:

- **V** = the sum of units × pack volume;
- **G** = the sum of units × weight;
- **L** = the longest pack in the order;
- **N** = how many large bottles (150 ml or more).

1. **Paper bag** if V ≤ 3.9 L, G ≤ 3.0 kg, L ≤ 27 cm and N < 2.
2. Otherwise **carton** if V ≤ 4.0 L, G ≤ 5.0 kg and L ≤ 25 cm.
3. Otherwise **two packs**: the WMS splits the lines, heavy and large items into the carton first, and marks the order *2 kemasan*.

#### 6.10.2 Why these numbers

Grab has no bag or carton spec, so every number is an assumption to test:

- **Usable volume.** The bag loses 6 cm at the top to fold it shut. Both packs are counted at 80% full, because rigid boxes and bottles never fill a space completely; about a fifth stays air.
- **Paper bag 3.0 kg.** Small kraft bags with twisted handles are usually sold as carrying 3 to 5 kg. We take the bottom of that range because the bag also swings in a rider's box.
- **Carton 5.0 kg.** A single-wall carton this size carries far more than that. The limit is what the bottom tape and a rider's box handle comfortably.
- **Two large bottles means a carton.** Two heavy bottles in a paper bag press on one spot, tear the bottom and crush the small items beside them. In the earlier order simulation this sent about 13% of orders to a carton.
- **Longest item.** A bag takes items up to its folded height (27 cm) standing; the carton up to its length (25 cm).

When pack data is missing: volume from the SKU list estimate; weight = content (ml or g) × 1.0 plus 20% for the pack (plastic) or 60% (glass); category default if neither is known. The suggestion then shows *perkiraan*.

#### 6.10.3 Test before go-live, then set

1. Fill a bag to 3.0 kg with real products (for example 2 Labore 225 ml cleansers and the rest small tubes).
2. Lift it by the handles, shake it 10 times, hang it for a minute, drop it from 30 cm onto a hard floor.
3. If it holds, try 4.0 kg the same way. The limit becomes the last weight that passed, minus 20%.
4. Do the same for the carton, then set both limits on *Aturan pengingat*. Every change of pack by a packer (with its reason) is counted weekly, so a limit that is wrong shows up.

### 6.11 Order states in the WMS

| State | Set by |
|---|---|
| Waiting | Paste |
| Being picked | Picker claims it |
| Packed and ready | *Sudah Mark ready di Hiryu*, tapped after pressing *Mark ready* in Hiryu |
| Collected | Staff tap *Sudah diambil driver* |
| Cancelled | *Dibatalkan di Hiryu* button |

### 6.12 Open points

- **Pack limits** after the load test (Q8, §6.10.3).
- **Closing the pack.** How a bag or carton is closed (staple, tape, seal sticker), where the Hiryu slip goes, and that both packs of a two-pack order carry the GM number.
- **The customer's out-of-stock choice.** The paste reader takes it (§6.6.2), but a missing item always cancels the order (§8.3). Keep reading it, or drop it?
- **Scheduled orders** (Q13): what *Scheduled time* means. The *Terjadwal* lane is not built yet.
- **Bags and cartons used** per order are known from the pack rule; stock of them is in §12.

## 7. Handover to Grab

**Who**: whoever takes the bag down · **Systems**: WMS; Hiryu updates by itself · **On dev**: *Kemas & serah ke driver* (screen 21), 28 Sep

### 7.1 Hand over to the Grab driver

<!--screen:handover-->

1. **Serah ke driver** lists the bags waiting. Amber means waiting more than 20 minutes.
2. Ask the driver for the order number. When it matches the GM number on the slip, tap **Ya, sudah diambil driver**. Hiryu updates by itself when Grab sees the pickup.

If Hiryu shows the order as cancelled, do not hand it over: press **Dibatalkan di Hiryu** on the order (§8.2) and unpack.

### 7.2 Handover rules **[DECIDED 25 Sep]**

- **7.2.1** Packed orders wait on the **ready shelf**. *Serah ke driver* lists them with how long they have waited.
- **7.2.2** When the driver arrives, staff match the order number the driver gives with the GM number on the slip and tap **Sudah diambil driver**. The WMS records who handed over and when. The order is **done** in the WMS.
- **7.2.3** A bag waiting more than 20 minutes (setting) is amber and flags the SPV.
- **7.2.4** No photo is stored in the WMS: the packing slip on the bag can show the customer's name (§0.3.11). A photo of the packed bag, as proof against disputes, is planned **in Hiryu** *(28 Sep)*; staff take it there, before *Mark ready*, once it exists.

### 7.3 Open points

- **The driver does not come.** After the 20-minute flag the SPV checks Hiryu. If the order is still active, what next: call Grab merchant support, keep waiting, or ask for a new driver?
- **Proof from the driver.** What staff accept when the driver has no order number, or asks for the wrong one.
- **One person on duty** carrying a bag downstairs leaves the laptop alone while orders arrive. *Proposal:* accept it for the pilot; pause the hub when two orders go *Late* (§13.2).
- **Proof photo in Hiryu** (Q14): no date yet.

## 8. Cancellations and returns

**Who**: staff, SPV · **Systems**: Hiryu first, then the WMS · **On dev**: *Dibatalkan di Hiryu*, a missing item with the cancel step, return to shelf, 28 Sep. Driver returns, the return note, returns to the brand: not yet

### 8.1 An item is missing or short

When an item is missing, **the whole order is cancelled**. Grab does not allow an order to be changed, so Hiryu cannot send part of an order, and a replacement cannot be recorded either.

<!--screen:short-->

1. **Barang tidak ada**, then say what you found: *Tidak ada sama sekali*, or set the number with − and +.
2. The WMS stops the order and shows **anywhere else the SKU might be**: a second bin, a temporary inbound bin waiting for putaway. Look there. Found it: **Ketemu, lanjut ambil**.
3. Still missing: **call the SPV**. The SPV cancels **in Hiryu first**: *Cancel order* with reason **2001 Item out of stock**. Then the SPV taps **Sudah dibatalkan di Hiryu** on your screen.
4. Anything already picked goes back to its bin (*Kembalikan ke rak*).
5. The SPV types that SKU's stock into Hiryu straight away (§9.2), so Grab stops selling it.

### 8.2 A cancelled order

<!--screen:cancel-->

1. When Hiryu shows an order as **CANCELLED**, open it in the WMS (from the queue, the pick, the pack or the handover list) and press **Dibatalkan di Hiryu**.
2. Check the GM number and confirm.
3. Anything already picked goes to **Kembalikan ke rak**: scan each unit back into its bin. Unpack a packed bag first.
4. Tell the SPV: Hiryu does not put a cancelled order's units back into its stock, so the SPV types that SKU's stock again (§9).

A cancel pressed by mistake: the SPV can reopen the order.

### 8.3 When an item is missing **[DECIDED 28 Sep]**

Grab does not allow an order to be changed, so Hiryu cannot send part of an order or record a replacement. **A missing item cancels the whole order**, with reason **2001 Item out of stock**.

1. The picker taps **Barang tidak ada** and says how many were found: none, or a number set with − and +.
2. The WMS **stops the order** and lists any other place the SKU is recorded at this hub (another bin, a temporary inbound bin not yet put away). If the picker finds it there: **Ketemu, lanjut ambil**, and the pick goes on.
3. Otherwise the SPV cancels in **Hiryu first** (*Cancel order*, reason 2001), then taps **Sudah dibatalkan di Hiryu** in the WMS. The WMS lets go of the order; picked units go back to the rack.
4. The SPV types the SKU's stock into Hiryu straight away (§9.2).

At the moment of *Barang tidak ada* the WMS also:

- **sets the bin's count to what was found**, so no other order is sent to an empty bin;
- **puts the SKU on the stock sheet** and on the next spot count (§10.1);
- **tells the SPV**, naming the picker.

A picker may lower stock without the SPV here, because waiting means Grab keeps selling a product the hub does not have. To stop misuse, the SPV sees every declaration with the picker's name.

Because every missing item costs a whole order and a mark against the store's rating, **prevention matters most**: the Grab buffer (§9.5), typing stock at every trigger (§9.2), and counts (§10.1).

### 8.4 Cancellation **[DECIDED 25 Sep]**

A cancel is **one button**, not a paste. When Hiryu shows an order as cancelled, staff press **Dibatalkan di Hiryu** on the order in the WMS (queue, pick, pack or handover) and confirm the GM number. The WMS lets go of the hold; units already picked go to **Kembalikan ke rak**, where any staff member scans each unit back into its bin and each scan puts it back in stock. A packed bag is unpacked first. The press is logged with the staffer's name; the SPV can reopen an order cancelled by mistake. The end-of-day order check (§13.4) catches a cancel nobody pressed.

### 8.5 Order problems

| Problem | What the WMS does | Who acts |
|---|---|---|
| Paste refused (unmapped item) | Item goes to HQ's *Perlu dipetakan*; the order waits | Ops HQ maps it; staff paste again |
| Order in Hiryu, never pasted | Shows on the end-of-day order check | SPV. If it was already handed over, the SPV pastes it with **Catat pesanan terlewat**: the WMS takes the stock off without a pick and marks it unscanned |
| Cancel nobody pressed | Shows on the order check | SPV presses *Dibatalkan di Hiryu*; picked units go back to the shelf |
| Bag not collected | Amber after 20 min, flag to SPV | SPV checks Hiryu; if cancelled, unpack |
| Driver returns an undelivered order | *Kembalian dari driver*: find the order by GM number, scan each unit good or damaged | Staff, then SPV |

### 8.6 Return note **[DECIDED 28 Sep]**

Units going back to the brand leave with a **return note** (*Surat Jalan retur*) printed from the WMS: reference `RTN-<hub>-<yymm>-<n>`, brand, hub, date, and per line the SKU, quantity, reason and ED. Staff scan each unit out against it; the brand's driver and the SPV sign two copies; the SPV uploads a photo of the signed copy to the return in the WMS (it holds no customer data). The returned units leave the ledger at the scan.

### 8.7 Open points

- **The driver brings an order back** (§8.5): the row is in the table, but there are no staff steps and no screen (*Kembalian dari driver*). Who bears a damaged return is Q6.
- **Returns to the brand.** The return note is decided (§8.6), but not when returns happen (only with the next delivery, or a set day), who books the brand's pickup, or how slow movers and near-expiry units are chosen (Q5).
- **Recall.** No steps for a recall by the brand or BPOM: find every unit of the batch by ED, stop selling, quarantine, return.
- **Moving stock between MA5 and KJ5.** Hub-to-hub transfers are built but hidden. Does the pilot need them, for example when one hub runs short and the other is full?
- **Cost of a missing-item cancel.** Grab may charge the merchant. Who bears it (Ninja when the count was wrong, the brand when its delivery was short) is not written.

## 9. Daily stock update to Hiryu

**Who**: the SPV · **Systems**: WMS, then Hiryu, then the WMS · **On dev**: *Stok untuk Hiryu*, 28 Sep. The 2-hour flag: not yet

### 9.1 How the numbers move

| Where | Who changes it | When it changes |
|---|---|---|
| **WMS** (the real count) | Staff scans | Every putaway, pick, count, return and problem report |
| **Hiryu** (Units on hand) | **Only the SPV**, by typing | When the SPV types; and Hiryu takes units off by itself when an order is **marked ready**. It never puts back a cancelled order's units |
| **Grab** (what customers see) | Hiryu | Every time the SPV saves stock in Hiryu. Grab also lowers its own number as soon as an order is placed, and does not raise it again if the order is cancelled |

So Grab is only as right as the last time the SPV typed. **Only the SPV types stock into Hiryu**, because the SPV answers for the dark store. Ops HQ does not, except as a stand-in the SPV names.

### 9.2 When to type stock into Hiryu

| Moment | Which SKUs |
|---|---|
| **Opening**, before the store opens on Grab | All (tinted rows) |
| **After a delivery is put away** | The SKUs in the delivery |
| **After every cancelled order** | The SKUs in that order |
| **After a missing item** (§8.1) | That SKU, straight away |
| **After a count is signed** | The SKUs counted |
| **After a quarantine decision** (back to the rack, write-off) | That SKU |
| **Midday**, at 13:00 | All tinted rows |
| **End of day** | All tinted rows, after the order check (§13.3) |

The WMS flags any SKU whose number changed and was not typed within 2 hours.

### 9.3 How to type

<!--screen:eod-->

1. **Pick a quiet moment if you can.** In Hiryu **Live Orders**, *Pending accept* and *Pending packing* both at **0** is best: then Grab shows the right number at once. If you cannot wait, type anyway: the WMS number already allows for orders in progress, so Hiryu ends up right once they are marked ready.

<!--screen:hiryu-live-->

2. For each store (two per hub in the pilot): in Hiryu open *Stores → the store → Stock*. For each tinted row in the WMS tab *Stok untuk Hiryu*, find the same **Kode SKU di Hiryu** (printed under the SKU name in Hiryu) and type the WMS number from **Ketik di Hiryu** into **Units on hand**. Press **Save stock** in Hiryu.

<!--screen:hiryu-stock-->

3. **Then the WMS**: tap **Sudah disimpan di Hiryu**.

Never use Hiryu's **Arrived** column: it adds to the count, and the WMS number already includes the delivery.

### 9.4 Now: stock by typing **[DECIDED 25 Sep, first build]**

- **9.4.1** *Stok untuk Hiryu*, one table per Hiryu store: **Kode SKU di Hiryu**, name, WMS available, Grab buffer, **Ketik di Hiryu**, last value typed, and a changed mark. Sorted by the Hiryu SKU code, like Hiryu's Stock tab, so the two screens line up.
- **9.4.2** **Ketik di Hiryu = units on the shelf + units already picked for orders not yet marked ready − Grab buffer, never below 0** *(changed 28 Sep)*. Hiryu will still take off every order that is not yet marked ready, so this number is right whenever it is typed; orders not yet pasted are still on the shelf and are taken off by Hiryu later. Units in quarantine or temporary inbound bins are not on the shelf.
- **9.4.3** A row is marked changed when its number differs from the last value typed, and always after a cancel of that SKU (Grab does not restore its count, §6.5.5).
- **9.4.4** **Only the hub's SPV types stock** *(decided 28 Sep)*, because the SPV answers for the dark store; Ops HQ only as a stand-in the SPV names. The SPV types the changed rows into Hiryu's *Units on hand*, saves in Hiryu, then taps **Sudah disimpan di Hiryu**; the WMS records each value as typed. When to type is in §9.2.
- **9.4.5** **Quiet moment preferred** *(confirmed 28 Sep)*: Hiryu takes stock off when an order is marked ready, and never puts back a cancelled order's units. With 0 *Pending accept* and 0 *Pending packing*, Grab shows the right number at once; while orders are in progress, Grab briefly shows those units too, until they are marked ready. After every cancel, the SKUs in it are typed again.
- **9.4.6** Never Hiryu's *Arrived* column (*Add to stock*): it adds to Hiryu's count.

### 9.5 Grab buffer (cadangan Grab) **[DECIDED 25 and 28 Sep]**

**What it is**: a few units of each SKU that we do not show to Grab. If the WMS says 5, Grab is told 4. The spare unit covers a miscount, a damaged unit nobody has reported yet, or an order that lands before the SPV types. Without it, a unit that turns out not to be there means a missing item, and a missing item cancels the whole order (§8.3).

**Decided**: **1 unit per SKU by default** from go-live. Ops HQ can set any SKU to 0, another number, or a percentage of what is available (§4.5.3). Ninja sets it, as the stock planner for its own dark stores.

**Side effect**: Hiryu's *Units on hand* is lower than the real count by the buffer, so **reports always come from the WMS**, never from Hiryu. **How it is applied** *(28 Sep)*: Hiryu has no buffer setting today (none in its current screens), so the buffer is not a Hiryu feature. It is applied **by the WMS**: the *Ketik di Hiryu* number on the stock sheet already has it taken off, and the SPV types that number into Hiryu as usual (§9.4). No extra step for anyone. If Hiryu adds a buffer setting later (Q16), the number moves there.

### 9.6 Open points

- **The SPV is away.** Only the SPV types stock; a stand-in is "named by the SPV" (§9.4.4), but nothing records who. *Proposal:* the SPV names a stand-in in the WMS for a date range.
- **Typing time.** 105 SKUs across two stores takes a while at opening. Does Hiryu's Stock tab take a CSV upload? *Ask:* the Hiryu team.
- **Opening stock on go-live day** follows §0.4 steps 8 to 11. The exact timing (typed after the first delivery is put away, before activation) belongs in the go-live plan.

## 10. Stock opname

**Who**: staff count; SPV, Ops HQ and Ops Head sign · **Systems**: WMS, then Hiryu · **On dev**: blind count, recount, one sign-off. The three-step approval and the count plan: not yet

### 10.1 When to count

| Count | Which SKUs | How often | Who |
|---|---|---|---|
| **Cycle count** | The top 20% of SKUs by units sold | Every week | Staff count, SPV checks |
| **Cycle count** | All other SKUs | Every month | Staff count, SPV checks |
| **Spot count** | A SKU with a missing item, a found unit, or a quarantine report | The next day | Staff count, SPV checks |
| **Full count** | Every SKU at the hub | Last day of each month, before the sell-out report to the brand | Staff count, SPV and Ops HQ check |

A difference found in a count needs **SPV, then Ops HQ, then Ops Head** before the WMS changes the stock. Units found **missing** are taken out of what can be sold at once while the approval runs, so Grab stops selling them. Units found **extra** are added only after the Ops Head signs. After the Ops Head signs, type the SKUs into Hiryu (§9.2).

### 10.2 Stock count **[DECIDED 28 Sep]**

- **10.2.1** **Cadence** (§10.1): the top 20% of SKUs by units sold over four weeks are counted weekly, the rest monthly; new SKUs count as top until they have history. A **spot count** the next day for any SKU with a missing item, a found unit or a quarantine report. A **full count** of every SKU on the last day of each month, before the sell-out report.
- **10.2.2** **How**: the staffer picks a bin, it is locked to them, they scan every unit. The system number stays hidden. Any difference flags; the staffer recounts once before the number is shown.
- **10.2.3** **Approval**: a difference needs the **SPV, then Ops HQ, then the Ops Head**, three different people, before the stock changes. Units found **missing** are taken out of what can be sold as soon as the count is submitted, so Grab stops selling them while the approval runs; units found **extra** are added only after the Ops Head signs.
- **10.2.4** After the last signature the SKUs go on the stock sheet for the SPV to type into Hiryu (§9.4).

### 10.3 Open points

- **Counting while open.** Are counts done with the store open (each bin locked while counted) or before opening? The month-end full count may need a hub pause.
- **The brand at month end.** The stock is on consignment: does the brand witness or sign the month-end count that the sell-out report uses?
- **Time and assignment.** When in the day counts happen, and who gives out the bins to count.
- **A first count** right after the first delivery, before go-live. *Proposal:* yes, a full count.

## 11. Claims, quarantine and exceptions

**Who**: anyone reports; the SPV decides; Ops HQ and the Ops Head approve write-offs · **Systems**: WMS · **On dev**: not yet

### 11.1 Report a problem

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
3. **Taruh di MA5-KARANTINA.** Put the units in the quarantine tray. They leave sellable stock straight away and wait for the SPV (§11.2). *Salah tempat* and *Barang ditemukan* skip the tray: the WMS names the right bin.

### 11.2 Problems and quarantine

<!--screen:exceptions-->

**Who does what**: anyone reports and puts the unit in the tray; the **SPV decides**; **staff** do the physical move. A **write-off** also needs **Ops HQ** to approve and the **Ops Head** to sign, every time.

1. **Tanggungan** shows who bears the cost under the reason chosen (§11.6). Change the reason if the report was wrong.
2. Decide each report within 24 hours:

| Decision | Approvals | What happens next | Sellable again |
|---|---|---|---|
| **Kembali ke rak** | SPV | A task *Kembalikan dari karantina* appears for staff: take the unit from the tray, scan it, put it in the bin the WMS names, scan the bin | When the bin is scanned |
| **Retur ke merek** | SPV | The unit stays in the tray marked *Menunggu retur* and goes back with the brand's next delivery; staff scan it out against the **return note** the WMS prints (*Surat Jalan retur*), which the brand's driver signs | No, it leaves the hub |
| **Hapus stok** (write off) | SPV proposes, Ops HQ approves, Ops Head signs | After the Ops Head signs, staff scan it out as disposed | No |

3. Anything in the tray more than 24 hours without a decision is flagged to you; more than 7 days, to Ops HQ.

<!--screen:karantina-task-->

### 11.3 One path for every stock problem

1. **Report.** Anyone taps *Laporkan masalah*, picks the reason, the product and the number, adds a photo if possible (§11.1).
2. **Quarantine.** Units leave sellable stock straight away into `KARANTINA` (a tray per hub), except *salah tempat* and *ditemukan*, which go straight to the right bin.
3. **Decide.** The SPV decides within 24 hours: **back to stock**, **write off**, or **return to the brand**.
4. **Approve.** A write-off is proposed by the SPV, approved by Ops HQ and signed by the Ops Head, every time, whatever its size.
5. **Review.** Ops HQ sees write-offs by reason, SKU, hub and person each month; returns to the brand go on the brand's next return list with the Surat Jalan.

### 11.4 Quarantine, step by step **[DECIDED 25 Sep]**

| Step | Who | What | Stock |
|---|---|---|---|
| 1. Report | Anyone | *Laporkan masalah*, reason, product, number, photo; units go into `HUB-KARANTINA` | Leaves sellable stock at once |
| 2. Decide | SPV, within 24 h | Back to the rack, return to the brand, or write off | Unchanged |
| 3a. Back to the rack | Staff, by a task | *Kembalikan dari karantina*: take from the tray, scan the unit, scan the bin the WMS names | Sellable again at the bin scan |
| 3b. Return to the brand | Staff, when the brand's driver comes | The unit waits in the tray as *Menunggu retur*; staff scan it out against the return note (§8.6), the return note the driver signs | Leaves the hub |
| 3c. Write off | SPV proposes, Ops HQ approves, Ops Head signs, then staff | Staff scan it out as disposed | Leaves the ledger |

Nothing moves back from quarantine by the SPV's click alone: the unit counts as stock again only when a staffer scans it into a bin. A decision not taken in 24 hours flags the SPV; not taken in 7 days, Ops HQ.

### 11.5 Approvals **[DECIDED 28 Sep]**

There are **no write-off limits**. Every write-off, whatever its size, needs three people in this order: the **SPV** proposes it, **Ops HQ** approves it, the **Ops Head** signs it. Each step is a different person, and each can send it back with a note. Until the Ops Head signs, the unit stays in quarantine. *Back to the rack* and *return to the brand* stay the SPV's decision.

### 11.6 Reasons and who bears the cost

| Reason | When found | Goes to | Cost borne by |
|---|---|---|---|
| Arrived damaged, short or wrong | At receiving, within 24 h | Delivery variance (§4.4) | Brand |
| Damaged in the hub | Any time | Quarantine | Ninja |
| Faulty pack (leak, seal) with no handling cause | Any time | Quarantine | Brand |
| Expired or too close to sell | Pick, count, putaway | Quarantine, return to brand | Brand (terms to confirm) |
| Wrong place | Pick, count | Moved to its own bin | Nobody |
| Found | Anywhere | Back to stock after SPV check; reverses an earlier short if there was one | Nobody |
| Lost | Count sign-off, or short never found | Written off at count sign-off | Ninja |
| Returned by the driver, intact | Handover desk | Back to shelf, unit by unit | Nobody |
| Returned by the driver, damaged | Handover desk | Quarantine | To confirm with Grab |

### 11.7 Open points

- **Claims to the brand and to Grab.** The WMS records who bears a cost (§11.6), but not the claim itself: how a claim to the brand (arrived damaged, short, faulty pack) or to Grab (damaged in delivery, Q6) is raised, with what evidence, by when, and how it is settled. Settlement is outside the WMS (§20).
- **Disposal.** How written-off cosmetics are disposed of, and whether a brand wants them back instead.
- **Photo rules** for a report: what must show, and never the packing slip (customer name).
- **Near expiry.** The flag comes 90 days before the ED (§5.5.3). What the SPV does then depends on Q5.

## 12. Consumables and infrastructure

**Who**: SPV, Ops HQ, procurement · **Systems**: mostly outside the WMS · **On dev**: nothing

### 12.1 Devices and who works where

The pilot hubs pick and pack on the **2nd floor** and hand over at a **table downstairs**. Each device has one job, and **every person signs in with their own account** on whatever device they use (their own Hiryu login and their own WMS Google login). They sign in at the start of the shift and sign out at the end.

<!--screen:hub-devices-->

| Device | Where | Used for | Who |
|---|---|---|---|
| **Packing laptop** (in the kit) with the **receipt printer** | Pack bench, upstairs | Hiryu Live Orders with automatic slip printing, copy and paste into the WMS, *Mark ready*, the SPV's stock typing | The packer on shift; the SPV for stock |
| **Hub phone** with the WMS installed, plus the kit's **wireless 2D scanner** paired to it | Carried | Picking, putaway, receiving, counting, *Laporkan masalah* | The picker on shift |
| **Second hub phone** (or tablet) | Handover table, downstairs | *Serah ke driver*, the ready shelf | Whoever brings the bag down |

- **One laptop, many people.** The laptop keeps the printer set up whoever signs in, because Hiryu saves the printer per browser, not per person. Only the person at the laptop is signed in; the next person signs out the last one and signs in as themselves.
- **Two people on duty** (the 5-minute target): one picks with the phone, one pastes, packs and marks ready at the laptop. The one who packs carries the bag down. **One person on duty**: they do both, in the same order.
- **The ready shelf is downstairs**, next to the handover table, so a driver never waits for someone on the stairs.
- **Wi-Fi must reach both floors.** The hub phone's mobile data is the backup internet (§14).
- **For procurement:** the kit has one laptop and one scanner per hub. This plan adds **two Android phones per hub** (picking and handover), each with a lanyard or holder and a charger. The procurement session should pick these up; the procurement files are not changed here.

### 12.2 Open points

- **Consumables.** Paper bags, cartons, tape, receipt rolls, A4 label sheets, day-colour stickers, dividers, bins (JX-2, JX-4), the quarantine tray and paper log forms. Not written: how many each hub holds, who reorders, where they are kept. *Proposal:* a minimum per item per hub, checked in the SPV's weekly routine; the WMS can count bags and cartons used from the pack rule.
- **Infrastructure check before go-live.** Wi-Fi on both floors, power points at the pack bench and the handover table, a UPS or not, printer and scanner charging, racks installed.
- **Device care.** Who owns the phones, overnight charging, screen lock, and what to do with a lost or broken device.
- **Procurement** runs in its own session; the two phones per hub (§12.1) are added there.

## 13. Shift routine

**Who**: the SPV · **Systems**: Hiryu and the WMS · **On dev**: the stock tab only. The end-of-day report: not yet

### 13.1 During the shift: what the SPV watches

- **A missing item** (§8.1): go to the picker and check the other places the WMS lists. If it is really gone, cancel **in Hiryu first** (*Cancel order*, reason 2001), then tap *Sudah dibatalkan di Hiryu*. Then type that SKU's stock into Hiryu.
- **Pengingat**: restock drafts to send, deliveries past their date, variances to acknowledge, deliveries waiting for Ops HQ.
- **Serah ke driver**: a bag amber for 20 minutes or more. Check the order in Hiryu; if Grab cancelled it, press *Dibatalkan di Hiryu* and have it unpacked.

### 13.2 Pause the hub on Grab

**Pause this hub on Grab** is on Hiryu's dark store page. It stops new orders at **every store the hub fulfils** (Kahf and Labore together) for 30 minutes, 1 hour or 24 hours. Orders already placed carry on, and Grab resumes by itself when the time is up.

| Pause when | For how long |
|---|---|
| Orders are coming faster than the hub can pack: two or more orders *Late* on Live Orders | 30 minutes |
| The WMS or the internet is down for more than 15 minutes (§14) | 1 hour, then check again |
| Not enough people on shift, or an emergency at the hub (power, flood, safety) | 1 hour or 24 hours |

1. **Hiryu first**: *Dark stores → the hub → Pause this hub on Grab*, choose the time, **Pause**. The SPV does this (or Ops HQ if the SPV cannot).
2. **Then the WMS**: note the pause and its reason on the end-of-day report (*Masalah hari ini*).
3. A pause for **one brand only** is not possible here. To stop one brand, set its SKUs to 0 in the stock typing (§9) instead.

### 13.3 End of day

1. **Order check.** In Hiryu open **Orders**, set *Dark store* to this hub and *From* and *To* to today. Click the title *Orders*, press Ctrl + A, Ctrl + C, and paste into the WMS tab *Cek pesanan*. Fix every row the WMS lists: an order never pasted, a cancel nobody pressed, or an order the WMS has and Hiryu does not.

<!--screen:hiryu-orders-->

2. **Type the stock** (§9.3).
3. Decide any problem still open, note any hub pause, or leave a note for tomorrow's SPV.

### 13.4 End-of-day report **[DECIDED 25 Sep]**

One screen per hub, **Laporan akhir hari**, for the SPV to close the day in Hiryu:

| Tab | Holds |
|---|---|
| **Stok untuk Hiryu** | §9.4, every SKU, changed rows first |
| **Cek pesanan** | Paste Hiryu's order list for the day (it holds no customer data; the WMS keeps Grab order IDs, GM numbers, stores and statuses only). Three lists: in Hiryu not in the WMS; cancelled in Hiryu, open in the WMS; in the WMS not in Hiryu |
| **Masalah hari ini** | Reports, decisions, anything still open |
| **Penjualan** | Units sold per SKU today; feeds the monthly sell-out report (§15.1) |

Downloadable as CSV. The same *Stok untuk Hiryu* tab is used at opening and after each delivery.

### 13.5 Open points

- **Opening checklist.** Not written: sign in, devices charged, printer paper, check *Pengingat* and the quarantine tray, type the opening stock (§9.2), then open.
- **Hours and shifts** for the pilot, and the handover between shifts or between SPVs.
- **Breaks with one person on duty**: pause the hub or not.
- **The SPV's week and month.** Tasks are spread across sections (printed bin list on Monday §14.1, cycle counts §10.1, consumables §12, item-link check §2.3). One calendar would help.

## 14. Downtime and contingency

**Who**: everyone on shift, SPV, Ops HQ · **Systems**: paper, then the WMS · **On dev**: not yet (printed bin list, paper log, *Catat pesanan terlewat*)

### 14.1 When a system is down

| What is down | You notice | Do this |
|---|---|---|
| **The WMS**, less than 15 minutes | The WMS will not load or shows *Tidak terhubung* | Keep taking orders. Pick from the **printed bin list** at the pack bench (every SKU with its bin, printed every Monday and after any rack change). Write each order on the **paper log** (GM number, SKU, quantity, bin). No scanning |
| **The WMS**, more than 15 minutes | Still down | **Pause the hub** on Grab for 1 hour (§13.2). Finish the orders already in, from the paper log. Tell Ops HQ |
| **Internet at the hub** | Neither Hiryu nor the WMS loads | Switch the laptop to the **hub phone's mobile data**. If that fails too, call Ops HQ: they pause the hub from the office |
| **Hiryu** | Hiryu will not load; no new orders | Nothing to pick. Call Ops HQ, who contacts the Hiryu team |
| **Power** | Laptop on battery, printer off | Write the GM number on each bag by hand. Keep going on battery; pause the hub if power does not return within 30 minutes |
| **Receipt printer** | No slip | Write the GM number on the bag; order new rolls or report the printer |

**When the WMS is back:**

1. Paste every order from the paper log with **Catat pesanan terlewat**: the WMS takes the stock off without a pick scan and marks it *unscanned*.
2. Paste any cancels, press *Dibatalkan di Hiryu*.
3. **Spot count** every bin written on the paper log (§10.1).
4. Type the stock into Hiryu (§9.3).

### 14.2 Open points

- **Contact list** at the pack bench: who to call for Hiryu, Grab merchant support, Ops HQ on duty and IT, with numbers.
- **Paper tools.** The printed bin list, the paper log form and *Catat pesanan terlewat* are not built; the paper log needs a template.
- **Problems on Grab's side** (Grab stops sending orders, the menu will not sync) are not covered.

## 15. Reporting to the brand

**Who**: Ops HQ · **Systems**: WMS · **On dev**: Hiryu prices are stored at each menu upload. The report itself: not yet

### 15.1 Monthly sell-out report to the brand **[DECIDED 28 Sep]**

Ninja sends each brand a monthly report: units sold and units left per SKU, per hub, with sales value. Units come from the WMS. **The value uses Hiryu's own price**, the price customers paid on Grab: each menu upload (§2.12) stores every item's price with the date, and each sold line is valued at its item's price on the day of the order (a 2-pack at the 2-pack price). The WMS still takes no money from orders (§0.3.11); the price comes from the menu, not the order. The *Penjualan* tab of the end-of-day report (§13.4) builds it day by day; Ops HQ downloads a month as CSV. *Units left* comes from the full count on the last day of the month (§10.1).

### 15.2 Open points

- **Who receives it.** For Kahf and Labore (Grab's 3PL model), does the report go to the brand, to Grab, or both (§2.11.3)?
- **When and how.** Day of the month, format (CSV or PDF), who sends it, and how long the brand has to question it.
- **Other reports** a brand may expect: weekly stock on hand, near-expiry list, write-offs and returns, delivery differences. Not decided.
- **Billing.** Units sold drive what is billed. Settlement is outside the WMS (§20), but the report must match what finance uses.

---

# Part C. Status and decisions

## 16. Build status

As of 29 September 2026. **Dev** = deployed to wms-test--dev for testing (first build, 28 Sep). **Built** = in the app from earlier builds. Nothing here is on production yet.

| Process | On dev or built | Not yet |
|---|---|---|
| 1. Login and user access | Google sign-in, user list | Ops Head role; an SPV adds staff only |
| 2. Registration and store setup | Dev: *Menu & toko Hiryu* (menu CSV upload, item connections, store map, prices kept) | Brand form; SKU form with the Hiryu code first, units or %, bin size; SKU master import |
| 3. Racking setup | Racks and bins, one bay; hub map | Rack picture, bays, stacks from bin size; temporary inbound bins; quarantine tray as a location |
| 4. Replenishment and thresholds | Restock requests, variance sign-off, reminders, auto draft | *Catat pengiriman* fields; units or %; learned bin max and the second-bin question; three-step variance |
| 5. Inbound and putaway | Receive by AWB in batches, putaway list, unknown product to HQ | ED per batch; delivery without a recorded AWB |
| 6. Pick and pack | Dev: paste (screen 20), guided pick, 10-minute ready-by, GM number on pick screens | Pack rule; *Terjadwal* lane |
| 7. Handover to Grab | Dev: *Kemas & serah ke driver* (screen 21) | |
| 8. Cancellations and returns | Dev: *Dibatalkan di Hiryu*, missing item (look elsewhere, then cancel), return to shelf, reopen (SPV) | Driver returns; return note; returns to the brand |
| 9. Daily stock update | Dev: *Stok untuk Hiryu* | 2-hour flag |
| 10. Stock opname | Blind count, recount, sign-off | Count plan; three-step approval |
| 11. Claims and quarantine | | Everything in §11 |
| 12. Consumables and infrastructure | | Outside the WMS for now |
| 13. Shift routine | | End-of-day report (*Cek pesanan*, *Masalah hari ini*, *Penjualan*) |
| 14. Downtime | | Printed bin list, paper log, *Catat pesanan terlewat* |
| 15. Reporting to the brand | Prices stored at each menu upload | Monthly sell-out report |

**Next deploys to dev**: (2) registration and roles, the brand form, the SKU form; (3) quarantine and approvals, expiry per batch, the rack picture, packaging, the end-of-day report. The one-click button comes after paste has run in the hubs.

## 17. Decisions

| Topic | Decision |
|---|---|
| Central warehouse (Logos) | Not in the first build |
| Rack layout | Configurable racks, bays, levels, positions; stack from bin size (§3.4) |
| Handover | The WMS records the Grab driver pickup (§7.2) |
| Stock back to Hiryu | The WMS lists it; the SPV types it (§9.4, §13.4) |
| Go-live brands | Kahf and Labore; 105 SKUs after the recheck (Appendix B) |
| Stock owner | Always the brand; listing model per brand (§2.11) |
| SKU registration | Includes barcodes, bin size, optional pack data and bin max (§2.6) |
| Bin max (isi maks. per bin) | Learned from the SPV's second-bin answer (§4.6) |
| Short pick | Rewritten in plain words (§8.3) |
| Packaging | Paper bag and carton only; rule and assumptions explained (§6.10) |
| Malaysia PRD | Not merged for now |
| Grab stock | Lowers on order, not restored on cancel (§6.5.5) |
| Rider dispatch | Out of scope for the WMS |
| Grab buffer | Set by Ninja (§9.5) |
| WhatsApp | A later build inside the WMS, after launch (§19) |
| Restocking | Brand direct to dark store; central warehouse and crossdock later |
| Exceptions | Designed (§11) |
| Security | Substrait security review at deploy |
| Pack data | Asked from the brands, not required (Appendix B) |

**Second round, 25 September**

| Topic | Decision |
|---|---|
| Registering | Superadmin and Ops HQ register dark stores and users and assign roles; an SPV registers staff only (§1.2) |
| Rack builder | A picture to scale, not a table, so an SPV can decide by looking (§3.2) |
| Hiryu SKU code | A field on the SKU, used by the stock sheet (§2.6) |
| Stock numbers | Plain names with examples: isi maks. per bin, pesan ulang saat sisa, isi sampai, batas kritis, cadangan Grab (§4.5) |
| Delivery without a recorded AWB | Staff enter it and count; Ops HQ is flagged and links it (§4.4.2) |
| Temporary inbound bins | Set up with the dark store, as non-sellable locations (§2.5.2) |
| Packing | No label to scan: the Hiryu slip is Grab's design. *Mark ready* in Hiryu first, then *Sudah Mark ready di Hiryu* in the WMS (§6.9) |
| Missing item | Flagged until Grab says: cancel all, or send what we have. SPV decides meanwhile (§8.3). *Replaced 28 Sep: a missing item cancels the whole order* |
| Cancelled order | One button, *Dibatalkan di Hiryu* (§8.4) |
| Quarantine | SPV decides, staff move it by a scanned task, stock returns at the bin scan (§11.4) |

**Third round, 28 September**

| Topic | Decision |
|---|---|
| One document | Part A now covers Hiryu too: setup, SKUs, menu, linking to Grab, typing stock (§0.4 to §2.4, §9) |
| Temporary inbound bins | Set up by the SPV; one label per bin (§3.1) |
| Quarantine tray | Made automatically for every hub; cannot be switched off (§2.5.2) |
| Who registers | Ops HQ registers the hub and its people; the SPV sets up the inbound area and adds staff |
| Brands | Added by Ops HQ or a superadmin (§2.7) |
| Stock numbers | Units or a percentage (§4.5.3) |
| SKU order of work | Hiryu first, then the WMS with the Hiryu code (§2.2) |
| Recording a restock AWB | SPV or Ops HQ, on the request: *Catat pengiriman* (§4.1) |
| Write-offs | No limits. SPV, then Ops HQ, then Ops Head, every time (§11.5) |
| Hiryu stock | Taken off at Mark ready, never put back after a cancel; type stock when nothing is pending (§9.4.5) |
| Hiryu order edits | Not possible; missing item defaults to cancel with 2001 until Grab answers (§8.3) |
| Hiryu access in Indonesia | The project owner grants ADMIN and EDITOR (§1.4.6) |
| Hiryu first | In every step that touches both systems, Hiryu first, then the WMS (§0.3.12) |

**Fourth round, 28 September**

| Topic | Decision |
|---|---|
| Ready-by | 10 minutes from the order reaching Hiryu (§6.5.2) |
| Missing item | Grab does not allow order changes: a missing item cancels the whole order, reason 2001 (§8.3) |
| Devices | One laptop at the pack bench, a hub phone with the scanner for picking, a phone at the handover table; everyone uses their own login (§12.1) |
| First delivery | Received through the normal inbound flow in batches: accepted as a known risk, since inbound is designed for running hubs |
| Existing Grab stores | Kahf and Labore Official Store listings will be migrated by Grab or the brand to the hub stores |
| System down | §14 |
| Scheduled orders | Ready-by from the scheduled time (§6.5.2a) |
| Manual acceptance | The WMS follows Hiryu: press Accept in Hiryu first (§6.5.2b) |
| Hub pause | Added to the SPV's steps (§13.2) |
| Stock SOP | When to type, how, when to count (§9) |
| Proof photo | Will be taken in Hiryu (§7.2.4) |
| Item links | Kept in Hiryu and the WMS; changed Hiryu first, same day, checked monthly (§2.3) |
| Sell-out value | Hiryu item price (§15.1) |
| Return note | Printed from the WMS (§8.6) |
| Expiry | Recorded per batch at receiving (§5.5) |
| Customer notes | Thrown away by the paste reader (§6.6.2) |
| Logins | Every person uses their own account on any device (§12.1) |
| Grab buffer | 1 unit per SKU by default (§9.5) |
| Who types stock | Only the SPV (§9.4.4) |
| SKU code case | Compared ignoring capitals (§2.12) |
| Counts and delivery differences | SPV, then Ops HQ, then Ops Head (§4.4, §10.2.3) |

**Split orders**, explained: one customer order filled from **two dark stores** (or two parts sent separately) because neither hub has every item. It needs two riders for one small basket, so it costs more than it earns. The WMS does not split orders; for Grab it never arises, because a Grab order belongs to one store and so to one hub.

**Fifth round, 29 September**

| Topic | Decision |
|---|---|
| Document | Arranged by process: Part A foundation, Part B fifteen processes, Part C status and decisions. Each process ends with its open points |
| Store setup | Hiryu and Grab store setup sits with hub, brand and SKU registration (§2) |
| Stock leaving the hub | Returns to the brand, recalls and hub-to-hub moves sit with cancellations and returns (§8) |
| Training | Not a process of its own |

## 18. Open questions

| # | Question | Who |
|---|---|---|
| ~~Q1~~ | **Answered 28 Sep**: Hiryu takes stock off when an order is marked ready (packed) and cannot put back a cancelled order's units (§9.4.5) | |
| ~~Q2~~ | **Answered 28 Sep**: Grab does not allow order changes, so a missing item cancels the whole order (§8.3) | |
| ~~Q3~~ | **Answered 28 Sep**: a hub staff login can open the order page (Hiryu's own page rules). The item ID prefix does not matter (§6.6.2) | |
| Q4 | **In plain words**: instead of copy and paste, a bookmark button in Chrome could read the open Hiryu order and fill the WMS paste screen in one click. It runs a small script on the Hiryu page. Do NV IT and security allow that on the hub's packing PC? | NV IT and security |
| Q5 | Consignment terms with Kahf and Labore: safety stock, restock frequency, expiry and slow-mover returns, restock fee | Grab, Paragon |
| Q6 | Who bears a unit damaged in delivery and returned by the driver? | Grab |
| Q7 | Will Paragon give barcodes, pack sizes and weights (Appendix B)? | Grab, Paragon |
| Q8 | Bag and carton limits after the load test (§6.10.3) | Ops |
| Q9 | Inner sizes of JX-2 and JX-4 from the first samples (§3.4.3) | Ops |
| ~~Q10~~ | **Answered 28 Sep**: Grab does not allow order changes, so a missing item cancels the whole order with reason 2001 (§8.3) | |
| ~~Q11~~ | **Answered 28 Sep**: the project owner can grant Hiryu ADMIN in Indonesia (§1.4.6) | |
| ~~Q12~~ | **Answered 28 Sep**: yes, counts and delivery differences also go SPV, then Ops HQ, then Ops Head | |
| Q13 | What service level does Grab hold the hub to (minutes from order to ready), and what does *Scheduled time* mean on a scheduled order (§6.5.2)? | Grab |
| Q14 | When will Hiryu's proof-of-packing photo be ready (§7.2.4)? | Hiryu team |
| Q15 | Can Paragon list the ED per SKU on each Surat Jalan (§5.5)? | Grab, Paragon |
| Q16 | The design document says Hiryu has a Grab buffer setting, but the current Hiryu shows none. Will Hiryu get one? Until then the WMS applies the buffer (§9.5) | Shaun |

## 19. Later builds

| Build | When | Note |
|---|---|---|
| **One-click button** | After paste is live | §6.6.4 |
| **Hiryu link (five messages)** | When Hiryu's team takes it on | Replaces paste and the stock sheet; the maps stay |
| **WhatsApp orders** | After the WMS is launched and stable | Self-contained inside the WMS first; may move behind Hiryu later. The simulator is built |
| **Central warehouse** (Logos) | Later | Supplier to warehouse to dark store, transfers, tote dispatch, the hub operator role |
| **Crossdock** | With the central warehouse | Staging with a dwell limit |
| **Expiry dates** | Moved into the first build (§5.5) | |
| **Merge with the Malaysia PRD** | Not now | |

## 20. Not doing

| Not doing | Why |
|---|---|
| Any link to Grab | Only Hiryu talks to Grab |
| Rider dispatch | Grab assigns its riders; Ninja's own fleet is outside the WMS |
| Split orders | See §17 |
| Customer data | Not needed to pick or pack, and a risk if held (§0.3.11) |
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
| **Grab buffer** | *Cadangan Grab*: units per SKU not shown to Grab, so a miscount does not become a cancelled order. Default 1 unit (§9.5) |
| **ED** | Expiry date printed on the pack; recorded per batch at receiving (§5.5) |
| **Return note** | *Surat Jalan retur*, printed from the WMS for units going back to the brand (§8.6) |
| **Bay** | A section of a rack between uprights |
| **Bin size** | Small (JX-2) or Large (JX-4); one size per level |
| **Isi maks. per bin** | How many units of a SKU fill one bin; learned (§4.6). Code: `full` |
| **Pesan ulang saat sisa** | Reorder at: the stock that triggers a restock draft. Code: `R` |
| **Isi sampai** | Fill up to: what a restock tops up to. Code: `P` |
| **Batas kritis** | Critical level: at or below it the SKU is red. Code: `S` |
| **Kode SKU di Hiryu** | The SKU's code in Hiryu; lines the stock sheet up with Hiryu's Stock tab |
| **Baki karantina** | The quarantine tray, `HUB-KARANTINA`: one labelled box per hub, away from the racks, for units that must not be sold until the SPV decides. Made automatically (§2.5.2, §11.4) |
| **Ops Head** | The head of operations; the last signature on a write-off (§11.5) |
| **Hiryu roles** | ADMIN, EDITOR, VIEWER for office staff; MANAGER and STAFF for hub logins (§1.1) |
| **Temporary inbound bin** | `HUB-IN-nn`, where a delivery is counted before putaway; not stock (§2.5.2) |
| **Day colour** | Sticker colour for the week a delivery arrived, with the date on the divider |
| **Listing model** | Who is the merchant on Grab: Grab's 3PL model or Ninja's own merchant (§2.11) |
| **Split order** | One order filled from two hubs (§17) |
| **Stock sheet** | *Stok untuk Hiryu*: the numbers the SPV types into Hiryu |

## Appendix B. SKU master for Kahf and Labore

**Go-live range after the 25 Sep recheck: 105 SKUs**, 68 Kahf (67 products and 1 factory kit) and 37 Labore (33 products and 4 factory kits). The recheck found 1 new Kahf SKU and 15 new Labore SKUs; 41 rows were set aside (marketplace bundles, duplicates, likely discontinued). 56 of the 105 already have a barcode from public sources; no pack sizes were found. Details: `SKU-RECHECK-25SEP.md` in the Grab Kilat project folder.

The SKU list and the data sheet for the brands is `11 SKU Master Kahf Labore.xlsx` in the same folder. It has one row per SKU, yellow cells for the brand to fill, and the columns the WMS imports (§2.6.1):

| Column | Required | Notes |
|---|---|---|
| Brand, SKU code, product name, variant, size, category | Yes | From the brand |
| Barcode (EAN-13) | Yes if printed | More than one allowed, separated by a comma |
| Pack length, width, height (mm) | Asked | The retail box or bottle, standing |
| Weight (g) | Asked | Gross, with pack |
| Liquid in a bottle (Y/N); large bottle 150 ml or more (Y/N) | Asked | For the carton rule |
| Units per carton, carton size | Asked | For receiving |
| Shelf life (months), BPOM number; ED on each Surat Jalan | Asked | For expiry (§5.5) |
| Hiryu SKU code, bin size, isi maks. per bin | Ninja fills | Bin size suggested from the pack size |

Where the brand gives nothing, the WMS uses the estimates in the sheet and marks them *perkiraan*.

## Appendix C. Section numbers in v3.3

Code comments and notes written before 29 September use the v3.3 numbers. This table gives the new place of each.

| v3.3 | v4.0 |
|---|---|
| A1 | §0.1 |
| A1.1 | §1.1 |
| A1.2 | §12.1 |
| A2 | §0.4 |
| A3 | §2.1 |
| A3.1 | §2.1.1 |
| A3.2 | §2.1.2 |
| A4 | §3 |
| A4.1 | §3.1 |
| A4.2 | §3.2 |
| A4.3 | §3.3 |
| A4.4 | §1.3.1 |
| A5 | §2.2 |
| A5.1 | §2.2.1 |
| A5.2 | §2.2.2 |
| A5.3 | §2.2.3 |
| A5.4 | §2.2.4 |
| A5.5 | §2.2.5 |
| A5.6 | §2.2.6 |
| A5.7 | §2.3 |
| A6 | §2.4 |
| A6.1 | §2.4.1 |
| A6.2 | §2.4.2 |
| A6.3 | §2.4.3 |
| A6.4 | §2.4.4 |
| A6.5 | §2.4.5 |
| A6.6 | §2.4.6 |
| A7 | §5 |
| A7.1 | §5.1 |
| A7.2 | §5.2 |
| A8 | §6 |
| A8.1 | §6.1 |
| A8.2 | §6.2 |
| A8.3 | §6.3 |
| A8.4 | §6.4 |
| A8.5 | §7.1 |
| A9 | §8 |
| A9.1 | §8.1 |
| A9.2 | §11.1 |
| A9.3 | §8.2 |
| A10 | §13 |
| A10.1 | §4.2 |
| A10.2 | §4.1 |
| A10.3 | §11.2 |
| A10.4 | §13.1 |
| A10.5 | §13.2 |
| A11 | §9 |
| A11.1 | §9.1 |
| A11.2 | §9.2 |
| A11.3 | §9.3 |
| A11.4 | §10.1 |
| A11.5 | §13.3 |
| A12 | §14 |
| §1 | §0.2 |
| §2 | §0.3 |
| §3 | §1.2 |
| §4.1 | §2.5 |
| §4.2 | §3.4 |
| §5.1 | §4.3 |
| §5.2 | §4.4 |
| §5.3 | §15.1 |
| §6.1 | §2.6 |
| §6.1b | §2.7 |
| §6.2 | §2.8 |
| §6.3 | §2.9 |
| §6.4 | §2.10 |
| §6.5 | §2.11 |
| §7 | §5.3 |
| §7.8 | §5.4 |
| §7.9 | §5.5 |
| §8.1 | §4.5 |
| §8.2 | §4.6 |
| §8.3 | §6.8 |
| §8.4 | §3.5 |
| §8.5 | §4.7 |
| §8.6 | §4.8 |
| §9 | §6.5 |
| §10.1 | §6.7 |
| §10.2 | §8.3 |
| §10.3 | §6.9 |
| §10.4 | §7.2 |
| §10.5 | §6.11 |
| §10.6 | §8.4 |
| §11 | §10.2 |
| §12 | §11 |
| §12.1 | §11.3 |
| §12.1a | §11.4 |
| §12.2 | §11.5 |
| §12.3 | §11.6 |
| §12.4 | §8.5 |
| §12.5 | §8.6 |
| §13.1 | §0.6 |
| §13.2 | §6.6 |
| §13.3 | §2.12 |
| §13.4 | §9.4 |
| §13.5 | §13.4 |
| §13.6 | §9.5 |
| §14 | §6.10 |
| §15 | §1.4 |
| §16 | §0.5 |
| §17 | §16 |
| §18 | §17 |
| §19 | §18 |
| §20 | §19 |
| §21 | §20 |
