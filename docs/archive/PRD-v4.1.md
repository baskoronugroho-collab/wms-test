# Ninja Kilat WMS: requirements and working instruction

| | |
|---|---|
| **Product** | Ninja Kilat WMS |
| **Version** | v4.1: every step rewritten as a step card (who, where, what to do, what you should see), new terms explained where they first appear, a clickable process map, one Hiryu menu per store, SKUs made from the Hiryu menus, racks registered as they stand, and the setup order of 30 September |
| **Date** | 30 September 2026 |
| **Owner** | Baskoro Nugroho |
| **Status** | Spec for review, process by process. WMS screens are drafts; the first build is on dev |
| **Governed by** | *QC Systems: Hiryu, WMS, TMS* (ChangWen, 11 Sep 2026), `docs/canonical/qc-oms-wms.html`, for the long-term design. Where the first build needs a stopgap (no Hiryu link yet), this page says so |
| **Supersedes** | v4.0 of 29 September (kept at `docs/archive/PRD-v4.0.md`), v3.3 (its section numbers are in Appendix C) and every earlier version |
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

Before the first Grab order, these steps happen **in this order**. The letter is the phase on the process map below. Click a section number to open the steps.

| # | Phase | Who | Where | Step | See |
|---|---|---|---|---|---|
| 1 | A | Ops HQ (Hiryu ADMIN) | Hiryu | Indonesia settings once; the dark store and its hours; the SPV's MANAGER login | §2.1.1 |
| 2 | A | Ops HQ | WMS | Register the hub; add the SPV | §2.1.2, §1.3 |
| 3 | A | SPV | Hiryu, then WMS | Staff logins in Hiryu, then staff accounts in the WMS | §1.3.1 |
| 4 | A | SPV | At the hub | Set up the devices and sign in on each | §12.1 |
| 5 | B | SPV | WMS, then the printer | Temporary inbound bins and the quarantine tray; print and stick their labels | §3.1 |
| 6 | B | SPV | At the rack, then WMS | Register each rack as it stands; print and stick the bin labels | §3.2 |
| 7 | B | Ops HQ | WMS | Add the brand | §2.2.1 |
| 8 | B | Ops HQ, with the brand's content | Hiryu | Build the first store's menu, then copy it to the brand's other store | §2.2.2, §2.2.3 |
| 9 | B | Ops HQ | Hiryu | Create the SKUs and connect every item to its SKU | §2.2.4 |
| 10 | B | Ops HQ | WMS | Upload each store's menu (this creates the SKUs), then complete their stock numbers | §2.2.5, §2.2.6 |
| 11 | B | SPV | WMS | Give each SKU a bin | §3.3 |
| 12 | B | Ops HQ, with each store's Grab manager login | Hiryu, then Grab | Create the four stores, give each its hub and its menu, activate on Grab, check the menu reached Grab | §2.4.1 to §2.4.5 |
| 13 | C | SPV | WMS, then WhatsApp or email | First restock request to each brand | §4.1 |
| 14 | D | Staff | WMS | Receive and put away the first delivery | §5.1 |
| 15 | A | SPV | WMS, then Hiryu | Type the opening stock into each store | §9.3 |
| 16 | A | Ops HQ | Grab, Hiryu, WMS | One test order per store, end to end, then open | §2.4.6 |

**Hiryu first.** Whenever a step touches both systems, do the Hiryu part first and record it in the WMS after. Hiryu is the interface with Grab: it is what customers see.

A store that is activated but has no stock typed yet shows nothing Grab can sell. Check this on the first store (step 12) before activating the other three.

### 0.5 Service targets and scale **[PROPOSAL]**

**A proposal for Ops to decide.** None of these numbers is agreed yet; they are a starting point to review after the first weeks at MA5.

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

- **Go or no-go for KJ5.** Which numbers must MA5 reach before KJ5 opens (§0.5), and for how long? *Proposal:* two weeks at MA5 on target. *Decides:* Ops.
- **Grab's service level** (Q13): the 10-minute ready-by is our reading of Hiryu, not a figure from Grab.

## Process map

The whole operation on one page: **who** does each step (the rows) and in **which phase** (the columns). Click any step to open its instructions; every process section has a **↑ Map** link back here. Colours show the system: green is Hiryu, red is the WMS, grey is work by hand or outside both systems.

<!--screen:process-map-->

# Part B. Processes

Fifteen processes. Each starts with who does it, in which system, and what is already on dev.

## 1. Login and user access

**Who**: Ops HQ, SPV · **Systems**: Hiryu first, then the WMS · **On dev**: Google sign-in and the user list. The roles of 28 Sep (Ops Head, an SPV adds staff only): not yet

### 1.1 Signing in to Hiryu

<!--screen:hiryu-login-->

There are **two ways in**. Which one you use depends on the email your Hiryu account was made with.

1. **Anyone · Hiryu sign-in page**

   Choose **Indonesia** at the top. Malaysia is a separate list of stores and users.

   ✓ You see: the Indonesia sign-in box.

2. **If your Hiryu account uses your Ninja Van email (@ninjavan.co)**

   Press **Sign in with Google** and choose your Ninja Van Google account.

   ✓ You see: Hiryu opens on the screens your role allows.

3. **If your Hiryu account uses another email (for example @gmail.com)**

   Type the email and the password, then press **Sign in**. The first time, use the temporary password your SPV or Ops HQ gave you; Hiryu then asks you to choose your own.

   ✓ You see: Hiryu opens on the screens your role allows.

Hub logins (SPV and staff) see Live Orders, Orders, the order page and their stores' Stock tab, nothing else. Ops HQ sees the office screens its role allows.

**Who holds which Hiryu role**

| Hiryu role | Given to | Can |
|---|---|---|
| **ADMIN** | Ops HQ lead (the project owner grants it) | Everything, including users, settings and *Activate on Grab* |
| **EDITOR** | Ops HQ | Stores, menus, SKUs, stock, hours, hub staff |
| **VIEWER** | Anyone who only needs to look | Read only |
| **MANAGER** (hub login) | The hub's SPV | Orders, Live Orders, typing stock, the hub's own staff logins |
| **STAFF** (hub login) | Hub staff | Orders, Live Orders, the order page |

The WMS is different: it takes **only** a Ninja Van Google account (§1.4.1).

### 1.2 Users and roles

| Role | Where | Does |
|---|---|---|
| **Staff** | Dark store floor | Receive by AWB, put away, paste Grab orders, pick, pack, hand over, count, report problems |
| **SPV** | Their own hubs | Temporary inbound bins, racks and bins, SKU to bin, the second-bin question, missing-item decisions, problem decisions, restock requests for their hubs, variance acknowledgement, count sign-off, end-of-day report, **registering staff** |
| **Ops HQ** | Every hub | **Adding brands**, SKUs, photos, stock numbers and Grab buffer, Hiryu menu and store maps, approving write-offs, variance sign-off, linking deliveries without a recorded AWB, **registering dark stores and users and assigning roles** |
| **Ops Head** | Every hub | **Everything Ops HQ does**, plus the **last approval** on every variance (count differences, delivery differences) and every write-off (§11.5) |
| **Superadmin** | Everything | Everything Ops HQ does, granting Ops Head and superadmin, viewing the app as another role (read only) |

**Who registers whom** *(decided 25 Sep; Ops Head 30 Sep)*:

| | Register a dark store | Add a brand | Register a user | Roles they can give |
|---|---|---|---|---|
| **Superadmin** | Yes | Yes | Yes | Any, including Ops Head and superadmin |
| **Ops Head** | Yes | Yes | Yes | Staff, SPV, Ops HQ |
| **Ops HQ** | Yes | Yes | Yes | Staff, SPV, Ops HQ |
| **SPV** | No | No | Yes, at their own hubs | Staff only |
| **Staff** | No | No | No | None |

The Ops Head role is built now; who holds it is decided later. Hiryu has its own roles (ADMIN, EDITOR, VIEWER for office staff; MANAGER and STAFF for hub logins). Who holds which is in §1.1.

- **1.2.1** The server enforces every permission; the console hides screens a role cannot use.
- **1.2.2** The *hub operator* role for the central warehouse is hidden in the first build and returns with it (§19).
- **1.2.3** **Two surfaces.** *Station* for the floor: large type, one decision per screen, a scan area that keeps focus; works on a laptop with a scanner, a tablet, or a phone (installable, camera scan, type the code). *Console* for SPV and Ops HQ: tables, filters, queues.

### 1.3 Accounts for a new person

> **Term · Ninja Van Google account**
> The person's work email, ending in **@ninjavan.co**, with Google sign-in. **Everyone who works in this operation needs one**, staff included: the WMS accepts no other account (§1.4.1). Ask NV IT for it before the person's first shift.

1. **Ops HQ (or the SPV, for staff at their own hub) · WMS → Dark store & pengguna → Tambah pengguna**

   Type the person's **@ninjavan.co email**, their name, choose the **role** and tick their **hub(s)**. Press **Simpan**.

   ✓ You see: the person in the user list with the role and hubs you chose.

2. **The new person · any device · the WMS link**

   Open the WMS and choose their Ninja Van Google account.

   ✓ You see: the WMS opens on their hub. For staff, the station menu; for the SPV and Ops HQ, the console.

Ops HQ can give Staff, SPV and Ops HQ. Only a superadmin can give Ops Head or superadmin. An SPV sees only *Tambah pengguna*, and can only add **Staff** at their own hubs.

#### 1.3.1 Staff accounts in both systems

Staff need a Hiryu hub login too, because they open orders in Hiryu. **Hiryu first.**

1. **SPV · Hiryu → Dark stores → your hub → Staff → Add staff**

   Type the person's email (their @ninjavan.co email if they have one, so they can use Google sign-in), their name, and role **STAFF**. Use MANAGER only for a deputy SPV. Press **Add**.

   ✓ You see: a **temporary password**, shown once. Write it down for the person now; Hiryu will not show it again.

