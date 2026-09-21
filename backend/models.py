"""Response and request models.

Every endpoint declares one. That is what makes the app self-describing:
FastAPI publishes these field names and types in /openapi.json, which feeds the
Substrait portal's API tab and the API Library other Ninja teams build against.
A bare `return {...}` publishes "object, any fields" — an API nobody can use.
"""
from pydantic import BaseModel, Field


# --- identity ---------------------------------------------------------------

class SiteBrief(BaseModel):
    id: int
    code: str
    name: str
    site_type: str
    is_training: bool


class Me(BaseModel):
    email: str
    name: str
    role: str = Field(description="The effective role: what screens and permissions apply")
    real_role: str | None = Field(default=None, description="The account's own role")
    viewing_as: str | None = Field(default=None, description="Set while a superadmin previews another role")
    locale: str
    default_site_id: int | None
    sites: list[SiteBrief]


class Health(BaseModel):
    status: str
    database: bool


class Ok(BaseModel):
    ok: bool
    message: str | None = None


# --- master data ------------------------------------------------------------

class Brand(BaseModel):
    id: int
    code: str
    name: str
    identity_mode: str
    active: bool
    # Who owns the stock (canonical design): grab, brand (consignment --
    # Wardah, agreed 21 Sep) or ninja (own range).
    default_stock_owner: str = "brand"


class BrandIn(BaseModel):
    code: str
    name: str
    identity_mode: str = "sku_barcode"
    default_stock_owner: str = "brand"


class BrandPatch(BaseModel):
    name: str | None = None
    default_stock_owner: str | None = None
    active: bool | None = None


class Sku(BaseModel):
    id: int
    brand_id: int
    brand_code: str | None = None
    brand_sku_code: str
    name_display: str
    category: str | None = None
    product_line: str | None = None
    unit_size: str | None = None
    price_idr: int | None = None
    unit_cube_cm3: int | None = None
    expiry_tier: str
    identity_mode: str
    label_placement_note: str | None = None
    photo_key: str | None = None
    default_restock_point: int | None = None
    default_full_threshold: int | None = None
    default_safety_stock: int | None = None


class SkuList(BaseModel):
    skus: list[Sku]
    total: int


class SkuIn(BaseModel):
    brand_id: int
    brand_sku_code: str
    name_display: str
    category: str | None = None
    product_line: str | None = None
    unit_size: str | None = None
    price_idr: int | None = None
    unit_cube_cm3: int | None = None
    expiry_tier: str = "stable"
    identity_mode: str | None = None
    label_placement_note: str | None = None
    default_restock_point: int | None = Field(
        default=None,
        description="Required when registering one SKU: at or below this many units "
                    "held at a hub, HQ is alerted to replenish.")
    default_full_threshold: int | None = Field(
        default=None,
        description="Units at which the pick face is full and new stock goes to overflow.")
    default_safety_stock: int | None = Field(
        default=None, description="Optional floor below the restock point: flagged critical.")


class BarcodeCheck(BaseModel):
    barcode: str
    state: str = Field(description="new | already_this_sku | conflict")
    conflict_sku_id: int | None = None
    conflict_sku_name: str | None = None


class BarcodeRegisterIn(BaseModel):
    sku_id: int
    barcodes: list[str]


class BarcodeRegisterResult(BaseModel):
    registered: int
    skipped: int
    checks: list[BarcodeCheck]


# --- scanning ---------------------------------------------------------------

class ScanResolved(BaseModel):
    """One endpoint for both identity modes.

    The caller scans and the server decides what it was looking at, so the
    client never has to know whether a brand is barcoded (PRD §5.1).
    """
    found: bool
    kind: str = Field(description="sku_barcode | unit_plate | unknown")
    code: str
    sku: Sku | None = None
    plate_code: str | None = None
    plate_state: str | None = None
    slot_location_id: int | None = None
    slot_location_code: str | None = None
    qty_on_hand: int | None = None
    message: str | None = None


# --- locations --------------------------------------------------------------

class Site(BaseModel):
    id: int
    code: str
    name: str
    address: str | None = None
    site_type: str
    is_training: bool
    active: bool


class SiteIn(BaseModel):
    code: str
    name: str
    address: str | None = None
    site_type: str = "darkstore"
    is_training: bool = False


class LocationCell(BaseModel):
    location_id: int
    code: str
    position_no: int
    basket_id: int | None = None
    basket_size: str | None = None
    sku_id: int | None = None
    sku_name: str | None = None
    expiry_tier: str | None = None
    qty_on_hand: int = 0
    state: str = Field(description="free | occupied | empty_slot")


class LevelRow(BaseModel):
    level_id: int
    level_no: int
    is_open_shelf: bool
    positions: list[LocationCell]


class RackMapRack(BaseModel):
    rack_id: int
    code: str
    levels: list[LevelRow]


class RackMap(BaseModel):
    site: SiteBrief
    racks: list[RackMapRack]
    slotted: int
    free: int


