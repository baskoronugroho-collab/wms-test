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
    role: str
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


class BrandIn(BaseModel):
    code: str
    name: str
    identity_mode: str = "sku_barcode"


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
    open_shelf_levels: list[str] = []


class SlotIn(BaseModel):
    site_id: int
    sku_id: int
    basket_id: int | None = None
    created_during_inbound: bool = False


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


class Receipt(BaseModel):
    id: int
    site_id: int
    brand_id: int | None
    source_type: str
    status: str
    opened_by: str | None
    opened_at: str
    completed_at: str | None = None
    banner: str


class ReceiptScanIn(BaseModel):
    code: str
    qty: int = 1
    idempotency_key: str | None = None


class ReceiptScanResult(BaseModel):
    accepted: bool
    outcome: str = Field(
        description="put_away | unknown_barcode | no_slot | over_capacity | error"
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
    external_ref: str
    site_code: str | None = None
    site_id: int | None = None
    brand_code: str | None = None
    lines: list[OrderLineIn]
    is_test: bool = False


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


class PickTask(BaseModel):
    id: int
    order_id: int
    external_ref: str
    site_id: int
    status: str
    claimed_by: str | None
    is_test: bool
    lines: list[PickLine]


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
    qty_expected: int
    qty_counted: int
    variance: int
    foreign_items: int
    missing_plates: list[str] = []
    needs_recount: bool
    message: str


class VarianceRow(BaseModel):
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