2. **SPV · WMS → Dark store & pengguna → Tambah pengguna**

   Add the same person as in §1.3 step 1, role **Staff**, your hub.

   ✓ You see: the person in the WMS user list.

3. **The new person · the packing laptop**

   Sign in to Hiryu (§1.1) with the temporary password and choose their own; then sign in to the WMS with their Google account.

   ✓ You see: Hiryu Live Orders and the WMS station menu.

#### 1.3.2 When someone leaves

A person's accounts are **never passed on** to someone else. The person who leaves loses both logins, and their replacement gets new ones.

1. **SPV (or Ops HQ) · Hiryu → Dark stores → the hub → Staff**

   Find the person and remove them. Do it on their last day.

   ✓ You see: the person is no longer in the hub's staff list.

2. **SPV (or Ops HQ) · WMS → Dark store & pengguna → the person → Nonaktifkan**

   ✓ You see: the person marked inactive. Their past scans and approvals keep their name.

3. **SPV · the packing laptop**

   Make sure the person is signed out of Hiryu and the WMS on the laptop and the hub phones.

4. **SPV or Ops HQ · for the replacement**

   Register the new person from the start: §1.3, then §1.3.1.

### 1.4 Admin, access, training and security

- **1.4.1** Sign-in is Google SSO through the Substrait proxy; the app stores no passwords. **Only Ninja Van Google accounts (@ninjavan.co) can sign in** *(decided 30 Sep)*: every person in the operation, staff included, needs one. Superadmin, Ops Head and Ops HQ see every hub; others see their own. Nobody changes their own role.
- **1.4.2** At go-live, automatic staff accounts are switched off; accounts are created as in §1.4.5.
- **1.4.5** **Registering** *(decided 25, 28 and 30 Sep)*: superadmin, Ops Head and Ops HQ register dark stores, add brands, register users and assign roles (up to Ops HQ; only a superadmin grants Ops Head or superadmin). An SPV registers staff only, at their own hubs, and can deactivate them. When someone leaves, their accounts are closed and the replacement is registered from the start (§1.3.2). Nobody changes their own role.
- **1.4.6** **Hiryu access** *(28 and 30 Sep)*: the project owner holds Hiryu ADMIN for Indonesia and grants it (or EDITOR, VIEWER) to Ops HQ. Hub logins (MANAGER for the SPV, STAFF for staff) are made on the dark store's Staff tab in Hiryu, by an ADMIN, an EDITOR or the hub's MANAGER. Hiryu shows a temporary password once; the person sets their own at first sign-in. A login made with an @ninjavan.co email can also use *Sign in with Google* (§1.1).
- **1.4.7** **Brands do not sign in** to the WMS or Hiryu *(decided 30 Sep)*. They receive requests and reports (§4.1, §15).
- **1.4.3** A separate training site with a banner, one-tap reset, test barcodes and a Hiryu order simulator. It never reaches real stock.
- **1.4.4** **Security**: Substrait's security team reviews the app when it is deployed and says what to fix. That replaces the earlier question of who reviews scan findings.

### 1.5 Open points

- **Who is the Ops Head** for the pilot, and who stands in when they are away. The role is built now (§1.2); every variance and write-off waits for its approval.
- **A forgotten Hiryu password.** Can the SPV reset a staff login in Hiryu, or is it removed and made again? *To check in Hiryu.*

## 2. Registration and store setup: hub, brand, SKU, Grab store

**Who**: Ops HQ (Hiryu ADMIN or EDITOR) · **Systems**: Hiryu first, then the WMS, then Grab · **On dev**: *Menu & toko Hiryu* (menu upload, item connections, store map), 28 Sep. The brand form and the new SKU form: not yet

### 2.1 Ops HQ: register a new hub

One hub is one physical dark store (MA5 Cawang, KJ5 Kemanggisan). It is registered once in Hiryu and once in the WMS, **Hiryu first**, with the same name in both.

#### 2.1.1 In Hiryu: the instance, the dark store, its hours, the SPV login

<!--screen:hiryu-darkstore-->

1. **Ops HQ (Hiryu ADMIN) · Hiryu → Settings** · *once for Indonesia*

   Check the instance serves **Indonesia**, the currency is **IDR** and the business day is Jakarta time (WIB). The currency can only be changed while no menu exists, so do this before any menu.

   ✓ You see: Indonesia, IDR, Asia/Jakarta.

2. **Ops HQ (ADMIN) · Hiryu → Users → Invite user** · *once per office person*

   For each Ops HQ person who needs Hiryu: their @ninjavan.co email, name, and role **EDITOR** (or VIEWER to look only). They sign in with Google (§1.1).

   ✓ You see: the person in the user list.

3. **Ops HQ (ADMIN or EDITOR) · Hiryu → Dark stores → New dark store**

   Name it as the WMS will (*Cawang*). One per physical hub.

   ✓ You see: the new dark store, with no stores and no staff yet.

4. **Ops HQ · Hiryu → Dark stores → the hub → Hours**

   Set the opening and closing time for each day of the week, then **Save hours**. Every Grab store fulfilled from this hub follows these hours.

   ✓ You see: *Hours saved*.

5. **Ops HQ · Hiryu → Dark stores → the hub → Staff → Add staff**

   The SPV's email, name, role **MANAGER**. Hiryu shows a **temporary password once**: give it to the SPV straight away. They choose their own at first sign-in.

   ✓ You see: the SPV in the hub's staff list.

#### 2.1.2 In the WMS: the dark store

<!--screen:admin-setup-->

1. **Ops HQ (or superadmin) · WMS → Dark store & pengguna → Tambah dark store**

   Enter the hub code (MA5), the name, the address, the dark store's name in Hiryu (*Cawang*), and the hub's SPV. Press **Simpan**.

   ✓ You see: the hub in the list, and a **quarantine tray** `MA5-KARANTINA` already made for it.

2. **Ops HQ · WMS → Dark store & pengguna → Tambah pengguna**

   Add the SPV as in §1.3.

   ✓ You see: the SPV with role SPV at this hub.

> **Term · Baki karantina (quarantine tray)**
> **What it is:** one box at each hub for units that must not be sold: damaged, leaking, expired, or doubtful. Units in it are out of sellable stock until the SPV decides what happens to them (§11.2).
>
> **How many:** one per hub. The WMS makes it by itself and it cannot be switched off.
>
> **What you do physically:** take one large bin (JX-4) or a crate with a lid, print its label on A4 (§3.1), stick the label on the front, and put it **away from the picking racks**, near the SPV's desk, so nobody picks from it by mistake.

The SPV then sets up the temporary inbound bins and prints both labels (§3.1).

### 2.2 Ops HQ: add a brand and its products

**Hiryu first**, then the WMS. Each brand has one Grab store per hub, and **each store has its own menu** *(decided 30 Sep)*: the first store's menu is built, then copied to the brand's other store. The WMS then takes the brand's SKUs from those menus, so nothing is typed twice.

The brand supplies the content: product names, sizes, descriptions, photos and prices. Ops HQ enters it.

> **Term · SKU and menu item**
> A **SKU** is **what sits on the shelf**: one product in one size, with one barcode (*Labore GentleBiome Mild Cleanser 100 ml*). A **menu item** is **what the customer buys on Grab**. One SKU can be sold as a single and as a 2-pack: two menu items, one SKU. **Units per sale** says how many units of the SKU one sale takes: 1 for a single, 2 for a 2-pack.

> **Term · Kode SKU di Hiryu**
> The code a SKU has in Hiryu. Hiryu prints it under the SKU's name on the Stock tab, and the WMS stock sheet lists rows by the same code, so the SPV can type stock row by row (§9.3). It is the same as the menu item's code for a single (§2.2.4).

#### 2.2.1 Add the brand in the WMS

<!--screen:brand-form-->

1. **Ops HQ (or superadmin) · WMS → Merek → Tambah merek**

   Name, short code (*LBR*), and the brand's company.

2. **Same form · Model listing di Grab**

   *Grab minta Ninja jadi 3PL* (Grab brings the brand, as for Kahf and Labore) or *Ninja daftar merchant sendiri* (Ninja lists the brand on Grab itself). The stock always belongs to the brand.

3. **Same form · Kontak restock**

   Who at the brand receives restock requests: name, WhatsApp number or email.

4. **Same form · Dijual di hub**

   Tick the hubs that carry the brand. Press **Simpan**.

   ✓ You see: the brand in the list, with no SKUs yet.

#### 2.2.2 In Hiryu: build the first store's menu

<!--screen:hiryu-menu-->

1. **Ops HQ · Hiryu → Menus → New menu**

   Name the menu after its store, brand and hub: *Labore - Cawang*. Then **Add category** (*Cleanser*, *Moisturiser*).

   ✓ You see: an empty menu with its categories.

2. **Ops HQ · the menu → a category → Add item**

   - **Item ID**: for a single, the **brand's SKU code** (*LAB-GB-MC-100*). This becomes the SKU's code in §2.2.4, so choose it with care.
   - **Name** with size, **price** in IDR, sequence, **description** (shoppers see it), up to **4 photos**, square (1:1).
   - Press **Add to draft**.

   ✓ You see: the item in the category, marked as a draft.

3. **Ops HQ · the menu → Save menu**

   Nothing reaches Grab until you save.

   ✓ You see: the menu saved, with no store using it yet.

For many items at once: **Export CSV**, fill it in, **Import CSV**. Import **replaces the whole menu**, so export first to keep a copy. The CSV has a **barcode** column: fill it, and the WMS connects each single to its SKU by itself (§2.2.5).

#### 2.2.3 In Hiryu: copy the menu to the brand's other store

Hiryu has no copy button: the copy is an export and an import.

1. **Ops HQ · Hiryu → Menus → the first menu (*Labore - Cawang*) → Export CSV**

   ✓ You see: a CSV file saved on the laptop.

2. **Ops HQ · Hiryu → Menus → New menu**

   Name it after the other store (*Labore - Kemanggisan*), then **Import CSV** with the file from step 1. Leave the **ID column as it is**: the same item IDs keep the two menus lined up with the WMS.

   ✓ You see: the same categories and items as the first menu.