class GenerateRacksIn(BaseModel):
    rack_codes: list[str] = ["A", "B", "C", "D", "E", "F", "G"]
    level_count: int = 5
    positions_per_level: int = 3
    basket_size: str = "M"
    bin_rows: int = Field(default=1, description="1, or 2 stacked bins at every position (Bottom ...B, Top ...T)")
    open_shelf_levels: list[str] = []


class SlotIn(BaseModel):
    site_id: int
    sku_id: int
    basket_id: int | None = None
    created_during_inbound: bool = False
    slot_role: str = Field(
        default="primary",
        description="primary = the pick face. overflow = storage only; a picker "
                    "is never sent there.",
    )


class Slot(BaseModel):
    id: int
    site_id: int
    sku_id: int
    sku_name: str
    basket_id: int
    location_id: int
    location_code: str
    basket_size: str


class SlotSuggestion(BaseModel):
    recommended_size: str
    reason: str
    location_id: int | None
    location_code: str | None


# --- inbound ----------------------------------------------------------------

class ReceiptIn(BaseModel):
    site_id: int
    brand_id: int | None = None
    source_type: str = "from_brand"
    transfer_reference: str | None = None
    awb: str | None = Field(
        default=None,
        description="The brand's AWB for a replenishment HQ confirmed. Opens the receipt "
                    "with the confirmed quantities as its expectation.")


class ReceiptPatch(BaseModel):
    external_reference: str | None = None


class Receipt(BaseModel):
    id: int
    site_id: int
    brand_id: int | None
    source_type: str
    status: str
    opened_by: str | None
    opened_at: str
    completed_at: str | None = None
    external_reference: str | None = None
    banner: str
    day_color: dict | None = None
    replenishment_id: int | None = None
    replenishment_reference: str | None = None
    surat_jalan_no: str | None = None
    batch_no: int | None = Field(
        default=None, description="Batch 1, 2, 3 ... of one AWB, received as inbound bins allow")
    final_batch: bool | None = Field(
        default=None, description="Set on completion: true when this batch finished the AWB")
    inbound_bins: int | None = Field(
        default=None, description="Most different SKUs this batch can take (the hub's "
                                  "temporary inbound bins); null = not limited")
    batch_skus: int = Field(default=0, description="Different SKUs scanned in this batch so far")


class ReceiptCompleteIn(BaseModel):
    final: bool = Field(
        default=True,
        description="For a receipt against an AWB: false = this batch is done, more of the "
                    "same AWB follows; true = everything on the AWB is in, compare and close.")


class ReceiptRow(Receipt):
    line_count: int = 0
    units: int = 0
    slip_id: int | None = None


class ReceiptList(BaseModel):
    receipts: list[ReceiptRow]
    total: int


class ReceiptUndoIn(BaseModel):
    idempotency_key: str | None = None


class ReceiptUndoResult(BaseModel):
    ok: bool
    sku_name: str
    qty: int
    session_total: int
    message: str


class ReceiptScanIn(BaseModel):
    code: str
    qty: int = 1
    idempotency_key: str | None = None


class ReceiptScanResult(BaseModel):
    accepted: bool
    outcome: str = Field(
        description="put_away | unknown_barcode | no_slot | over_capacity | batch_full | error"
    )
    sku: Sku | None = None
    location_code: str | None = None
    location_id: int | None = None
    qty_in_basket: int | None = None
    session_total: int = 0
    message: str


class ReceiptSummaryLine(BaseModel):
    sku_id: int
    sku_name: str
    qty_expected: int | None
    qty_received: int
    variance: int | None


class ReceiptSummary(BaseModel):
    receipt: Receipt
    lines: list[ReceiptSummaryLine]
    total_units: int
    discrepancy_deadline: str | None = None
    open_sku_requests: int = Field(
        default=0, description="Unknown products from this delivery still with HQ or "
                               "waiting to be put away")


# --- plates (Mode B) --------------------------------------------------------

class PlateRangeIn(BaseModel):
    site_id: int
    count: int = 1000
    prefix: str = "NJ"


class PlateRange(BaseModel):
    id: int
    site_id: int
    prefix: str
    seq_from: int
    seq_to: int
    codes_sample: list[str]


class PlateStock(BaseModel):
    site_id: int
    unbound: int
    in_stock: int
    low: bool


class PlateBindIn(BaseModel):
    site_id: int
    sku_id: int
    plate_code: str
    expiry_date: str | None = None
    idempotency_key: str | None = None


class PlateBindResult(BaseModel):
    accepted: bool
    outcome: str = Field(
        description="bound | already_bound | wrong_site | unknown_plate | no_slot"
    )
    plate_code: str
    sku: Sku | None = None
    location_code: str | None = None
    bound_count: int = 0
    message: str


class Plate(BaseModel):
    plate_code: str
    state: str
    site_id: int
    sku_id: int | None
    sku_name: str | None
    location_code: str | None
    expiry_date: str | None
    bound_at: str | None


# --- outbound ---------------------------------------------------------------

class OrderLineIn(BaseModel):
    sku_code: str | None = None
    barcode: str | None = None
    sku_id: int | None = None
    quantity: int


class OrderIn(BaseModel):
    """Message 1. Every order enters through Hiryu, from any channel
    (canonical design, docs/canonical/qc-oms-wms.html)."""
    external_ref: str
    site_code: str | None = None
    site_id: int | None = None
    brand_code: str | None = None
    lines: list[OrderLineIn]
    is_test: bool = False
    channel: str = Field(default="grab", description="grab | whatsapp | web | instagram")
    delivery_mode: str = Field(
        default="grab_rider",
        description="grab_rider | ninja_rider | third_party | next_day",
    )
    placed_at: str | None = Field(
        default=None, description="When the customer placed it (ISO 8601). Own channels only."
    )
    promised_at: str | None = Field(
        default=None,
        description="Ready-by time. If absent: Grab = received + 15 min; "
                    "own channels = placed + 60 min.",
    )


class OrderRow(BaseModel):
    order_id: int
    external_ref: str
    status: str
    is_test: bool
    channel: str | None = None
    delivery_mode: str | None = None
    created_at: str | None = None
    placed_at: str | None = None
    promised_at: str | None = None
    pick_task_id: int | None = None
    pick_status: str | None = None
    claimed_by: str | None = None
    completed_at: str | None = None
    line_count: int = 0
    units: int = 0
    units_picked: int = 0
    short_lines: int = 0
    remaining_seconds: int | None = None


class OrderList(BaseModel):
    orders: list[OrderRow]
    total: int


class OrderAccepted(BaseModel):
    order_id: int
    external_ref: str
    pick_task_id: int
    status: str
    short_lines: int
    message: str


class PickLine(BaseModel):
    id: int
    sequence_no: int
    sku_id: int
    sku_name: str
    photo_key: str | None
    location_id: int | None
    location_code: str | None
    rack_code: str | None
    level_no: int | None
    qty_required: int
    qty_picked: int
    status: str
    identity_mode: str
    brand_sku_code: str | None = None
    unit_size: str | None = None
    slot_role: str | None = None
    oldest_day_color: dict | None = None


class PickTask(BaseModel):
    id: int
    order_id: int
    external_ref: str
    site_id: int
    status: str
    claimed_by: str | None
    is_test: bool
    lines: list[PickLine]
    created_at: str | None = None
    claimed_at: str | None = None
    age_seconds: int | None = None
    channel: str | None = None
    delivery_mode: str | None = None
    promised_at: str | None = None


class PickTaskList(BaseModel):
    tasks: list[PickTask]


class PickConfirmIn(BaseModel):
    code: str
    qty: int = 1
    idempotency_key: str | None = None


class PickConfirmResult(BaseModel):
    accepted: bool
    outcome: str = Field(description="picked | wrong_sku | plate_error | short | error")
    expected_sku_name: str | None = None
    scanned_sku_name: str | None = None
    qty_picked: int = 0
    line_complete: bool = False
    task_complete: bool = False
    next_line: PickLine | None = None
    message: str


# --- opname -----------------------------------------------------------------

class OpnamePlanIn(BaseModel):
    site_id: int
    name: str | None = None
    rack_codes: list[str] | None = None
    brand_id: int | None = None
    expiry_tier: str | None = None


class OpnameBasket(BaseModel):
    basket_id: int
    location_code: str
    sku_id: int | None
    sku_name: str | None
    photo_key: str | None
    status: str = Field(description="pending | counting | finished")
    claimed_by: str | None = None
    variance: int | None = None


class OpnamePlan(BaseModel):
    id: int
    site_id: int
    name: str | None
    status: str
    total_baskets: int
    counted: int
    variances: int
    created_at: str | None = None
    created_by: str | None = None
    scope: dict = {}


class OpnamePlanDetail(BaseModel):
    plan: OpnamePlan
    baskets: list[OpnameBasket]


class OpnameSessionIn(BaseModel):
    plan_id: int
    basket_id: int


class OpnameSession(BaseModel):
    id: int
    plan_id: int
    basket_id: int
    location_code: str
    sku_id: int | None
    sku_name: str | None
    photo_key: str | None
    identity_mode: str
    qty_counted: int
    claimed_by: str | None
    status: str
    expected_plates: int | None = None


class OpnameScanIn(BaseModel):
    code: str
    idempotency_key: str | None = None


class OpnameScanResult(BaseModel):
    accepted: bool
    outcome: str = Field(
        description="counted | foreign_item | out_of_place | unknown | duplicate"
    )
    qty_counted: int
    message: str


class OpnameFinishIn(BaseModel):
    manual_qty: int | None = None


class OpnameFinishResult(BaseModel):
    qty_expected: int | None = None
    qty_counted: int
    variance: int | None = None
    foreign_items: int
    missing_plates: list[str] = []
    needs_recount: bool
    message: str