3. **Ops HQ · the new menu**

   Change only what differs at this hub (for example a price), then **Save menu**.

   ✓ You see: the menu saved.

After this the two menus are **separate**: a later change is made in each of them (§2.3).

#### 2.2.4 In Hiryu: create the SKUs and connect every item

<!--screen:hiryu-skus-->

<!--screen:hiryu-bundles-->

1. **Ops HQ · Hiryu → Menus → the first menu → Bundles → One SKU per item**

   Hiryu makes one SKU for each single item, with the **item's code**.

   ✓ You see: every single item with its SKU and *Units per sale* 1.

2. **Same screen · each pack of the same product (a 2-pack)**

   Choose the **single's SKU** and set *Units per sale* to **2**. A factory kit with its own barcode is a SKU of its own.

3. **Ops HQ · Hiryu → Menus → the copied menu → Bundles**

   For each item, choose the SKU with the same code, and the same *Units per sale*. Do **not** press *One SKU per item* here: the SKUs exist already.

   ✓ You see: every item connected, the same as in the first menu.

4. **Ops HQ · Hiryu → SKUs → filter *Not counted only***

   ✓ You see: an empty list. An item left *Not counted* can be sold even when the shelf is empty, so every packaged product must be connected.

#### 2.2.5 In the WMS: upload each store's menu

<!--screen:hiryu-map-->

1. **Ops HQ · Hiryu → Menus → the store's menu → Export CSV**

2. **Ops HQ · WMS → Menu Hiryu → choose the brand → Unggah CSV menu**

   ✓ You see: *N barang · N SKU baru · N terhubung lewat barcode · N perlu dihubungkan*.

   The upload does this by itself:
   - a **single item with no WMS SKU yet** becomes a **new WMS SKU**: its code in Hiryu, name, barcode and price come from the menu;
   - an item whose **barcode** matches an existing SKU connects to it at 1 unit per sale;
   - a **pack** (2-pack, bundle) waits on **Perlu dihubungkan**.

3. **Ops HQ · Menu Hiryu → Perlu dihubungkan**

   For each pack, choose the WMS SKU and the units per sale, the same as in Hiryu's Bundles.

   ✓ You see: *Perlu dihubungkan* empty. A Grab order with an unconnected item cannot be pasted.

4. **Repeat steps 1 and 2 for the brand's other store.** Its items have the same IDs, so they connect by themselves.

5. **Ops HQ · Menu Hiryu → Toko Hiryu** · *after the stores exist (§2.4.1)*

   Enter each Hiryu store number once, with its hub and brand.

   ✓ You see: the four stores, each with its hub.

Upload the menu again **every time it changes in Hiryu**, the same day.

#### 2.2.6 In the WMS: complete each SKU's stock numbers

<!--screen:sku-complete-->

1. **Ops HQ · WMS → Produk → Lengkapi data SKU**

   Filter by brand. Each SKU made by the upload has a row marked *belum lengkap*.

2. **Same table · each row**

   Fill in the brand's own SKU code (if it has one), the **bin size** (the WMS suggests one), and the stock numbers below. For many rows at once: **Unduh CSV**, fill it in, **Unggah CSV**, check the preview, **Simpan**.

   ✓ You see: the row marked *lengkap*. A complete SKU appears on every hub's *Perlu rak* list, ready for a bin (§3.3).

| On screen | What it means | Takes | Example |
|---|---|---|---|
| **Isi sampai** | A restock fills the hub's stock up to this | Units | 15 |
| **Pesan ulang saat sisa** | When the hub's stock falls to this, the WMS drafts a restock request to the brand | Unit or % of *isi sampai* | 25% = 4 units |
| **Batas kritis** | At or below this the SKU is flagged red: nearly out | Unit or % of *isi sampai* | 1 unit |
| **Cadangan Grab** | Units kept back from what Grab may sell, in case of a miscount (§9.5) | Unit or % of what is available (rounded up) | 1 unit (the default) |
| **Isi maks. per bin** | How many units fit in one bin before the next is used. May stay empty: the WMS learns it from the SPV (§4.2) | Units | 12 |

*Isi sampai* and the bin size are required. *Pesan ulang saat sisa* fills in as 25% and *Cadangan Grab* as 1 unit unless you change them.

### 2.3 Changes after go-live

Every change is made in **Hiryu first, then the WMS, on the same day**, and in **each store's menu** (two per brand).

#### 2.3.1 A new product

1. **Ops HQ · Hiryu** · add the item to the first store's menu and save (§2.2.2); press *One SKU per item* on that menu's Bundles (it only adds what is missing); add the item to the brand's other store's menu and choose the same SKU there (§2.2.4).
2. **Ops HQ · WMS** · upload both menus (§2.2.5): the new SKU is created. Complete its stock numbers (§2.2.6).
3. **SPV · WMS** · give it a bin (§3.3).

#### 2.3.2 A price change

1. **Brand → Ops HQ** · the brand asks, in writing, with the date the price starts.
2. **Ops HQ · Hiryu → Menus → each store's menu → the item** · change the price, **Save menu**. Check it shows *Synced* (§2.4.5).
3. **Ops HQ · WMS → Menu Hiryu** · upload both menus again that day, so the sell-out report values sales at the new price from that date (§15.1).

#### 2.3.3 Stop selling a product

1. **Ops HQ · Hiryu → each store's menu → the item** · set it to **UNAVAILABLE** (for good) or **SOLD OUT** (for now), **Save menu**.
2. **Ops HQ · WMS → Produk → the SKU** · set *Isi sampai* to **0**, so no more restock is asked for.
3. **SPV** · stock still on the shelf goes back to the brand (§8).

#### 2.3.4 A pack changes (for example a single becomes a 2-pack)

1. **Ops HQ · Hiryu → each store's menu → Bundles** · change the item's *Units per sale*.
2. **Ops HQ · WMS** · upload both menus the same day and set the same units on *Perlu dihubungkan* (§2.2.5).

#### 2.3.5 Store hours and public holidays

1. **Ops HQ · Hiryu → Dark stores → the hub → Hours** · change the day's hours and **Save hours**. Every store of the hub follows.
2. **For one store only** · *Stores → the store → Hours* sets that store's own hours (only after it is activated on Grab); **Follow hub hours** puts it back.
3. **Public holiday** · change the hub's hours the working day before, and put them back after the holiday. The SPV tells Ops HQ at least 3 days ahead.

#### 2.3.6 Close a store

1. **Ops HQ · Hiryu → Stores → the store → Overview → Deactivate** · Hiryu stops treating it as live. **Delete store** only when it will never return; its order history stays in reports.
2. **Ops HQ · Grab** · ask Grab (or the brand, for its merchant) to close the Grab store or unlink it.
3. **Ops HQ · WMS → Menu Hiryu → Toko Hiryu** · untick *Aktif* for the store.
4. **SPV** · the brand's stock at that hub goes back to the brand or to another hub (§8).

#### 2.3.7 Close a hub

1. **Close every store** the hub fulfils (§2.3.6), and empty the hub's stock (§8).
2. **Ops HQ · Hiryu → Dark stores → the hub → Delete dark store** · the hub is removed along with its opening hours. Hiryu refuses while a store is still assigned to it.
3. **Ops HQ · WMS → Dark store & pengguna → the hub → Nonaktifkan** · only when its stock is zero. Close the staff accounts (§1.3.2).

**The item links live in two places.** Hiryu's *Bundles* and the WMS item list both hold which SKU each menu item sells, and how many units. Hiryu uses its copy to count down its stock; the WMS uses its copy to know what to pick. If one changes and the other does not, the two counts drift apart. So every change is made in both, the same day, and once a month Ops HQ downloads the WMS item list (*Menu Hiryu → Unduh daftar item*) and compares it with each menu's Bundles page.

### 2.4 Ops HQ: link each Grab store to Hiryu

**One Grab store per brand per hub**: the pilot has **four**, Kahf × MA5, Kahf × KJ5, Labore × MA5 and Labore × KJ5. Each is linked on its own, and each has its **own menu** (§2.2). Do §2.4.1 to §2.4.5 **four times**, once per store.

**Before you start**, for each store:
- the Grab store already made by Grab, with the hub's address;
- the **outlet's Grab manager login** for that store (from Grab or the brand);
- the store's menu built, with every item connected to a SKU (§2.2).

Stock is typed later, after the first delivery (§9.3).

#### 2.4.1 Create the store

1. **Ops HQ · Hiryu → Stores → New store**

   Name it exactly as customers should read it, brand and hub: *Labore - Cawang*.

   ✓ You see: the store, **INACTIVE**, with no Grab link, no hub and no menu.

#### 2.4.2 Give it the hub

<!--screen:hiryu-store-hub-->

1. **Ops HQ · Hiryu → Stores → the store → Overview → Dark store → Assign a dark store**

   Choose the hub (*Cawang*) and press **Assign**. A store belongs to one hub only: to move it, unassign it from the old hub first.

   ✓ You see: the hub's name on the Overview. The store now follows the hub's hours.

   Do this **before** activating: an order for a store with no hub reaches no Live Orders board.

#### 2.4.3 Give it its menu

<!--screen:hiryu-store-menu-->

1. **Ops HQ · Hiryu → Stores → the store → Overview → Menu**

   Choose **the store's own menu** (*Labore - Cawang*) and press **Assign**.

   ✓ You see: *Menu assigned to this store*, and the menu's name on the Overview.

#### 2.4.4 Activate it on Grab

<!--screen:hiryu-store-activate-->

1. **Ops HQ (Hiryu ADMIN) · the store → Overview → Activate on Grab**

   Check the menu is set. *Start activation* stays grey until the menu has at least one saved item, because Grab rejects an empty menu. Press **Start activation**.

   ✓ You see: a link to Grab.

2. **Same screen · Open link**

   Grab's own pages open:

<!--screen:grab-activate-->