class VarianceRow(BaseModel):
    session_id: int | None = None
    recounted: bool = False
    basket_id: int
    location_code: str
    sku_id: int | None
    sku_name: str | None
    qty_expected: int
    qty_counted: int
    variance: int
    value_idr: int
    counted_by: str | None


class VarianceReport(BaseModel):
    plan_id: int
    rows: list[VarianceRow]
    total_variance_units: int
    total_variance_idr: int


class AdjustmentIn(BaseModel):
    session_ids: list[int]
    reason_code: str = "count_correction"


# --- inventory --------------------------------------------------------------

class InventoryRow(BaseModel):
    sku_id: int
    sku_name: str
    brand_code: str
    location_code: str | None
    qty_on_hand: int
    qty_allocated: int
    available: int
    expiry_tier: str
    last_counted_at: str | None = None
    stock_owner: str | None = None
    stocked_since: str | None = None
    restock_point: int | None = None


class InventoryList(BaseModel):
    rows: list[InventoryRow]
    total: int


class MovementRow(BaseModel):
    id: int
    created_at: str
    sku_id: int
    sku_name: str | None
    location_code: str | None
    qty_delta: int
    movement_type: str
    reason_code: str | None
    actor_email: str | None
    plate_code: str | None = None


class MovementList(BaseModel):
    movements: list[MovementRow]


# --- bulk stock upload (Alur A, Option C) ------------------------------------

class StockUploadRowError(BaseModel):
    row_no: int
    message: str


class StockUploadResult(BaseModel):
    ok: bool
    upload_id: int | None = None
    rows_total: int
    rows_committed: int
    errors: list[StockUploadRowError] = []
    message: str


class StockUploadBatch(BaseModel):
    id: int
    filename: str | None
    uploaded_by: str | None
    row_count: int
    created_at: str


class StockUploadBatchList(BaseModel):
    uploads: list[StockUploadBatch]


class StockUploadItem(BaseModel):
    id: int
    upload_id: int
    row_no: int
    site_code: str
    barcode: str
    brand_name: str
    sku_name: str
    location_code: str
    input_date_raw: str | None
    uploaded_by: str | None
    created_at: str


class StockUploadItemList(BaseModel):
    items: list[StockUploadItem]
    total: int


# --- admin: product master data ----------------------------------------------

class ProductMasterRowResult(BaseModel):
    row_no: int
    ok: bool
    message: str


class ProductMasterImportResult(BaseModel):
    rows_total: int
    rows_saved: int
    results: list[ProductMasterRowResult]
    message: str


class ProductMasterItem(BaseModel):
    id: int
    brand_name: str
    product_name: str
    created_at: str


class ProductMasterList(BaseModel):
    items: list[ProductMasterItem]
    total: int


class ProductMasterDeleteIn(BaseModel):
    ids: list[int]


# --- training ---------------------------------------------------------------

class Scenario(BaseModel):
    key: str
    name_id: str
    name_en: str
    teaches: str


class ScenarioList(BaseModel):
    scenarios: list[Scenario]


class TrainingActionIn(BaseModel):
    site_id: int
    scenario: str = "clean"


class TrainingResult(BaseModel):
    ok: bool
    site_code: str
    scenario: str
    fixture: dict
    message: str


class GenerateOrdersIn(BaseModel):
    site_id: int
    count: int = 1
    max_lines: int = 4


class GeneratedOrders(BaseModel):
    created: list[str]
    message: str


class BarcodeSheetRow(BaseModel):
    sku_id: int
    sku_name: str
    barcode: str
    location_code: str | None


class BarcodeSheet(BaseModel):
    site_code: str
    rows: list[BarcodeSheetRow]
    note: str


class ActivityRow(BaseModel):
    actor_email: str | None
    flow: str
    event: str
    created_at: str


class ActivityReport(BaseModel):
    rows: list[ActivityRow]


# --- day colour (FIFO aid) ---------------------------------------------------

class DayColor(BaseModel):
    key: str
    hex: str
    ink: str
    day_id: str
    day_en: str
    date: str
    iso_week: int
    week_parity: str


class DayColorLegend(BaseModel):
    today: DayColor
    week: list[DayColor]
    note: str


# --- putaway slips -----------------------------------------------------------

class PutawaySlipLine(BaseModel):
    sku_id: int
    sku_name: str
    brand_sku_code: str | None = None
    location_code: str | None = None
    rack_code: str | None = None
    level_no: int | None = None
    locations: list[dict] = []
    qty_received: int
    qty_expected: int | None = None
    variance: int | None = None


class PutawaySlip(BaseModel):
    id: int
    slip_no: str
    receipt_id: int
    site_id: int
    site_code: str
    source_type: str
    external_reference: str | None = None
    inbound_date: str
    day_color: DayColor
    received_by: str | None
    total_lines: int
    total_units: int
    lines: list[PutawaySlipLine]
    created_at: str
    discrepancy_deadline: str | None = None


class PutawaySlipBrief(BaseModel):
    id: int
    slip_no: str
    receipt_id: int
    site_code: str
    inbound_date: str
    day_color_hex: str
    day_label: str
    week_parity: str | None = None
    external_reference: str | None = None
    variance_lines: int = 0
    total_lines: int
    total_units: int
    received_by: str | None
    created_at: str


class PutawaySlipList(BaseModel):
    slips: list[PutawaySlipBrief]
    total: int


# --- admin: users ------------------------------------------------------------

class AdminUser(BaseModel):
    id: int
    email: str
    name: str | None
    role: str
    default_site_id: int | None
    locale: str
    active: bool
    site_codes: list[str]
    created_at: str | None = None


class AdminUserList(BaseModel):
    users: list[AdminUser]
    roles: list[str]


class AdminUserIn(BaseModel):
    email: str
    name: str | None = None
    role: str = "staff"
    default_site_id: int | None = None
    locale: str = "id"
    site_ids: list[int] = Field(default_factory=list)


class AdminUserPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    default_site_id: int | None = None
    locale: str | None = None
    active: bool | None = None
    site_ids: list[int] | None = None


# --- admin: sites & racks ----------------------------------------------------

class RackSetting(BaseModel):
    rack_id: int
    code: str
    levels: int
    positions_per_level: int
    locations: int
    occupied: int


class SiteAdmin(BaseModel):
    id: int
    code: str
    name: str
    address: str | None
    site_type: str
    is_training: bool
    active: bool
    racks: list[RackSetting]
    total_locations: int
    occupied_locations: int
    staff_count: int


class SiteAdminList(BaseModel):
    sites: list[SiteAdmin]


class SitePatch(BaseModel):
    name: str | None = None
    address: str | None = None
    active: bool | None = None


# --- test orders (Grab simulator) -------------------------------------------

class ComposeOrderLineIn(BaseModel):
    sku_id: int
    quantity: int = 1


class ComposeOrderIn(BaseModel):
    site_id: int
    lines: list[ComposeOrderLineIn]
    external_ref: str | None = None
    channel: str = "grab"
    delivery_mode: str | None = None


class TestOrderRow(BaseModel):
    order_id: int
    external_ref: str
    status: str
    is_test: bool
    line_count: int
    total_qty: int
    short_lines: int
    pick_task_id: int | None
    pick_status: str | None
    created_at: str
    channel: str | None = None
    delivery_mode: str | None = None
    promised_at: str | None = None


class TestOrderList(BaseModel):
    orders: list[TestOrderRow]


# --- pick queue board (supervisor) ------------------------------------------

class PickQueueCard(BaseModel):
    id: int
    order_id: int
    external_ref: str
    status: str = Field(description="ready | claimed | completed | blocked")
    is_test: bool
    created_at: str
    claimed_at: str | None = None
    completed_at: str | None = None
    age_seconds: int = Field(description="Since the order arrived")
    channel: str = "grab"
    delivery_mode: str = "grab_rider"
    promised_at: str | None = None
    remaining_seconds: int | None = Field(
        default=None, description="Until promised_at; negative once late. The queue sorts on this."
    )
    urgency: str = Field(default="normal", description="normal | ageing | late, against the promise")
    held_seconds: int | None = Field(
        default=None, description="How long the current picker has held it"
    )
    claimed_by: str | None = None
    claimed_by_name: str | None = None
    line_count: int = 0
    total_units: int = 0
    picked_units: int = 0
    short_lines: int = 0
    racks: list[str] = Field(
        default_factory=list, description="Distinct racks the pick touches"
    )


class PickQueueLane(BaseModel):
    key: str
    count: int
    cards: list[PickQueueCard]


class PickQueueBoard(BaseModel):
    site_id: int
    site_code: str
    server_time: str
    lanes: list[PickQueueLane]
    oldest_waiting_seconds: int | None
    thresholds: dict[str, int]


class ReleaseIn(BaseModel):
    reason: str | None = None


class OpnamePlanList(BaseModel):
    plans: list[OpnamePlan]


# --- v2 model: registry, replenishment, short pick, transfers ---------------

class RegistryRow(BaseModel):
    sku_id: int
    sku_name: str
    brand_sku_code: str | None = None
    primary_location_id: int | None = None
    primary_location_code: str | None = None
    overflow_location_id: int | None = None
    overflow_location_code: str | None = None
    full_threshold: int | None = None
    low_threshold: int | None = None
    restock_point: int | None = None
    safety_stock: int | None = None
    below_safety: bool = False
    qty_primary: int = 0
    qty_overflow: int = 0
    qty_total: int = 0
    needs_replenishment: bool = False
    needs_restock: bool = False
    configured: bool = False


class RegistryList(BaseModel):
    rows: list[RegistryRow]
    total: int
    unconfigured: int