3. **Ops HQ · Grab's page · sign in with the outlet's Grab manager login** (for example `labore.cawang.manager`).

4. **Grab's page · choose the store to connect**

   Check the address is the hub's, and connect it.

5. **Grab's page · enable the integration**

   Grab warns that the POS menu becomes the main menu and changes made in the GrabMerchant app are cancelled. That is expected: from now on the menu, prices and stock come from Hiryu.

6. **Ops HQ · Hiryu → the store** · reload.

   ✓ You see: **ACTIVE**, with the **Grab merchant ID** filled in.

#### 2.4.5 Check the menu reached Grab

1. **Ops HQ · Hiryu → Menus → the store's menu → Stores using this menu**

   ✓ You see: the store marked **Synced**. *Syncing…* means wait. *Not sent* shows Grab's reason: fix it and press **Retry**. A message about syncing too often means wait the minutes it says.

#### 2.4.6 Test order, then open

Do this after the first delivery is on the shelf and the opening stock is typed (§9.3).

1. **Ops HQ · Grab app** · place one test order on each store.
2. **Staff · Hiryu, then WMS** · run it end to end: paste, pick, pack, *Mark ready*, handover (§6, §7).
3. **Ops HQ** · cancel or complete it as agreed with Grab, then tell the SPV the store is open.

**Any error in Hiryu** (activation, menu sync, orders not arriving): contact **Shaun Cong**, who owns Hiryu, with a screenshot, the store name and the time.

### 2.5 Sites

- **2.5.1** The first build has **dark stores only**. The central warehouse site type, transfers and tote dispatch stay in the code but are hidden (§19).
- **2.5.2** **Temporary inbound bins and the quarantine tray** *(revised 28 Sep)*. The **quarantine tray** (`HUB-KARANTINA`) is made automatically when Ops HQ registers the dark store and cannot be switched off: it is the one place for units that must not be sold (damaged, leaking, expired, doubtful), so they never sit in a bin a picker can reach. The **SPV** sets up the **temporary inbound bins** (§3.1): how many and what size. The WMS gives each its own location and label, `HUB-IN-01` onwards, one SKU each, used while a delivery is counted; it names the one to use per SKU. Neither ever holds sellable stock. The number of temporary bins can change at any time; a delivery with more SKUs than temporary bins is received in batches (§5.3.2).

### 2.6 Registering a SKU **[updated 30 Sep]**

Ops HQ makes each WMS SKU **once for every hub**, **from the Hiryu menus** *(decided 30 Sep)*. Uploading a store's menu (§2.2.5) creates a WMS SKU for each single item that has none yet: Hiryu's *One SKU per item* gives a single's SKU the item's code, so the menu carries everything the WMS needs to match the two. Ops HQ then completes the rest in *Lengkapi data SKU* (§2.2.6). **Daftarkan SKU** (one at a time, by hand) stays for a product not on any menu yet.

| Field | Comes from | Required | Notes |
|---|---|---|---|
| Name and size | Menu item name | Yes | Updated at each upload if the name changes in Hiryu |
| **Kode SKU di Hiryu** | Menu item ID of the single | Yes | Never changes. The stock sheet lists rows by it, so they line up with Hiryu's Stock tab (§9.4). Compared ignoring capitals |
| **Barcode(s)** | Menu CSV *barcode* column, or scanned | If the pack has one | One barcode belongs to one SKU, ever. A SKU may have several |
| Hiryu menu items, units per sale | Menu upload | Shown | Each item ID that sells this SKU, in each store's menu |
| Price | Menu upload, per store, dated | Shown | Only for the sell-out value (§15.1) |
| Brand, brand SKU code, category | Brand, or the SKU master (Appendix B) | Brand yes, the rest optional | |
| Pack L × W × H mm, weight g | Brand | Optional | Drive bin size and packaging (§6.10) |
| Liquid in a bottle; large bottle (150 ml or more) | Brand | Optional | Drive the carton rule (§6.10) |
| **Bin size** | Ops HQ, suggested from pack size or category | Yes | |
| **Isi maks. per bin** | Ops HQ, or learned (§4.6) | Optional | |
| *Isi sampai* | Ops HQ | Yes | Units (§4.5) |
| *Pesan ulang saat sisa*, *Batas kritis* | Ops HQ | Fills in | Units or a percentage of *Isi sampai* (§4.5) |
| *Cadangan Grab* (Grab buffer) | Ops HQ | Fills in | Units or a percentage of what is available. **Default 1 unit** (§9.5) |
| Photo | Ops HQ | Optional | 1:1, at least 800 × 800, white background |

- **2.6.1** **In bulk**: *Lengkapi data SKU* downloads and uploads as CSV, with a preview before anything is saved. The SKU master sheet (Appendix B) loads into it the same way.
- **2.6.2** A SKU is **complete** when its bin size and *isi sampai* are set. Only complete SKUs appear on the hubs' *Perlu rak* list, **with their bin size**. The SPV picks a free bin of that size; the WMS suggests the most comfortable height first (level 3, then 2, 4, 1, 5).
- **2.6.3** A SKU with no bin at a hub can be received there (staff are given a bin during inbound) but not picked.
- **2.6.4** A pack item (units per sale above 1) never creates a SKU: it connects to its single's SKU on *Perlu dihubungkan* (§2.2.5).

### 2.7 Brands **[DECIDED 28 and 30 Sep]**

A new brand is added by **Ops HQ, the Ops Head or a superadmin** (§2.2.1), before any of its SKUs: name, short code, company, listing model (§2.11), the brand's restock contact, which hubs carry it, and whether its packs carry barcodes. An SPV cannot add a brand. **Linking the brand's Grab stores to Hiryu** (§2.4) is also done by Ops HQ or a superadmin *(30 Sep)*.

### 2.8 Barcodes

- **2.8.1** Barcodes come from the menu CSV (§2.2.5), are entered on *Lengkapi data SKU*, or are bound the first time a unit arrives: staff search the product list, pick the product in their hand, **scan the barcode a second time to confirm**, and it is bound for good. The second scan stops a misread number from being bound.
- **2.8.2** An unknown product at inbound goes to Ops HQ with a photo and count (§5); it is not stock until HQ answers.
- **2.8.3** Ninja's own unit labels (for brands without barcodes) stay built but hidden. Kahf and Labore are barcoded.
- **2.8.4** **An unknown barcode is often a bad scan** *(30 Sep)*. Before anything goes to Ops HQ, the station asks staff to: (1) scan again, holding the pack flat and still; (2) if that fails, type the digits printed under the barcode. If the number belongs to **another SKU**, it is that product: when it is not the one expected, the wrong-item screen shows both. Only a number that is **in no SKU at all** is unknown and goes to Ops HQ.

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
| Hiryu items | Hiryu item ID → SKU and units per sale, **for each store's menu** | Upload of each store's menu CSV (columns used: `item_id`, `item_name`, `barcode`, `available_status`, `price`); a single makes or finds its SKU, a barcode match connects at 1 unit, packs by hand |
| Hiryu stores | Store number → hub, brand and its menu | Typed once per store |
| Hiryu SKU code | On each WMS SKU (§2.6) | The single item's ID. Compared ignoring capitals, because Hiryu upper-cases codes |
| Hiryu item prices | Item ID and store → price, with the date of each upload | The `price` column of the same menu CSV; used only for the sell-out value (§15.1) |

### 2.13 Open points

- **Bundles.** 41 marketplace bundles were set aside at the recheck. Whether any is sold on Grab as a pack is **asked later**, per brand.
- **Copying a menu** (§2.2.3). Check on the first copy that *Import CSV* into a new menu keeps the item IDs, and whether the copied items keep their SKU links or need choosing again in *Bundles*.
- **A store activated before stock is typed** (§0.4 step 12). Check on the first store what Grab shows customers: all items sold out, or the store closed.
- **Monthly item-link check** (§2.3): the WMS download *Unduh daftar item* is to be built *(decided 30 Sep)*.

## 3. Racking setup

**Who**: SPV, Ops HQ · **Systems**: WMS · **On dev**: racks and bins with one bay. The rack picture, bays and temporary inbound bins: not yet

### 3.1 Temporary inbound bins and the quarantine tray

<!--screen:inbound-area-->

> **Term · Bin inbound sementara (temporary inbound bin)**
> **What it is:** a bin where a delivery is counted before it goes onto the racks, one SKU per bin. Units in it are **not stock yet**: nobody picks from it.
>
> **How many:** the SPV decides, usually 10 (one per SKU in a typical delivery). A delivery with more SKUs is simply counted in batches (§5.1).
>
> **What you do physically:** use ordinary bins, put them on a shelf or pallet **next to the receiving bench**, each with its printed label (`MA5-IN-01`, `MA5-IN-02` …).

> **Term · Label**
> A sticker the WMS prints on **A4 sticker paper** on the station's printer. Each label shows the location code in large letters and a barcode to scan. The sheet has **cut lines**: cut along them and stick each label on the **front of its bin**, along the top edge, where a scanner can reach it.

1. **SPV · WMS → Rak & bin → Area barang masuk**

   Enter how many temporary inbound bins the hub has and their size. Press **Simpan**.

   ✓ You see: the codes `MA5-IN-01` to `MA5-IN-10`, and the quarantine tray `MA5-KARANTINA` (made with the hub, §2.1.2).

2. **SPV · same screen → Cetak label**

   The A4 label sheet opens. Print it on the station printer, on A4 sticker paper.

   ✓ You see: one label per temporary bin and one for the quarantine tray, with cut lines.

3. **SPV or staff · at the receiving bench**

   Cut along the lines. Stick each `MA5-IN-…` label on the front of its bin, and the `MA5-KARANTINA` label on the tray (a large bin or a crate with a lid). Put the temporary bins next to the receiving bench, and the tray **away from the picking racks**, near the SPV's desk.

4. **SPV · hub phone → WMS → Rak & bin → Cek label**

   Scan each label once.

   ✓ You see: the WMS names each one. A label that does not scan is printed again.