class RegistryIn(BaseModel):
    site_id: int
    full_threshold: int | None = None
    low_threshold: int | None = None
    restock_point: int | None = None
    safety_stock: int | None = Field(
        default=None, description="The floor: at or below it the SKU is flagged critical. "
                                  "Must not be above the restock point.")


class RegistryBulkIn(BaseModel):
    site_id: int
    sku_ids: list[int]
    full_threshold: int | None = None
    low_threshold: int | None = None
    restock_point: int | None = None
    safety_stock: int | None = None


class RegistrySuggestion(BaseModel):
    sku_id: int
    basket_size: str
    capacity_units: int
    full_threshold: int
    low_threshold: int
    restock_point: int
    reason: str


class ReplenishmentTask(BaseModel):
    id: int
    site_id: int
    sku_id: int
    sku_name: str
    from_location_code: str | None = None
    to_location_code: str
    qty_suggested: int
    qty_moved: int = 0
    qty_at_pick_face: int = 0
    status: str
    claimed_by: str | None = None
    created_at: str
    age_seconds: int = 0


class ReplenishmentList(BaseModel):
    tasks: list[ReplenishmentTask]
    at_zero: int = Field(description="Pick faces with nothing left — these outrank the rest")


class ReplenishDoneIn(BaseModel):
    qty_moved: int


class RestockRequest(BaseModel):
    id: int
    site_id: int
    sku_id: int
    sku_name: str
    qty_suggested: int
    qty_requested: int | None = None
    status: str
    raised_by: str | None = None
    created_at: str


class RestockList(BaseModel):
    requests: list[RestockRequest]


class ShortPickIn(BaseModel):
    qty_found: int = Field(default=0, description="How many were actually on the shelf")


class ShortPickResult(BaseModel):
    accepted: bool
    qty_found: int
    qty_missing: int
    task_complete: bool
    lines_remaining: int
    message: str


class ShortfallRow(BaseModel):
    id: int
    pick_line_id: int
    sku_id: int
    sku_name: str
    qty_required: int
    qty_found: int
    declared_by: str | None
    status: str
    created_at: str


class ShortfallList(BaseModel):
    rows: list[ShortfallRow]
    by_person: dict[str, int] = Field(
        default_factory=dict,
        description="Declarations per staffer — repeat offenders must be visible",
    )


# --- transfers: the hub to darkstore hop ------------------------------------

class TransferLineIn(BaseModel):
    sku_id: int
    quantity: int


class TransferIn(BaseModel):
    from_site_id: int
    to_site_id: int
    reference: str | None = None
    note: str | None = None
    lines: list[TransferLineIn] = Field(default_factory=list)


class TransferLine(BaseModel):
    sku_id: int
    sku_name: str
    qty_dispatched: int
    qty_received: int
    variance: int | None = None


class Transfer(BaseModel):
    id: int
    reference: str
    from_site_code: str
    to_site_code: str
    status: str
    dispatched_at: str | None = None
    received_at: str | None = None
    total_dispatched: int = 0
    total_received: int = 0
    variance: int = 0
    lines: list[TransferLine] = Field(default_factory=list)


class TransferList(BaseModel):
    transfers: list[Transfer]


# --- POS outbox health ------------------------------------------------------

class OutboxLane(BaseModel):
    message_type: str
    pending: int
    suppressed: int
    sent: int
    failed: int
    last_sent_at: str | None = None


class OutboxHealth(BaseModel):
    push_enabled: bool = Field(
        description="False means shadow mode: every number computed, nothing sent"
    )
    lanes: list[OutboxLane]
    oldest_pending_seconds: int | None = None
    note: str


class AddRackIn(BaseModel):
    code: str
    level_count: int = 5
    positions_per_level: int = 5
    basket_size: str = "M"
    bin_rows: int = Field(default=1, description="1, or 2 stacked bins at every position (Bottom ...B, Top ...T)")


# --- return to shelf --------------------------------------------------------

class ReturnTask(BaseModel):
    id: int
    site_id: int
    sku_id: int
    sku_name: str
    brand_sku_code: str | None = None
    external_ref: str | None = None
    location_id: int | None = None
    location_code: str | None = None
    qty: int
    qty_returned: int
    reason: str
    status: str
    created_at: str | None = None
    age_seconds: int | None = None


class ReturnTaskList(BaseModel):
    tasks: list[ReturnTask]
    open_count: int


class ReturnScanIn(BaseModel):
    code: str
    idempotency_key: str | None = None


class ReturnScanResult(BaseModel):
    ok: bool
    task: ReturnTask
    done: bool
    message: str


# --- rack layout ------------------------------------------------------------

class RackSummary(BaseModel):
    rack_id: int
    code: str
    levels: int
    bins: int
    occupied: int
    units: int
    bins_per_level: list[int] = Field(description="Bottom level first")


class RackSummaryList(BaseModel):
    site: SiteBrief
    racks: list[RackSummary]
    needs_rack: int = Field(description="SKUs this hub carries that have no rack here yet")
    inbound_bins: int | None = Field(
        default=None, description="Temporary inbound bins at the hub (1 bin = 1 SKU per "
                                  "inbound batch); null = not limited")


class InboundBinsIn(BaseModel):
    inbound_bins: int | None = None


class RackBin(BaseModel):
    location_id: int
    code: str
    position_no: int
    bin_row: int = Field(default=1, description="1 = the only or Bottom bin, 2 = the Top bin")
    basket_id: int | None = None
    basket_size: str | None = None
    sku_id: int | None = None
    sku_name: str | None = None
    brand_sku_code: str | None = None
    slot_role: str | None = None
    qty_on_hand: int = 0
    removable: bool = Field(description="Empty and never held stock")


class RackLevel(BaseModel):
    level_id: int
    level_no: int
    is_open_shelf: bool
    bin_rows: int = 1
    removable: bool
    bins: list[RackBin]


class RackHead(BaseModel):
    rack_id: int
    code: str
    site_id: int
    site_code: str
    levels: int
    bins: int
    occupied: int


class RackDetail(BaseModel):
    rack: RackHead
    levels: list[RackLevel] = Field(description="Top level first")


class AddLevelIn(BaseModel):
    bins: int = Field(default=5, description="Positions on the level")
    basket_size: str = "M"
    open_shelf: bool = False
    bin_rows: int = Field(default=1, description="1, or 2 stacked bins at every position (Bottom ...B, Top ...T)")


class BinRowsIn(BaseModel):
    bin_rows: int = Field(description="1, or 2 stacked bins per position (Bottom ...B, Top ...T)")


class AddBinsIn(BaseModel):
    count: int = 1
    basket_size: str = "M"


class BasketPatch(BaseModel):
    basket_size: str


class NeedsRackSku(Sku):
    recommended_size: str
    created_at: str | None = None


class NeedsRackList(BaseModel):
    skus: list[NeedsRackSku]
    total: int


class SkuRackSite(BaseModel):
    site_id: int
    site_code: str
    site_name: str
    is_training: bool
    location_code: str | None = None
    restock_point: int | None = None
    full_threshold: int | None = None


class SkuRackList(BaseModel):
    sites: list[SkuRackSite]


# --- SKU requests from stations ------------------------------------------------

class SkuRequest(BaseModel):
    id: int
    site_id: int
    site_code: str
    site_name: str
    receipt_id: int | None = None
    receipt_reference: str | None = None
    brand_id: int | None = None
    brand_name: str | None = None
    barcode: str | None = None
    qty_counted: int
    photo_key: str | None = None
    note: str | None = None
    status: str = Field(description="open | resolved | rejected | put_away")
    raised_by: str | None = None
    raised_at: str | None = None
    sku_id: int | None = None
    sku_name: str | None = None
    brand_sku_code: str | None = None
    location_id: int | None = None
    location_code: str | None = None
    resolution_note: str | None = None
    resolved_by: str | None = None
    resolved_at: str | None = None
    qty_put_away: int | None = None
    put_away_by: str | None = None
    put_away_at: str | None = None


class SkuRequestList(BaseModel):
    requests: list[SkuRequest]
    counts: dict[str, int]


class SkuRequestResolveIn(BaseModel):
    sku_id: int | None = Field(default=None, description="Match an existing SKU")
    new_sku: SkuIn | None = Field(default=None, description="Or register a new one")
    basket_id: int | None = Field(
        default=None, description="Bin at the requesting station; a free one is chosen "
                                  "when omitted and the SKU has no rack there yet")
    note: str | None = None


class SkuRequestRejectIn(BaseModel):
    note: str


class SkuRequestPutAwayIn(BaseModel):
    qty: int | None = Field(default=None, description="Defaults to the counted quantity")


# --- replenishment to the brand (Surat Jalan) ------------------------------------

class ReplenishmentAlert(BaseModel):
    site_id: int
    site_code: str
    sku_id: int
    brand_id: int
    brand_name: str
    sku_name: str
    brand_sku_code: str | None = None
    qty_total: int
    restock_point: int
    full_threshold: int | None = None
    qty_suggested: int
    safety_stock: int | None = None
    below_safety: bool = False
    open_reference: str | None = Field(
        default=None, description="An open replenishment already asking for this SKU")


class ReplenishmentAlertList(BaseModel):
    alerts: list[ReplenishmentAlert]


class ReplenishmentLineIn(BaseModel):
    sku_id: int
    qty_requested: int | None = None
    qty_confirmed: int | None = None


class ReplenishmentIn(BaseModel):
    site_id: int
    brand_id: int
    lines: list[ReplenishmentLineIn]
    note: str | None = None


class ReplenishmentEditIn(BaseModel):
    lines: list[ReplenishmentLineIn]
    note: str | None = None