You can change the number of temporary bins later: add bins, print only the new labels.

### 3.2 Build the racks

The SPV registers each rack **as it physically stands**. There is no rack type to choose: the size of a rack is whatever the hub has, so the SPV counts what fits and enters that.

> **Term · Rack, bay, level, position, stack**
> A **rack** is one shelving unit, named with a letter (A, B, C). A **bay** is a section between two uprights. A **level** is one shelf, counted **from the bottom** (level 1 is the lowest). A **position** is a place for one bin on a level, counted **from the left**. A **stack** is bins on top of each other at one position: B (bottom), M (middle), T (top).

> **Term · Bin code**
> Every bin has a code: `MA5-A1-3-05T` is hub MA5, rack **A**, bay **1**, level **3**, position **05**, **top** bin. The code is on the bin's label; the WMS sends pickers by it.

<!--screen:rack-builder-->

1. **SPV · at the rack**

   Stand the rack where it will stay. Count its bays and levels. On each level, put the empty bins **side by side from the left**, one bin size per level: **small (JX-2)** or **large (JX-4)**. Stack them only if they fit under the level above. Count how many fit across and how many high.

   ✓ You have: for each level, a bin size, a number across and a number high.

2. **SPV · WMS → Rak & bin → Tambah rak**

   The WMS gives the next free letter (A, B …). Enter the number of **bays** and **levels**.

   ✓ You see: the rack drawn from the front, with empty levels.

3. **SPV · the picture → tap a level**

   Choose the **bin size**, then **bins across** and **stacked** as you counted. The WMS refuses a stack higher than the bin type allows (3 small, 2 large).

   ✓ You see: the bins drawn on that level, each with its code.

4. **Repeat step 3 for every level and bay**, then press **Simpan**.

   ✓ You see: the rack on the *Rak & bin* list with its number of bins.

5. **SPV · the rack → Cetak label**

<!--screen:label-sheet-->

   The A4 label sheet opens, in rack order: bay by bay, level 1 first, left to right, bottom bin before top. Print it on A4 sticker paper.

6. **Staff · at the rack**

   Cut along the lines. Stick each label on the **front of its bin**, matching the code to where the bin sits: level 1 at the bottom, positions from the left, B below T. Work one level at a time so no label goes on the wrong bin.

7. **SPV · hub phone → WMS → Rak & bin → Cek label**

   Scan three labels at random.

   ✓ You see: each scan names the same rack, level and position as where the bin actually sits.

Do this for every rack. A rack can grow later: add a bay, a level or bins, and print only the new labels (§3.4.5).

### 3.3 Give each SKU a bin

A SKU needs a bin at a hub before it can be picked there. Ops HQ completes the SKU first (§2.2.6); it then appears on **Perlu rak**.

1. **SPV · WMS → Rak & bin → Perlu rak**

   ✓ You see: each SKU still without a bin at your hub, with its bin size.

2. **SPV · a SKU → Pilih bin**

   The WMS suggests a free bin of the right size, the most comfortable height first (level 3, then 2, 4, 1, 5). **Keep each brand together**, and put **fast movers at levels 2 to 4 nearest the pack bench** *(decided 30 Sep)*. Accept the suggestion or tap another free bin, then **Simpan**.

   ✓ You see: the bin with the SKU's name in the rack picture, and the SKU gone from *Perlu rak*.

Nothing is relabelled: a label names the bin, and the WMS knows which SKU is in it.

#### 3.3.1 Move a SKU to another bin

**When to do it** (the SPV decides):
- the bin is damaged or the rack is being rearranged;
- a SKU now sells much faster (move it to levels 2 to 4 near the pack bench) or much slower (move it higher or lower). Review once a month with the sales of the last 4 weeks;
- a brand's SKUs have spread out and should sit together again;
- the SKU needs a bigger bin size.

Not for a **full** bin: that is the second-bin question (§4.2). Move stock at a **quiet time**, with no orders waiting.

1. **SPV · WMS → Rak & bin → the SKU → Pindah bin**

   Choose the new free bin and press **Simpan**.

   ✓ You see: a task *Pindahkan stok* for staff. Pickers are still sent to the old bin until the move is scanned.

2. **Staff · station → Tugas → Pindahkan stok**

   Scan the **old bin**, scan **each unit** as you take it out, then scan the **new bin** and put the units in, older stock at the front.

   ✓ You see: the old bin empty and free, the stock in the new bin.

3. **SPV · at the rack**

   Check the old bin is really empty.

### 3.4 Layout is configurable **[DECIDED 25 and 30 Sep]**

A hub's layout is **racks → bays → levels → positions → stack**, entered **as the rack physically stands** *(30 Sep)*.

| Part | Set by | Rule |
|---|---|---|
| **Rack** | SPV (or Ops HQ) | A letter per hub; no rack type |
| **Bay** | SPV | A section between uprights, as many as the rack has |
| **Level** | SPV, per bay | Counted from the bottom; **one bin size** per level |
| **Position** | SPV, counted | How many bins actually fit side by side on the level |
| **Stack** | SPV, counted | How many bins sit on top of each other; never more than the bin type's stack limit |

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
- **3.4.7** **The rack builder is a picture first** *(decided 25 Sep)*: a front view, levels chosen by tapping them, a bin size, the bins across and the stack chosen with a tap each. A table of the same numbers is there for Ops HQ, below the picture.
- **3.4.8** **Labels** *(30 Sep)*: every bin, temporary bin and the quarantine tray gets a label printed from the WMS on A4 sticker paper, with cut lines, in the order the bins stand. *Cek label* scans a label and names the location, to check it went on the right bin.

### 3.5 Hub map (Ops HQ)

Every hub in one table: bins used and free, SKUs without a bin, units held, SKUs low, out, or without a reorder number, deliveries on the way, open variances, open problems. Clicking a hub opens its layout map, one square per bin, coloured by stock or by availability.

### 3.6 Open points

- **Label paper.** Which A4 sticker paper to buy, and how many labels per sheet. *Proposal:* plain A4 sticker paper, 3 × 8 labels per sheet, cut by hand along the printed lines.

## 4. Replenishment and thresholds

**Who**: SPV, Ops HQ · **Systems**: WMS, plus WhatsApp or email to the brand · **On dev**: restock requests, variance sign-off, reminders. *Catat pengiriman* fields, units or %, learned bin max: not yet

### 4.1 Restock from the brand, and recording the AWB

> **Term · AWB and Surat Jalan**
> The **AWB** (air waybill) is the courier's tracking number for a delivery. The **Surat Jalan** is the paper delivery note the driver brings: it lists what the brand sent, and staff sign it when they receive. The WMS finds a delivery by its AWB.

> **Term · Restock request**
> A list of SKUs and quantities that Ninja asks the brand to send to one hub, with a reference `RPL-MA5-2610-01`. The WMS drafts it; the SPV checks it and sends it by WhatsApp or email.

1. **SPV · WMS → Pengingat**

   A **restock draft** appears when a SKU falls to its *pesan ulang saat sisa* number. The WMS collects every SKU that needs it into one draft per brand for your hub. *For the very first delivery*, open **Restock ke merek → Buat permintaan**, choose the brand, and the WMS fills every SKU up to *isi sampai*.

   ✓ You see: the draft with a quantity per SKU.

2. **SPV · Restock ke merek → the draft**

   Check the quantities (they fill up to *isi sampai*). Change any that need it; add a SKU by hand if needed.

3. **SPV · Salin teks → WhatsApp or email to the brand's restock contact**

   Paste and send. Then press **Tandai terkirim**.

   ✓ You see: the request marked *Terkirim*; the quantities can no longer change.

4. **SPV · when the brand replies with the shipment · the request → Catat pengiriman**

<!--screen:restock-awb-->

   Enter the **AWB number**, the **Surat Jalan number**, the expected arrival date, and **how many of each SKU the brand is really sending** (it may be fewer than you asked). If the brand gives the expiry date of each SKU, enter it too (§5.5).

5. **SPV · Simpan pengiriman**

   ✓ You see: the request marked *Dikonfirmasi*. Staff can now receive the delivery by that AWB (§5.1). You can correct these details until the goods arrive.

If the goods arrive before you record the AWB, staff start §5.2 and you or Ops HQ link the AWB there.

### 4.2 The second-bin question

<!--screen:second-bin-->

Whenever a SKU gets a second bin at a hub, whether a staffer tapped *Bin penuh* or you added it on *Rak & bin*, the WMS asks why. The answer teaches the WMS how many units fit in one bin (*isi maks. per bin*).

1. **SPV · WMS → Pengingat → Pertanyaan bin kedua**

   ✓ You see: the SKU, its first bin, and how many units are in it now.

2. **SPV · choose the reason**

   **Bin pertama penuh** is the one that matters. Other reasons (promo delivery, bin moved, undo) set nothing.

3. **SPV · if *Bin pertama penuh*: Setuju**

   The WMS proposes the number now in the first bin as the **isi maks. per bin** for that SKU in that bin size.

   ✓ You see: the number saved for this hub, and for every other hub that has no number yet. Ops HQ can change it.

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

The screens use plain Indonesian names with a one-line example under each field (§2.2.6). The letters R, P and S stay only in the code and database.

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

**Who:** staff at the receiving bench, with the hub phone and scanner. **When:** as soon as the brand's driver arrives.

> **Term · Day colour and divider**
> Each delivery goes into its bin **behind a coloured divider**, a plastic card standing across the bin. The colour is the week of delivery (the sticker colour on screen, §5.4); the date and the ED are written on a **white divider**. The picker always takes from the front, the oldest stock.

1. **Staff · at the door, with the driver**

   Check the Surat Jalan names your hub and the brand. Count the **cartons** against the Surat Jalan. Do not sign yet.

2. **Staff · hub phone → WMS station → Barang masuk → scan or type the AWB**

   ✓ You see: what the brand said it sent, per SKU. *AWB ini belum dicatat Ops HQ* means the AWB is unknown: go to §5.2.