class ReplenishmentConfirmIn(BaseModel):
    awb: str
    surat_jalan_no: str | None = None
    eta_date: str | None = Field(default=None, description="YYYY-MM-DD")
    lines: list[ReplenishmentLineIn]


class ReplenishmentLine(BaseModel):
    sku_id: int
    sku_name: str
    brand_sku_code: str | None = None
    photo_key: str | None = None
    qty_requested: int
    qty_confirmed: int | None = None
    qty_received: int | None = None
    variance: int | None = Field(default=None, description="Received minus confirmed")
    qty_final: int | None = Field(default=None, description="The count the SPV stands behind")
    final_note: str | None = None
    qty_billed: int | None = Field(default=None, description="Set once closed: what both sides bill on")


class VarianceLineIn(BaseModel):
    sku_id: int
    qty_final: int | None = None
    note: str | None = None


class VarianceAcknowledgeIn(BaseModel):
    lines: list[VarianceLineIn]


class VarianceSignOffIn(BaseModel):
    note: str | None = None


class Replenishment(BaseModel):
    id: int
    reference: str
    site_id: int
    site_code: str
    site_name: str
    brand_id: int
    brand_name: str
    status: str = Field(description="draft | sent | confirmed | variance_review | "
                                     "variance_signoff | received | cancelled")
    awb: str | None = None
    surat_jalan_no: str | None = None
    eta_date: str | None = None
    note: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    sent_by: str | None = None
    sent_at: str | None = None
    confirmed_by: str | None = None
    confirmed_at: str | None = None
    receipt_id: int | None = None
    receipt_status: str | None = None
    received_at: str | None = None
    acknowledged_by: str | None = None
    acknowledged_at: str | None = None
    signed_off_by: str | None = None
    signed_off_at: str | None = None
    review_note: str | None = None
    has_variance: bool = False
    lines: list[ReplenishmentLine]
    total_requested: int
    total_confirmed: int
    total_received: int
    batches: int = Field(default=0, description="Inbound batches received against it so far")
    auto_created: bool = False


class BrandReplenishmentList(BaseModel):
    replenishments: list[Replenishment]


# --- reminders and flags -----------------------------------------------------------

class ReminderRule(BaseModel):
    key: str
    label_id: str
    label_en: str
    unit_id: str | None = None
    unit_en: str | None = None
    enabled: bool
    value: int | None = None
    updated_by: str | None = None
    updated_at: str | None = None


class ReminderRuleList(BaseModel):
    rules: list[ReminderRule]


class ReminderRuleIn(BaseModel):
    enabled: bool
    value: int | None = None


class Flag(BaseModel):
    kind: str = Field(description="stock_critical | below_restock | draft_unsent | sent_unconfirmed | "
                                  "delivery_overdue | variance_open | sku_request_open | needs_rack | "
                                  "slow_mover")
    severity: str = Field(description="critical | warn | info")
    site_id: int
    site_code: str
    title_id: str
    title_en: str
    detail_id: str
    detail_en: str
    link: str = Field(description="Console page that resolves it")
    ref: str | None = None
    age_hours: int | None = None


class FlagList(BaseModel):
    flags: list[Flag]
    counts: dict[str, int]


# --- Ops HQ monitoring -------------------------------------------------------------

class HubOverview(BaseModel):
    site_id: int
    site_code: str
    site_name: str
    is_training: bool
    racks: int
    bins: int
    bins_used: int
    bins_free: int
    needs_rack: int = Field(description="Registered SKUs this hub carries with no rack yet")
    skus_racked: int
    units: int
    skus_low: int = Field(description="Held at or below the restock point, above zero")
    skus_critical: int = Field(default=0, description="Held at or below safety stock, above zero")
    skus_out: int = Field(description="Racked with nothing held")
    skus_unset: int = Field(description="Racked with no restock point")
    deliveries_incoming: int
    variances_open: int


class HubOverviewList(BaseModel):
    hubs: list[HubOverview]


class LayoutBin(BaseModel):
    location_id: int
    code: str
    position_no: int
    bin_row: int = 1
    basket_id: int | None = None
    basket_size: str | None = None
    sku_id: int | None = None
    sku_name: str | None = None
    brand_sku_code: str | None = None
    photo_key: str | None = None
    slot_role: str | None = None
    qty_here: int = 0
    qty_total: int = Field(default=0, description="This SKU across rack and overflow at the hub")
    restock_point: int | None = None
    full_threshold: int | None = None
    safety_stock: int | None = None
    status: str = Field(description="empty | ok | low | critical | out | unset")


class LayoutLevel(BaseModel):
    level_id: int
    level_no: int
    bin_rows: int = 1
    bins: list[LayoutBin]


class LayoutRack(BaseModel):
    rack_id: int
    code: str
    levels: list[LayoutLevel] = Field(description="Top level first")


class LayoutMap(BaseModel):
    site: SiteBrief
    racks: list[LayoutRack]
    counts: dict[str, int]
    needs_rack: int