3. **Staff · open the first carton · scan each unit**

   The WMS names a **temporary inbound bin** for each SKU (`MA5-IN-01`, `MA5-IN-02` …). Put the unit in that bin.

   ✓ You see: *cocok*, *kurang N* or *lebih N* per SKU while you scan.

4. **Staff · the expiry date (ED)**

   If the brand's data already gave the ED (§4.1), the WMS shows it: check it against the pack. If not, the WMS asks for it at the **first unit of each SKU**: type the month and year printed on the pack. No date, or unreadable: **Tidak ada ED**. Two dates for one SKU: add the second date and scan those units under it.

   ✓ You see: the ED next to the SKU.

   **Flagged (30 Sep):** the aim is that the ED arrives **as data from the brand**, so staff type nothing during receiving. Until the brands confirm (Q15), this step stays.

5. **Staff · when every temporary bin is full · Selesai batch ini**

   Put this batch away (step 6) before counting the rest.

6. **Staff · put away · WMS → Taruh di rak**

<!--screen:putaway-full-->

   For each temporary bin the WMS names the **rack bin**. Take the temporary bin to the rack. Put a new coloured divider behind the stock already there, then the new units behind it, and write the date and ED on the white divider. **Scan the rack bin's label.**

   ✓ You see: the temporary bin empty. The units are **sellable from this scan**.

7. **Staff · if the rack bin is full · Bin penuh**

   The WMS gives you an empty bin of the same size, as near as possible. Put the rest there and scan its label. The SPV is asked later whether the first bin was really full (§4.2); you do not wait.

8. **Staff · Semua barang AWB sudah diterima**

   When everything is in. Write any difference on the Surat Jalan (*kurang 2 LBR-0005*), sign it, give the driver one copy.

   ✓ You see: the receipt closed. Differences go to the SPV (§4.4).

9. **SPV · WMS → Stok untuk Hiryu**

   Type the delivered SKUs into Hiryu (§9.2).

**An unknown barcode**: scan again, holding the pack flat; then type the digits under the barcode (§2.8.4). If the product is really not on the list: photograph it, count it, **Kirim ke Ops HQ**, and leave it in its temporary bin.

### 5.2 If the AWB is not in the WMS

<!--screen:inbound-noawb-->

1. **Staff · WMS says *AWB ini belum dicatat Ops HQ***

   Do not send the driver away.

2. **Staff · same screen**

   Photograph the Surat Jalan, choose the brand, enter the number of cartons, and press **Kirim ke Ops HQ, lalu hitung**.

   ✓ You see: *Ops HQ sudah diberi tahu*. Ops HQ gets a flag at once.

3. **Staff · count while the driver is still there**

   Scan each unit into the temporary bin the WMS names. Sign the Surat Jalan for the **cartons** received. The counted units are **not stock yet**.

4. **Ops HQ (or SPV) · WMS → Pengingat → the delivery**

   Link it to an open restock request, record it as an unplanned delivery from the Surat Jalan, or reject it.

5. **Staff · when Ops HQ has linked it**

   **Taruh di rak** appears: put away as in §5.1 step 6. If Ops HQ rejects the delivery, the goods stay in the temporary bins until they go back to the brand (§8).

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

### 5.5 Expiry dates at receiving **[DECIDED 28 Sep; source flagged 30 Sep]**

- **5.5.1** **Where the date comes from.** The brand is asked to give the ED (expiry date) of each SKU in its shipment data or on the Surat Jalan; the SPV or Ops HQ enters it on *Catat pengiriman* (§4.1). Otherwise staff read it off the pack when they scan the first unit of each SKU at receiving (§5.1). Month and year are enough; *Tidak ada ED* is allowed.
- **5.5.1a** **Flagged** *(30 Sep)*: the aim is **no typing during receiving**. Whether the brands can send the ED as data is not known yet (Q15). Until then the typed step stays as the fallback.
- **5.5.2** **Stored per batch**: a batch is one SKU in one delivery with one ED. A delivery with two EDs for a SKU is two batches. Balances keep the batch, so the WMS knows which bin holds which date.
- **5.5.3** **Used for**: sending the picker to the earliest ED first; the ED shown on putaway, pick and count screens; and a flag **ED dekat** a set number of days before expiry (default 90 days, a setting until the consignment terms say otherwise), so the SPV can ask the brand to take it back.
- **5.5.4** The ED is still written on the white divider in the bin.

### 5.6 Open points

- **The ED as data** *(flagged 30 Sep)*: can the brands send each SKU's expiry date with the shipment, so staff type nothing at receiving (§5.5.1a, Q15)?
- **Receiving hours.** When brands may deliver, and who receives when the SPV is off.
- **Minimum shelf life at receiving.** No rule yet for refusing units that expire soon (for example less than 6 months left). It ties to the *ED dekat* flag (90 days, §5.5.3), Q5 and Q15.
- **Damage found at receiving.** The 24-hour claim rule is there (§5.3.7), but not the staff steps: photo, count it as short, and where the unit goes.
- **The first, large delivery** is accepted as a known risk (§17). A time estimate per 100 units would help plan staff for the first day.

## 6. Pick and pack

**Who**: the packer at the laptop, the picker with the phone · **Systems**: Hiryu first, then the WMS · **On dev**: *Tempel pesanan Grab* (screen 20), guided pick, 10-minute ready-by, 28 Sep. The pack rule and the scheduled lane: not yet

### 6.1 Copy the order from Hiryu

**Who:** the packer at the packing laptop. About 20 seconds of copying, then the pick. Hiryu counts an order **late after 10 minutes**, so the aim is *Mark ready* within **10 minutes** of the order arriving.

> **Term · GM number and Grab order ID**
> The **GM number** (`GM-358`) is Hiryu's short order number, printed big on the packing slip: people use it. The **Grab order ID** is Grab's long reference: the WMS uses it as the key, because GM numbers can repeat.

> **Term · Live Orders and the packing slip**
> **Live Orders** is Hiryu's board of orders in progress, kept open all day on the packing laptop. When an order arrives it plays a sound and the receipt printer prints the **packing slip**, Grab's paper with the GM number and the items. The slip can show the customer's name, so it is never photographed.

<!--screen:hiryu-copy-->

1. **Packer · laptop → Hiryu Live Orders**

   The new-order sound plays and the slip prints. Click the order to open it.

   ✓ You see: the order page, *Order GM-…* at the top.

2. **Packer · the order page · only if it shows Accept**

   The store is on manual acceptance: press **Accept** first.

   ✓ You see: the status changes to ACCEPTED.

3. **Packer · the order page · Raw payload**

   Leave it closed: its button must read **Show**.

4. **Packer · click once on the title *Order GM-…***

   It is plain text, so clicking it does nothing in Hiryu. Do not click near the buttons.

5. **Packer · Ctrl + A, then Ctrl + C**

   ✓ You see: nothing changes on screen. The page is copied.

### 6.2 Paste it into the WMS

<!--screen:paste-->

1. **Packer · laptop → WMS tab → Tempel pesanan Grab**

   Keep this tab open next to Hiryu all day. Click the grey box and press **Ctrl + V**.

   ✓ You see: the GM number, the store, each line with its bin, and a **green tick**: the lines and units match Hiryu's own count. The pasted text itself is never shown or kept.

2. **Packer · check**

   The GM number on screen is the one on the slip.

3. **Packer · Mulai ambil**

   ✓ You see: *GM-358 masuk antrean ambil*. The picker's phone shows the order. Working alone: press **Ambil sendiri sekarang** and pick it yourself.

| The WMS says | Do this |
|---|---|
| *Salinan tidak lengkap* | Go back to Hiryu, click the title, Ctrl + A, Ctrl + C again |
| *Tutup "Raw payload" dulu* | In Hiryu press *Hide* on Raw payload, copy again |
| *Barang belum dihubungkan* | Tell the SPV. Ops HQ connects the item (§2.2.5), then paste again |
| *Pesanan sudah ada* | It was pasted before; nothing to do |
| *Toko ini milik hub lain* | Wrong hub. Tell the SPV |
| *Tekan Accept di Hiryu dulu* | The store is on manual acceptance and the order is not accepted yet. Press **Accept** in Hiryu, then copy again |
| *Pesanan terjadwal* | A scheduled order. It is queued for its time; pick it when the WMS moves it to the top |

### 6.3 Pick

**Who:** the picker, with the hub phone and the scanner.

<!--screen:pick-->

1. **Picker · hub phone → WMS station → Ambil pesanan**

   The next order opens by itself, the one with the least time left first.

   ✓ You see: the first bin, highlighted on its rack and level, the product photo and the number to take.

2. **Picker · at the bin**

   Take the number shown **from the front**, the oldest divider first (§5.4).

3. **Picker · scan every unit**

   ✓ You see: each scan ticks off one unit, then the next bin appears. A **wrong product** stops the pick with both products side by side: put it back and take the right one. If the wrong product was sitting in this bin, tap **Barang ini salah tempat**.

4. **Picker · not there, or not enough**

   Tap **Barang tidak ada** (§8.1).

5. **Picker · after the last unit**

   ✓ You see: *Pesanan selesai diambil*. Take the basket to the pack bench and tap **Serahkan ke meja packing**.

### 6.4 Pack

**Who:** the packer at the pack bench.

> **Term · Ready shelf (rak siap ambil)**
> The shelf **downstairs, next to the handover table**, where packed bags wait for the Grab driver. Bags stand with the GM number facing out.

<!--screen:pack-->

1. **Packer · laptop → WMS → Kemas & serah ke driver → Siap dikemas**

   Find the order. Take the pack the WMS names: **paper bag** or **carton** (§6.10). If it really does not fit, tap **Ganti kemasan** and choose a reason.

2. **Packer · at the bench**

   Pack the items. Put the Hiryu slip in or on the pack with the GM number showing. Two packs: the GM number on both.

3. **Packer · Hiryu first → the order → Mark ready**

   Hiryu tells Grab the bag is ready and takes the units off its own stock. (When Hiryu adds a photo of the packed bag, take it here, before *Mark ready*. The WMS keeps no photos.)

   ✓ You see: the order leaves *Pending packing* on Live Orders.

4. **Packer · then the WMS → Sudah Mark ready di Hiryu**

   Confirm the GM number. The slip is Grab's design and has no code to scan, so this tap is the WMS's record that the order is packed.

   ✓ You see: the order moves to *Menunggu driver*.

5. **Packer · take the bag to the ready shelf downstairs**

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

*Updated 25 September.* **Two packs only: a paper bag and a carton.** No ziplock, no bubble wrap in the logic.

**How the WMS decides, in short.** Before the pick starts, the WMS adds up the order and goes down this list; the first line that fits is the pack it names:

1. **Paper bag** if the items fit in 3.9 L, weigh 3.0 kg or less, none is longer than 27 cm, and there is **at most one** large bottle (150 ml or more).
2. Otherwise a **carton**, if the items fit in 4.0 L, weigh 5.0 kg or less, and none is longer than 25 cm.
3. Otherwise **two packs**: the heavy and large items go into a carton first, the rest into a paper bag, and the order is marked *2 kemasan*.

| Example order | Adds up to | The WMS names |
|---|---|---|
| 2 face washes 100 ml + 1 moisturiser 50 ml | about 0.7 L, 0.4 kg, no large bottle | **Paper bag** |
| 2 cleansers 225 ml (pump bottles) + 1 serum | about 1.3 L, 0.8 kg, **2 large bottles** | **Carton** (two large bottles never go in a bag) |
| 8 cleansers 225 ml + 6 body washes 250 ml | about 5.2 L, 4.6 kg | **Two packs**: too big for one carton, so a carton plus a paper bag |

The packer can change the pack in two taps, with a reason from a list (§6.9.1).

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

**Who:** whoever is at the handover table downstairs, with the second hub phone.

<!--screen:handover-->

1. **Staff · second hub phone → WMS → Kemas & serah ke driver → Menunggu driver**

   ✓ You see: every bag waiting, with how long it has waited. **Amber** means more than 20 minutes.

2. **Staff · the driver arrives**

   Ask for the order number. Find the bag whose slip shows the same **GM number**.

3. **Staff · the numbers match → Ya, sudah diambil driver**

   Confirm, and give the driver the bag.

   ✓ You see: the bag gone from the list. Hiryu updates by itself when Grab sees the pickup.

4. **Staff · the numbers do not match**

   Do not hand over. Ask the driver to check the Grab app; call the SPV if it still does not match.

If Hiryu shows the order as **cancelled**, do not hand it over: press **Dibatalkan di Hiryu** on the order (§8.2) and unpack it.

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

1. **Picker · hub phone → Barang tidak ada**

   Say what you found: **Tidak ada sama sekali**, or set the number with − and +.

   ✓ You see: *Cek dulu di tempat lain*, with any other place the WMS records the SKU (another bin, a temporary inbound bin).

2. **Picker · look there**

   Found it: tap **Ketemu, lanjut ambil**. The pick goes on from that bin.

3. **Picker · still missing → Catat, lalu panggil SPV**

   ✓ You see: *Pesanan harus dibatalkan* with the GM number. Stop picking this order and call the SPV.

4. **SPV · Hiryu first → the order → Cancel order**

   Reason **2001 Item out of stock**.

   ✓ You see: the order CANCELLED in Hiryu.

5. **SPV · on the picker's phone → Sudah dibatalkan di Hiryu**

   Confirm the GM number.

   ✓ You see: the order released. Anything already picked is on **Kembalikan ke rak**.

6. **Staff · WMS station → Kembalikan ke rak → Kerjakan**

   Scan each picked unit back into its bin.

7. **SPV · type that SKU's stock into Hiryu straight away** (§9.2), so Grab stops selling it.

### 8.2 A cancelled order

<!--screen:cancel-->

1. **Anyone · Hiryu shows the order as CANCELLED** (on Live Orders or the order page).

2. **Staff · WMS · open the order** from the pick queue, the pick screen or *Kemas & serah ke driver*, and press **Dibatalkan di Hiryu**.

3. **Staff · check the GM number and confirm**

   ✓ You see: the order gone from the lists. Anything already picked is on **Kembalikan ke rak**.

4. **Staff · a packed bag** · unpack it first.

5. **Staff · WMS station → Kembalikan ke rak → Kerjakan**

   Scan each unit, then the bin the WMS names.

   ✓ You see: each unit back in stock at its bin scan.

6. **Staff · tell the SPV.** Hiryu does not put a cancelled order's units back into its stock, so the SPV types that SKU's stock again (§9.2).

A cancel pressed by mistake: the SPV opens **WMS → Pesanan → the order → Buka lagi**, and the order is pasted again from Hiryu.

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

**Who:** the SPV, at the packing laptop. Each hub has **two stores** (Kahf and Labore): type both.

<!--screen:eod-->

1. **SPV · Hiryu → Live Orders · pick a quiet moment if you can**

   *Pending accept* and *Pending packing* both at **0** is best: then Grab shows the right number at once. If you cannot wait, type anyway: the WMS number already allows for orders in progress, so Hiryu ends up right once they are marked ready.

<!--screen:hiryu-live-->

2. **SPV · WMS → Stok untuk Hiryu**

   ✓ You see: one table per store. Rows to type are **tinted**; each shows **Kode SKU di Hiryu** and the number under **Ketik di Hiryu**.

3. **SPV · Hiryu → Stores → the first store → Stock**

   For each tinted row, find the same **Kode SKU di Hiryu** (printed under the SKU name in Hiryu) and type the number from *Ketik di Hiryu* into **Units on hand**. Press **Save stock**.

<!--screen:hiryu-stock-->

   ✓ You see: Hiryu saves the numbers.

4. **SPV · then the WMS → Sudah disimpan di Hiryu** for that store

   ✓ You see: the rows no longer tinted, with the time you typed.

5. **Repeat steps 3 and 4 for the hub's other store.**

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

A difference found in a count needs **SPV, then Ops HQ, then Ops Head** before the WMS changes the stock. Units found **missing** are taken out of what can be sold at once while the approval runs, so Grab stops selling them. Units found **extra** are added only after the Ops Head approves. After that, type the SKUs into Hiryu (§9.2).

> **Term · Blind count**
> The person counting never sees what the WMS expects. They scan what is really in the bin, so the count is not steered by the system's number.

#### 10.1.1 How to count

1. **SPV · WMS → Hitung stok → Rencana**

   ✓ You see: the bins to count today (cycle and spot counts). Give them out to staff.

2. **Staff · hub phone → WMS station → Hitung stok → scan the bin's label**

   The bin is locked to you while you count; the WMS's number stays hidden.

3. **Staff · scan every unit in the bin, then Selesai**

   ✓ You see: *Cocok*, or a difference.

4. **Staff · a difference → Hitung ulang**

   Count the bin once more. Only then does the WMS show both numbers.

5. **SPV → Ops HQ → Ops Head · WMS → Hitung stok → Hasil**

   Each checks the difference and approves or sends it back with a note, in that order, three different people (§10.2).

   ✓ You see: the stock corrected after the Ops Head's approval.

6. **SPV · type the counted SKUs into Hiryu** (§9.2).

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

1. **Anyone · any WMS screen → Laporkan masalah**

   Choose what happened:

| Choose | When |
|---|---|
| Rusak atau bocor | Broken, crushed, leaking, seal open |
| Kedaluwarsa | Past its date, or too close to sell (the SPV decides) |
| Salah tempat | A product in a bin that is not its own |
| Barang ditemukan | A unit somewhere the WMS does not expect: floor, wrong bin, back of the shelf |
| Kembalian dari driver | The driver brings back an order that was not delivered |
| Lainnya | Anything else |

2. **Same screen · scan or pick the product**, set the number with − and +, add a photo if you can. Never photograph the packing slip: it can show the customer's name.

3. **Put the units in the quarantine tray, then scan the tray's label** (`MA5-KARANTINA`).

   ✓ You see: *Tersimpan di karantina*. The units leave sellable stock straight away and wait for the SPV (§11.2). *Salah tempat* and *Barang ditemukan* skip the tray: the WMS names the right bin, you put the unit there and scan the bin.

### 11.2 Problems and quarantine

<!--screen:exceptions-->

**Who does what**: anyone reports and puts the unit in the tray; the **SPV decides**; **staff** do the physical move. A **write-off** also needs **Ops HQ** and the **Ops Head** to approve, every time.

1. **SPV · WMS → Masalah → the report**

   Look at the photo and the reason. **Tanggungan** shows who bears the cost under that reason (§11.6). Change the reason if the report was wrong.

2. **SPV · decide within 24 hours**

| Decision | Approvals | What happens next | Sellable again |
|---|---|---|---|
| **Kembali ke rak** | SPV | A task *Kembalikan dari karantina* appears for staff | When the bin is scanned |
| **Retur ke merek** | SPV | The unit stays in the tray marked *Menunggu retur* and goes back with the brand's next pickup, on the **return note** (§8.6) | No, it leaves the hub |
| **Hapus stok** (write off) | SPV proposes, Ops HQ approves, Ops Head approves | Staff scan it out as disposed | No |

3. **Staff · WMS station → Tugas → Kembalikan dari karantina**

<!--screen:karantina-task-->

   Take the unit from the tray, scan it, put it in the bin the WMS names, scan the bin.

   ✓ You see: the unit back in sellable stock at the bin scan.

4. **Staff · after the Ops Head approves a write-off → Tugas → Musnahkan**

   Scan the unit out as disposed.

Anything in the tray more than 24 hours without a decision is flagged to the SPV; more than 7 days, to Ops HQ.

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

### 12.1 Devices and who holds them

The pilot hubs pick and pack on the **2nd floor** and hand over at a **table downstairs**. Each device has one job and one place. **Every person signs in with their own account** on whatever device they use (their own Hiryu login and their own WMS Google login), at the start of the shift, and signs out at the end.

<!--screen:hub-devices-->

| Device | Per hub | Lives at | Used for | Held by | Charged |
|---|---|---|---|---|---|
| **Packing laptop** (in the kit) | 1 | Pack bench, upstairs | Hiryu Live Orders, copy and paste into the WMS, *Mark ready*, the SPV's stock typing | The packer on shift; the SPV for stock | Plugged in all day |
| **Receipt printer** (in the kit) | 1 | Next to the laptop | Hiryu packing slips, printed by themselves | Nobody: it runs by itself | Plugged in |
| **A4 printer** (already at the station) | 1 | The station | Labels (§3.1, §3.2), return notes (§8.6), the paper log (§14) | The SPV | Plugged in |
| **Hub phone for picking**, with the WMS installed, and the kit's **wireless 2D scanner** paired to it | 1 + 1 | Carried | Picking, putaway, receiving, counting, *Laporkan masalah* | The picker on shift; passed on at shift change | At the pack bench overnight |
| **Hub phone for handover** (or a tablet) | 1 | Handover table, downstairs | *Kemas & serah ke driver*, the ready shelf | Whoever brings the bag down | At the handover table |

- **One laptop, many people.** The laptop keeps the printer set up whoever signs in, because Hiryu saves the printer per browser, not per person. Only the person at the laptop is signed in; the next person signs out the last one and signs in as themselves.
- **Two people on duty** (the 5-minute target): one picks with the picking phone, one pastes, packs and marks ready at the laptop and carries the bag down. **One person on duty**: they do both, in the same order, and take the picking phone downstairs with them.
- **The ready shelf is downstairs**, next to the handover table, so a driver never waits for someone on the stairs.
- **Wi-Fi must reach both floors.** The picking phone's mobile data is the backup internet (§14.1).
- **At opening** the SPV checks every device is charged, signed out from yesterday, and the scanner is paired (§13).
- **A lost or broken device** is reported to the SPV the same day; the SPV tells Ops HQ, who replaces it.
- **For procurement:** the kit has one laptop, one receipt printer and one scanner per hub. This plan adds **two Android phones per hub** (picking and handover), each with a lanyard or holder and a charger. The procurement session picks these up.

### 12.2 Open points

- **Consumables.** Paper bags, cartons, tape, receipt rolls, A4 sticker paper, day-colour stickers, dividers, bins (JX-2, JX-4), the quarantine tray and paper log forms. Not written: how many each hub holds, who reorders, where they are kept. *Proposal:* a minimum per item per hub, checked in the SPV's weekly routine; the WMS can count bags and cartons used from the pack rule.
- **Infrastructure check before go-live.** Wi-Fi on both floors, power points at the pack bench and the handover table, a UPS or not, racks installed.
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
| The WMS or the internet is down for more than 15 minutes (§14.1) | 1 hour, then check again |
| Not enough people on shift, or an emergency at the hub (power, flood, safety) | 1 hour or 24 hours |

1. **SPV (or Ops HQ if the SPV cannot) · Hiryu first → Dark stores → the hub → Pause this hub on Grab**

   Choose the time and press **Pause**.

   ✓ You see: *Every store in this shop is paused on Grab*, with the time it ends.

2. **SPV · then the WMS → Laporan akhir hari → Masalah hari ini**

   Note the pause and its reason.

3. **To resume early** · the same button in Hiryu, **Resume**.

A pause for **one brand only** is not possible here. To stop one brand, set its SKUs to 0 in the stock typing (§9.3) instead.

### 13.3 End of day

**Who:** the SPV, at the packing laptop, after the last order.

1. **SPV · Hiryu → Orders**

   Set *Dark store* to this hub and *From* and *To* to today. Click the title *Orders*, press **Ctrl + A**, then **Ctrl + C**.

<!--screen:hiryu-orders-->

2. **SPV · WMS → Laporan akhir hari → Cek pesanan → paste**

   ✓ You see: three lists: in Hiryu but not in the WMS; cancelled in Hiryu but open in the WMS; in the WMS but not in Hiryu.

3. **SPV · fix every row**

   An order never pasted: paste it now, or use *Catat pesanan terlewat* if it was already handed over. A cancel nobody pressed: *Dibatalkan di Hiryu* (§8.2). An order the WMS has and Hiryu does not: check the GM number in Hiryu.

4. **SPV · type the stock** (§9.3).

5. **SPV · Masalah hari ini**

   Decide any problem still open, note any hub pause, and leave a note for tomorrow's SPV.

6. **SPV · devices**

   Everyone signs out of Hiryu and the WMS; the phones and the scanner go on charge (§12.1).

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
| **Internet at the hub** | Neither Hiryu nor the WMS loads | Switch the laptop to the **picking phone's mobile data**. If that fails too, call Ops HQ: they pause the hub from the office |
| **Hiryu** | Hiryu will not load; no new orders | Nothing to pick. Call Ops HQ, who contacts the Hiryu team (Shaun Cong) |
| **Power** | Laptop on battery, printer off | Write the GM number on each bag by hand. Keep going on battery; pause the hub if power does not return within 30 minutes |
| **Receipt printer** | No slip | Write the GM number on the bag; order new rolls or report the printer |

**When the WMS is back:**

1. **SPV · WMS → Tempel pesanan Grab → Catat pesanan terlewat**

   Paste every order from the paper log. The WMS takes the stock off without a pick scan and marks it *unscanned*.

2. **SPV · paste any cancels** and press *Dibatalkan di Hiryu* (§8.2).

3. **SPV · WMS → Hitung stok** · plan a **spot count** of every bin written on the paper log (§10.1.1).

4. **SPV · type the stock into Hiryu** (§9.3).

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

As of 30 September 2026. **Dev** = deployed to wms-test--dev for testing (first build, 28 Sep). **Built** = in the app from earlier builds. Nothing here is on production yet.

| Process | On dev or built | Not yet |
|---|---|---|
| 1. Login and user access | Google sign-in, user list | Ops Head role with final approval of variances and write-offs; an SPV adds staff only; only @ninjavan.co accounts |
| 2. Registration and store setup | Dev: *Menu & toko Hiryu* (menu CSV upload, item connections, store map, prices kept) | SKUs made from the menu upload; *Lengkapi data SKU*; one menu per store (items and prices kept per store); brand form; *Unduh daftar item*; barcode confirm scan |
| 3. Racking setup | Racks and bins, one bay; hub map | Racks entered as counted (bays, bins across, stack), no rack type; A4 label sheets with cut lines; *Cek label*; *Pindah bin*; temporary inbound bins; quarantine tray as a location |
| 4. Replenishment and thresholds | Restock requests, variance sign-off, reminders, auto draft | *Buat permintaan* for the first delivery; *Catat pengiriman* fields incl. ED; units or %; learned bin max and the second-bin question; three-step variance |
| 5. Inbound and putaway | Receive by AWB in batches, putaway list, unknown product to HQ | ED per batch; delivery without a recorded AWB; rescan and typed digits before *unknown* |
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

**Next deploys to dev**: (2) registration and roles (Ops Head, @ninjavan.co only), SKUs from the menu upload with *Lengkapi data SKU*, one menu per store, the brand form, racks as counted with label sheets; (3) quarantine and approvals, expiry per batch, packaging, the end-of-day report. The one-click button comes after paste has run in the hubs.

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

**Sixth round, 30 September**

| Topic | Decision |
|---|---|
| Instructions | Every step is a step card: who, where, what to do, what you should see. New terms are explained where they first appear, with the physical work |
| Process map | A clickable map between Part A and Part B, by owner and phase, with a way back from every section |
| Setup order | Hub and users, then racks, then brand, then menu, then SKUs, then link and activate on Grab, then first delivery, opening stock and a test order (§0.4) |
| Menus | One Hiryu menu per store, the second made by copying the first (§2.2.3) |
| SKUs | Made in the WMS from the Hiryu menu upload; stock numbers completed afterwards in bulk (§2.2.5, §2.2.6) |
| Racks | No rack types: the SPV registers each rack as it stands and prints A4 labels with cut lines (§3.2) |
| Accounts | Everyone needs a Ninja Van Google account (@ninjavan.co); a leaver's accounts are closed, never passed on (§1.3.2) |
| Ops Head | Same access as Ops HQ plus the last approval on variances and write-offs; the person is named later (§1.2) |
| Brands | Do not sign in to either system (§1.4.7) |
| Service targets | A proposal for Ops to decide (§0.5) |
| Hiryu errors | Go to Shaun Cong, who owns Hiryu (§2.4.6) |
| Grab listings | Moving the existing Official Store listings is not Ninja's task |
| Expiry dates | Flagged: the aim is to get them as data from the brand, not typed at receiving (§5.5.1a) |

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
| **SKU / menu item** | A SKU is what sits on the shelf; a menu item is what the customer buys. One SKU can be sold as a single and as a pack (§2.2) |
| **Units per sale** | How many units of the SKU one sale of a menu item takes: 1 for a single, 2 for a 2-pack |
| **Bin code** | `MA5-A1-3-05T`: hub, rack and bay, level, position, stack (§3.2) |
| **Label** | Printed from the WMS on A4 sticker paper, cut out and stuck on the front of a bin, tray or temporary bin (§3.1) |
| **AWB** | The courier's tracking number for a delivery; staff receive by it (§4.1) |
| **Surat Jalan** | The paper delivery note the driver brings; staff sign it after counting |
| **Restock request** | `RPL-…`: what Ninja asks a brand to send to one hub (§4.1) |
| **Live Orders** | Hiryu's board of orders in progress, open all day on the packing laptop |
| **Packing slip** | Grab's paper for an order, printed by Hiryu; shows the GM number, and may show the customer's name |
| **Ready shelf** | *Rak siap ambil*: downstairs next to the handover table, where packed bags wait for drivers |
| **Blind count** | A count where the counter does not see the WMS's number (§10.1) |
| **Process map** | The clickable overview of every step by owner and phase, between Part A and Part B |

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
