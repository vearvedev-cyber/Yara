# Supply Chain Module: Architecture & Implementation

**Location**: `apps/supply_chain/`
**Status**: Design. Build after finance Phase 5 (see [ERP plan §6](../../ERP_IMPLEMENTATION_PLAN.md#6-roadmap))
**Depends on**: `apps/core`, `apps/hcm`, `apps/sites`, `apps/audit`. Posts to `apps/finance` through `supply_chain/integrations/finance.py` when the workspace has finance
**Read first**: [ERP plan §2 Design rules](../../ERP_IMPLEMENTATION_PLAN.md#2-design-rules), [Finance §2 Conventions](../finance/FINANCE_MODULE_STRUCTURE.md#2-conventions)
**Source of the domain design**: the standalone SupplyChain_MNG project (single Django app). We keep its workflows and rebuild them to fit this codebase; §13 lists what we deliberately do differently.

---

## Contents
1. [Scope](#1-scope)
2. [Conventions](#2-conventions)
3. [App layout](#3-app-layout)
4. [Models](#4-models)
5. [Stock posting engine](#5-stock-posting-engine)
6. [Workflows](#6-workflows)
7. [Finance integration](#7-finance-integration)
8. [HR and sites integration](#8-hr-and-sites-integration)
9. [Reports](#9-reports)
10. [API](#10-api)
11. [Roles and store scope](#11-roles-and-store-scope)
12. [Testing](#12-testing)
13. [Lessons from SupplyChain_MNG](#13-lessons-from-supplychain_mng)
14. [Migrating data from SupplyChain_MNG](#14-migrating-data-from-supplychain_mng)
15. [Deferred features](#15-deferred-features)

---

## 1. Scope

| Area | What it does |
|---|---|
| Catalogue | Materials, categories, units, min/reorder levels, spare-part links to equipment |
| Lot & serial tracking | Per-material choice of none / lot / serial; expiry dates, quarantine, full trace of where every lot or serial went; extra controls for explosives and other controlled items (§4.11) |
| Warehousing | Warehouse → Store (HQ / SITE / TRANSIT / SCRAP) → Bin |
| Stock ledger | One immutable movement ledger; balances and costs derived from it |
| Stock documents | Goods receipt (GRN), goods issue (incl. PPE), goods return, store transfer, stock adjustment |
| Requisitions | Site requests stock from HQ → approval reserves stock → delivery note moves it |
| Purchasing | Purchase request → (optional) supplier quotes → purchase order → GRN → matched to finance bill |
| Fleet | Vehicles, drivers, compliance due dates, fuel logs, maintenance |
| Equipment | Tools and plant with status, location, service dates, spare parts |

**Out of scope for v1: bidding / tendering.** There are no sealed bids, supplier portal or evaluation committees. Purchasing supports recording supplier quotes against a purchase request, with an optional "minimum quotes over amount X" rule. That covers the usual "three quotes" audit requirement, and the quote tables are shaped so that a tender process can be added later without changing them (§15).

---

## 2. Conventions

Everything in [Finance §2](../finance/FINANCE_MODULE_STRUCTURE.md#2-conventions) applies: `WorkspaceOwned` base, `PROTECT` FKs, lifecycle-only statuses changed by services, immutability after posting, `services/` and `selectors/` layering, registry strings instead of `choices` for extensible lists.

Supply chain specifics:
```python
QuantityField = lambda **kw: models.DecimalField(max_digits=18, decimal_places=4, **kw)   # 4 dp for kg, litres, metres
UnitCostField = lambda **kw: models.DecimalField(max_digits=18, decimal_places=6, **kw)   # 6 dp; values rounded to 2 dp
```
- **Every movement carries a cost from day one**, in base currency, even when the workspace has no finance module. A ledger without costs can never be valued afterwards, so this is the one thing that can't be added later.
- Costing method: **weighted average cost (WAC) per material per workspace**. One average across all stores keeps transfers cost-neutral. Per-store costing can be added later as a setting if a client needs it.
- Quantities are always in the material's **base unit**. Purchase units (e.g. box of 50) convert on the PO/GRN line through `UnitConversion`.

---

## 3. App layout

```
apps/supply_chain/
├─ apps.py                   # registers models with audit; registers 'supply_chain' module
├─ registry.py               # movement types, store types, reason codes, compliance kinds, account roles
├─ models/
│  ├─ settings.py            # SupplyChainSettings
│  ├─ catalogue.py           # UnitOfMeasure, UnitConversion, MaterialCategory, Material
│  ├─ locations.py           # Warehouse, Store, Bin, UserStoreScope
│  ├─ ledger.py              # StockLot, StockMovement, StockBalance, MaterialCost
│  ├─ controls.py            # ControlClassRule
│  ├─ documents.py           # GoodsReceipt(+Line), GoodsIssue(+Line), GoodsReturn(+Line),
│  │                         # StockTransfer(+Line), StockAdjustment(+Line)
│  ├─ requisitions.py        # Requisition(+Line), StockReservation, DeliveryNote(+Line)
│  ├─ purchasing.py          # PurchaseRequest(+Line), SupplierQuote(+Line), PurchaseOrder(+Line), BillMatch
│  ├─ fleet.py               # Vehicle, VehicleComplianceItem, FuelLog, MaintenanceRecord
│  └─ equipment.py           # Equipment, EquipmentSparePart
├─ services/
│  ├─ stock.py               # post_movements(), reverse_movements() (the only writer of the ledger)
│  ├─ documents.py           # post_grn, post_issue, post_return, post_transfer, post_adjustment
│  ├─ requisitions.py        # submit, validate, approve (reserve), reject (release), create_delivery_note
│  ├─ delivery.py            # approve, dispatch, receive
│  ├─ purchasing.py          # approve_pr, record_quote, select_quote, create_po, approve_po, close_po
│  └─ fleet.py               # log_fuel, record_maintenance
├─ selectors/                # stock_on_hand, stock_card, low_stock, dead_stock, in_transit, po_outstanding…
├─ integrations/
│  └─ finance.py             # builds journals for stock events; bill ↔ PO/GRN matching
├─ management/commands/
│  ├─ sc_rebuild_balances.py # rebuilds StockBalance + MaterialCost from the ledger
│  └─ sc_import_supplychain_mng.py
├─ api/                      # serializers, views, permissions, urls
└─ tests/
```

---

## 4. Models

### 4.1 Settings

```python
class SupplyChainSettings(models.Model):
    workspace = models.OneToOneField('core.Workspace', on_delete=models.PROTECT, related_name='supply_chain_settings')
    allow_negative_stock = models.BooleanField(default=False)
    dead_stock_days = models.PositiveSmallIntegerField(default=90)
    requisition_sla_days = models.PositiveSmallIntegerField(default=7)
    quotes_required_over = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)  # null = never
    quotes_required_count = models.PositiveSmallIntegerField(default=3)
    po_approval_over = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)     # second approver
    settings = models.JSONField(default=dict, blank=True)     # {'schema_version': 1, ...}
```

### 4.2 Catalogue

```python
class UnitOfMeasure(WorkspaceOwned):
    code = models.CharField(max_length=20)            # 'EA', 'KG', 'L', 'M', 'BOX'
    name = models.CharField(max_length=50)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'code'], name='uniq_uom')]


class MaterialCategory(WorkspaceOwned):
    name = models.CharField(max_length=100)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='children')
    # Optional account overrides; otherwise the account roles in §7 apply
    inventory_account = models.ForeignKey('finance.Account', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    consumption_account = models.ForeignKey('finance.Account', null=True, blank=True, on_delete=models.PROTECT, related_name='+')


class Material(WorkspaceOwned):
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=200)
    part_number = models.CharField(max_length=100, blank=True)
    category = models.ForeignKey(MaterialCategory, on_delete=models.PROTECT)
    unit = models.ForeignKey(UnitOfMeasure, on_delete=models.PROTECT)      # base unit; never changes once moved
    kind = models.CharField(max_length=20, default='stock')   # 'stock' | 'consumable' | 'ppe' | 'fuel' | 'service' (registry)
    tracking = models.CharField(max_length=10, default='none')  # 'none' | 'lot' | 'serial'; fixed once the material has moved
    has_expiry = models.BooleanField(default=False)             # lots must carry expires_on
    control_class = models.CharField(max_length=20, default='none')  # 'none' | 'explosive' | 'hazardous' (registry, §4.11)
    min_level = QuantityField(default=Decimal('0'))
    reorder_qty = QuantityField(default=Decimal('0'))
    default_tax_code = models.ForeignKey('finance.TaxCode', null=True, blank=True, on_delete=models.PROTECT)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'code'], name='uniq_material_code')]
        indexes = [models.Index(fields=['workspace', 'category']), models.Index(fields=['workspace', 'name'])]


class UnitConversion(WorkspaceOwned):
    material = models.ForeignKey(Material, on_delete=models.PROTECT, related_name='conversions')
    unit = models.ForeignKey(UnitOfMeasure, on_delete=models.PROTECT)
    factor = QuantityField()                           # 1 BOX = 50 EA → factor 50
```
- No stored `quantity` on `Material`. Stock is always the sum of the ledger.
- `tracking` can only change while the material has no movements. Switching an item with stock to tracked means an adjustment out, the change, then an adjustment back in with lots assigned.
- Serial-tracked materials must use a base unit of `EA`.
- `kind='service'` materials can be purchased (POs, bills) but never move stock.
- The FKs to `finance.*` are nullable and only used when finance is enabled. `finance` itself never imports `supply_chain`.

### 4.3 Locations

```python
class Warehouse(WorkspaceOwned):
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=150)
    address = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)


class Store(WorkspaceOwned):
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=150)
    type = models.CharField(max_length=20)            # 'HQ' | 'SITE' | 'TRANSIT' | 'SCRAP' | 'MAGAZINE' | 'QUARANTINE' (registry)
    warehouse = models.ForeignKey(Warehouse, null=True, blank=True, on_delete=models.PROTECT, related_name='stores')
    site = models.ForeignKey('sites.Site', null=True, blank=True, on_delete=models.PROTECT, related_name='stores')
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'code'], name='uniq_store_code'),
            models.CheckConstraint(check=~Q(type='SITE') | Q(site__isnull=False), name='site_store_needs_site'),
        ]


class Bin(WorkspaceOwned):
    store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name='bins')
    code = models.CharField(max_length=30)            # auto '001'.. if blank (per store, via DocumentSequence-style counter)
    zone = models.CharField(max_length=30, blank=True)
    aisle = models.CharField(max_length=30, blank=True)
    rack = models.CharField(max_length=30, blank=True)
    shelf = models.CharField(max_length=30, blank=True)
    is_default = models.BooleanField(default=False)   # used when a document doesn't name a bin
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['store', 'code'], name='uniq_bin_code'),
            models.UniqueConstraint(fields=['store'], condition=Q(is_default=True), name='one_default_bin_per_store'),
        ]
```
- **Every store has exactly one default bin**, created with the store. Documents fall back to it explicitly, instead of "the store's first bin" by whatever ordering happens.
- The **TRANSIT** store type holds stock that's been dispatched but not yet received (§6.3). One transit store per workspace is created at setup.
- SITE stores link to the existing `sites.Site`, and that link is how stock and site costs connect to HR's sites.

### 4.4 Stock ledger

```python
class StockLot(WorkspaceOwned):
    """A batch (tracking='lot') or a single unit (tracking='serial') of one material."""
    material = models.ForeignKey('Material', on_delete=models.PROTECT, related_name='lots')
    number = models.CharField(max_length=100)               # lot/batch number or serial number
    supplier = models.ForeignKey('finance.Contact', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    supplier_reference = models.CharField(max_length=100, blank=True)   # manufacturer batch / certificate no.
    manufactured_on = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)    # required when material.has_expiry
    status = models.CharField(max_length=20, default='AVAILABLE')   # AVAILABLE | QUARANTINE | BLOCKED (registry)
    status_reason = models.CharField(max_length=255, blank=True)
    first_received_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)   # certificates, test results… {'schema_version': 1}

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'material', 'number'], name='uniq_lot_number')]
        indexes = [models.Index(fields=['workspace', 'expires_on']), models.Index(fields=['workspace', 'number'])]
```
- Lots are created when a receipt that carries a new lot or serial number is **posted**, never typed in separately. Every lot therefore has a receipt behind it.
- Where a lot or serial currently is, and how much of it is left, comes from the ledger. `status` only records quality decisions (quarantine, blocked), not location.
- A serial number is unique per material, not across the workspace, because different manufacturers can reuse numbers.

```python
class StockMovement(models.Model):
    """One row = one quantity change in one bin. Signed: +in, -out. Append-only.
    A transfer is two rows sharing a movement_group. Corrections are reversing rows."""
    id = models.BigAutoField(primary_key=True)
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    movement_group = models.UUIDField(db_index=True)       # all rows from one posting share this
    movement_type = models.CharField(max_length=20)        # RECEIPT | ISSUE | RETURN | TRANSFER | ADJUSTMENT (registry)
    date = models.DateField()
    posted_at = models.DateTimeField(auto_now_add=True)
    posted_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')

    material = models.ForeignKey(Material, on_delete=models.PROTECT, related_name='movements')
    lot = models.ForeignKey(StockLot, null=True, blank=True, on_delete=models.PROTECT, related_name='movements')
    bin = models.ForeignKey(Bin, on_delete=models.PROTECT, related_name='movements')
    store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name='+')   # denormalized from bin
    quantity = QuantityField()                              # signed, base unit, never 0; ±1 for serial items
    unit_cost = UnitCostField()                             # base currency, at time of movement
    value = models.DecimalField(max_digits=18, decimal_places=2)   # signed = round(quantity × unit_cost)

    # Where it came from (string refs, same pattern as finance journals)
    source_type = models.CharField(max_length=50)           # 'sc.grn', 'sc.issue', 'sc.delivery_note.dispatch', ...
    source_id = models.CharField(max_length=64)
    source_line_id = models.CharField(max_length=64, blank=True)
    reverses = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='reversed_by')

    # Who/what it was for (dimensions, all nullable)
    site = models.ForeignKey('sites.Site', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    employee = models.ForeignKey('hcm.Employee', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    vehicle = models.ForeignKey('Vehicle', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    equipment = models.ForeignKey('Equipment', null=True, blank=True, on_delete=models.PROTECT, related_name='+')

    class Meta:
        constraints = [models.CheckConstraint(check=~Q(quantity=0), name='sm_nonzero_qty')]
        indexes = [
            models.Index(fields=['workspace', 'material', 'date']),
            models.Index(fields=['workspace', 'bin', 'material']),
            models.Index(fields=['workspace', 'store', 'date']),
            models.Index(fields=['workspace', 'source_type', 'source_id']),
            models.Index(fields=['workspace', 'site', 'date']),
            models.Index(fields=['workspace', 'lot', 'date']),        # lot / serial trace
            models.Index(fields=['workspace', 'employee', 'date']),   # custody, PPE, controlled-item issues
        ]


class StockBalance(models.Model):
    """Cache of Σ movements per (material, bin, lot) + active reservations. Rebuildable: sc_rebuild_balances."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    material = models.ForeignKey(Material, on_delete=models.PROTECT)
    bin = models.ForeignKey(Bin, on_delete=models.PROTECT)
    lot = models.ForeignKey(StockLot, null=True, blank=True, on_delete=models.PROTECT)   # null for untracked materials
    on_hand = QuantityField(default=Decimal('0'))
    reserved = QuantityField(default=Decimal('0'))
    last_movement_at = models.DateTimeField(null=True, blank=True)    # for dead-stock report

    class Meta:
        constraints = [
            # NULLs aren't equal in a unique index, so untracked and tracked rows need separate constraints
            models.UniqueConstraint(fields=['material', 'bin'], condition=Q(lot__isnull=True), name='uniq_balance_untracked'),
            models.UniqueConstraint(fields=['material', 'bin', 'lot'], condition=Q(lot__isnull=False), name='uniq_balance_lot'),
            models.CheckConstraint(check=Q(reserved__gte=0), name='sb_reserved_non_negative'),
        ]

    @property
    def available(self):
        return self.on_hand - self.reserved


class MaterialCost(models.Model):
    """Running weighted average per material. Rebuildable from the ledger in date/id order."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    material = models.OneToOneField(Material, on_delete=models.PROTECT, related_name='cost')
    quantity = QuantityField(default=Decimal('0'))
    value = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    average_unit_cost = UnitCostField(default=Decimal('0'))
```
Why signed rows instead of "from_bin / to_bin" on one row:
- Balance per bin = `SUM(quantity)`, a single index scan, with no CASE logic per movement type.
- A transfer is two rows (−A, +B) at the same cost, so its net value is zero and stock value is unchanged, as it should be.
- It mirrors `JournalLine`, so the same reasoning (grouping, reversal, immutability) applies.

Costing stays weighted average per material, including for lot and serial items. Lots track **where and what**, not a separate cost. If a client later needs serialised tools valued individually, that's a costing setting plus a `unit_cost` on `StockLot` (additive).

### 4.5 Stock documents

All documents share one shape. Header: `number` (assigned at post, sequence per workspace and doc type), `status` DRAFT → POSTED (→ REVERSED), `date`, `notes`, `posted_at/by`, `movement_group`. Lines: `material`, `quantity` (in the line unit) + `unit` + `base_quantity`, `bin`, and for tracked materials `lot` (existing lot) or `new_lot_number` + `new_lot_expires_on` (receipts only). Posted documents are immutable (`ImmutableAfterPostMixin`); corrections reverse the whole document.

Lot rules on lines:
- **Lot-tracked**: one line per lot. Receiving 100 units in two batches is two lines.
- **Serial-tracked**: one line per serial, quantity 1. The UI accepts a list or scan of serials and creates the lines.
- Untracked materials must not have a lot. Tracked materials must have one. The service checks both before posting.

| Document | Prefix | Header fields | Line fields | Movements |
|---|---|---|---|---|
| `GoodsReceipt` (GRN) | `GRN-` | `store`, `supplier` (`finance.Contact`, nullable), `purchase_order` (nullable), `delivery_note_ref` | `po_line` (nullable), `unit_cost` (from PO line, else entered) | +RECEIPT into line bin |
| `GoodsIssue` | `GIS-` | `store`, `purpose` (`site_use`, `ppe`, `maintenance`, `fuel`, `other`), `site`, `employee`, `vehicle`, `equipment` | `bin`, `is_returnable`, `expected_return_date` | −ISSUE from line bin at WAC |
| `GoodsReturn` | `RET-` | `store` (receiving), `returned_by` (employee), `site` | `related_issue_line` (nullable), `condition` (`good` → normal bin, `damaged` → SCRAP store) | +RETURN at the original issue cost (or WAC) |
| `StockTransfer` | `TRF-` | `from_store`, `to_store` | `from_bin`, `to_bin` | −TRANSFER / +TRANSFER, same cost |
| `StockAdjustment` | `ADJ-` | `store`, `reason` (`count`, `damage`, `expiry`, `theft`, `opening_balance`, `correction`) | `bin`, `counted_quantity` or `quantity_change`, `unit_cost` (for increases) | ±ADJUSTMENT |

- **PPE issue isn't a separate model.** It's a `GoodsIssue` with `purpose='ppe'`, where `employee` is required. PPE history on the employee profile is a query on those issues.
- **Returns between stores are `StockTransfer`s.** `GoodsReturn` is only for goods coming back from a person or site use, and it's the only "+ only" document.
- "Allocate material" in the source project (set a bin to an exact quantity) becomes a `StockAdjustment` with `reason='count'`. It needs the storekeeper role and is audited with the reason.

### 4.6 Requisitions, reservations, delivery notes

```python
class Requisition(WorkspaceOwned, ImmutableAfterPostMixin):
    # DRAFT → SUBMITTED → VALIDATED → APPROVED → (CLOSED); REJECTED / CANCELLED
    # 'fulfilled %', 'SLA status', 'days pending' are computed in selectors, never stored
    number = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=20, default='DRAFT')
    site = models.ForeignKey('sites.Site', on_delete=models.PROTECT, related_name='requisitions')
    requested_by = models.ForeignKey('hcm.Employee', on_delete=models.PROTECT, related_name='+')
    source_store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name='+')    # usually HQ
    destination_store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name='+')  # the site's store
    needed_by = models.DateField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    validated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    approved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    decision_notes = models.TextField(blank=True)
    IMMUTABLE_WHEN = ('status', 'APPROVED')


class RequisitionLine(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    requisition = models.ForeignKey(Requisition, on_delete=models.CASCADE, related_name='lines')
    line_no = models.PositiveSmallIntegerField()
    material = models.ForeignKey(Material, on_delete=models.PROTECT)
    quantity_requested = QuantityField()
    quantity_approved = QuantityField(null=True, blank=True)    # approver may reduce
    # delivered / received quantities are computed from DeliveryNoteLine


class StockReservation(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    requisition_line = models.ForeignKey(RequisitionLine, on_delete=models.PROTECT, related_name='reservations')
    material = models.ForeignKey(Material, on_delete=models.PROTECT)
    bin = models.ForeignKey(Bin, on_delete=models.PROTECT)
    lot = models.ForeignKey(StockLot, null=True, blank=True, on_delete=models.PROTECT)   # picked FEFO for tracked items
    quantity = QuantityField()
    status = models.CharField(max_length=20, default='ACTIVE')   # ACTIVE | CONSUMED | RELEASED
    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)


class DeliveryNote(WorkspaceOwned, ImmutableAfterPostMixin):
    # DRAFT → APPROVED → DISPATCHED → RECEIVED (or PARTIALLY_RECEIVED → RECEIVED); CANCELLED before dispatch
    number = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=20, default='DRAFT')
    requisition = models.ForeignKey(Requisition, null=True, blank=True, on_delete=models.PROTECT, related_name='delivery_notes')
    from_store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name='+')
    to_store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name='+')      # always explicit
    driver = models.ForeignKey('hcm.Employee', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    vehicle = models.ForeignKey('Vehicle', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    dispatched_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    received_by = models.ForeignKey('hcm.Employee', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    IMMUTABLE_WHEN = ('status', 'DISPATCHED')
    MUTABLE_AFTER_POST = ('status', 'received_at', 'received_by', 'updated_at')


class DeliveryNoteLine(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    delivery_note = models.ForeignKey(DeliveryNote, on_delete=models.CASCADE, related_name='lines')
    requisition_line = models.ForeignKey(RequisitionLine, null=True, blank=True, on_delete=models.PROTECT)
    material = models.ForeignKey(Material, on_delete=models.PROTECT)
    lot = models.ForeignKey(StockLot, null=True, blank=True, on_delete=models.PROTECT)
    from_bin = models.ForeignKey(Bin, on_delete=models.PROTECT, related_name='+')
    to_bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    quantity_dispatched = QuantityField()
    quantity_received = QuantityField(null=True, blank=True)
    variance_reason = models.CharField(max_length=30, blank=True)   # 'short', 'damaged', 'over' (registry)
```
- `to_store` is always set explicitly when the note is created (defaulting to the requisition's destination store). There's no name-matching fallback.
- Reservations are tied to the **requisition line** and consumed by **delivery note lines that point to that requisition line**.

### 4.7 Purchasing (no bidding)

```python
class PurchaseRequest(WorkspaceOwned):
    # DRAFT → SUBMITTED → APPROVED → ORDERED (all lines on POs) | REJECTED | CANCELLED
    number = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=20, default='DRAFT')
    reason = models.CharField(max_length=30)           # 'requisition_shortfall' | 'reorder' | 'direct' (registry)
    requisition = models.ForeignKey(Requisition, null=True, blank=True, on_delete=models.PROTECT)
    site = models.ForeignKey('sites.Site', null=True, blank=True, on_delete=models.PROTECT)
    needed_by = models.DateField(null=True, blank=True)
    approved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')


class PurchaseRequestLine(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    request = models.ForeignKey(PurchaseRequest, on_delete=models.CASCADE, related_name='lines')
    material = models.ForeignKey(Material, on_delete=models.PROTECT)
    quantity = QuantityField()
    estimated_unit_cost = UnitCostField(null=True, blank=True)


class SupplierQuote(WorkspaceOwned):
    """A quote received from one supplier for a purchase request. Recording quotes is optional
    unless SupplyChainSettings.quotes_required_over applies. One row per supplier, which is also
    the shape a future tender/bid process would use."""
    request = models.ForeignKey(PurchaseRequest, on_delete=models.PROTECT, related_name='quotes')
    supplier = models.ForeignKey('finance.Contact', on_delete=models.PROTECT)
    quote_reference = models.CharField(max_length=100, blank=True)
    quote_date = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    currency = models.CharField(max_length=3)
    total = models.DecimalField(max_digits=18, decimal_places=2)
    lead_time_days = models.PositiveSmallIntegerField(null=True, blank=True)
    is_selected = models.BooleanField(default=False)
    selection_reason = models.TextField(blank=True)    # required when selected quote isn't the cheapest
    # attachment: finance.Attachment on this object


class PurchaseOrder(WorkspaceOwned, ImmutableAfterPostMixin):
    # DRAFT → APPROVED → SENT → CLOSED | CANCELLED   (received / billed % computed)
    number = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=20, default='DRAFT')
    supplier = models.ForeignKey('finance.Contact', on_delete=models.PROTECT, related_name='+')
    selected_quote = models.ForeignKey(SupplierQuote, null=True, blank=True, on_delete=models.PROTECT)
    order_date = models.DateField()
    expected_date = models.DateField(null=True, blank=True)
    delivery_store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name='+')
    currency = models.CharField(max_length=3)
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal('1'))
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    approved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    IMMUTABLE_WHEN = ('status', 'APPROVED')


class PurchaseOrderLine(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name='lines')
    request_line = models.ForeignKey(PurchaseRequestLine, null=True, blank=True, on_delete=models.PROTECT)
    material = models.ForeignKey(Material, on_delete=models.PROTECT)
    description = models.CharField(max_length=500, blank=True)
    quantity = QuantityField()
    unit = models.ForeignKey(UnitOfMeasure, on_delete=models.PROTECT)
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)       # document currency
    tax_code = models.ForeignKey('finance.TaxCode', null=True, blank=True, on_delete=models.PROTECT)
    # received qty = Σ GRN lines; billed qty = Σ BillMatch


class BillMatch(models.Model):
    """Links a finance bill line to the PO line / GRN line it pays for. Lives here so finance
    never imports supply_chain."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    bill_line = models.ForeignKey('finance.BillLine', on_delete=models.PROTECT, related_name='+')
    po_line = models.ForeignKey(PurchaseOrderLine, on_delete=models.PROTECT, related_name='bill_matches')
    grn_line = models.ForeignKey('GoodsReceiptLine', null=True, blank=True, on_delete=models.PROTECT)
    quantity = QuantityField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
```
- **POs never post to the GL.** They are commitments; the accounting events are the GRN and the bill (§7).
- **Three-way match** (PO quantity/price vs GRN quantity vs bill): a selector reports mismatches above a tolerance. Bill posting warns (or blocks, by setting) when a matched bill exceeds what was received.

### 4.8 Fleet

```python
class Vehicle(WorkspaceOwned):
    registration = models.CharField(max_length=20)
    make = models.CharField(max_length=60, blank=True)
    model = models.CharField(max_length=60, blank=True)
    type = models.CharField(max_length=30, blank=True)          # 'truck', 'LDV', 'excavator'… (registry)
    assigned_driver = models.ForeignKey('hcm.Employee', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    site = models.ForeignKey('sites.Site', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    odometer_km = models.PositiveIntegerField(default=0)        # latest reading; history in FuelLog / Maintenance
    status = models.CharField(max_length=20, default='ACTIVE')  # ACTIVE | IN_SERVICE | OUT_OF_SERVICE | DISPOSED
    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'registration'], name='uniq_vehicle_reg')]


class VehicleComplianceItem(WorkspaceOwned):
    """Road tax, fitness, insurance, service due… as rows, so new kinds need no migration."""
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='compliance_items')
    kind = models.CharField(max_length=30)                      # 'road_tax' | 'fitness' | 'insurance' | 'service' (registry)
    reference = models.CharField(max_length=100, blank=True)
    valid_from = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    due_at_km = models.PositiveIntegerField(null=True, blank=True)   # service by distance
    # current item per kind = latest by valid_from; renewals add rows (history kept)


class FuelLog(WorkspaceOwned):
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='fuel_logs')
    date = models.DateField()
    driver = models.ForeignKey('hcm.Employee', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    material = models.ForeignKey(Material, on_delete=models.PROTECT)      # kind='fuel' (diesel, petrol, oil, grease)
    quantity = QuantityField()
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    source = models.CharField(max_length=20)                    # 'own_stock' | 'external'
    goods_issue = models.OneToOneField(GoodsIssue, null=True, blank=True, on_delete=models.PROTECT)  # own_stock
    external_cost = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)       # external
    station = models.CharField(max_length=100, blank=True)


class MaintenanceRecord(WorkspaceOwned):
    vehicle = models.ForeignKey(Vehicle, null=True, blank=True, on_delete=models.PROTECT, related_name='maintenance')
    equipment = models.ForeignKey('Equipment', null=True, blank=True, on_delete=models.PROTECT, related_name='maintenance')
    date = models.DateField()
    kind = models.CharField(max_length=30)                      # 'service' | 'repair' | 'tyres' | 'inspection'
    description = models.TextField()
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    parts_issue = models.OneToOneField(GoodsIssue, null=True, blank=True, on_delete=models.PROTECT)   # own spare parts
    external_cost = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)       # workshop
    supplier = models.ForeignKey('finance.Contact', null=True, blank=True, on_delete=models.PROTECT)
    class Meta:
        constraints = [models.CheckConstraint(
            check=Q(vehicle__isnull=False) | Q(equipment__isnull=False), name='maint_needs_target')]
```
- Fuel from our own tank **posts a goods issue** (`purpose='fuel'`), so the stock actually goes down.
- Maintenance cost comes from its real sources: parts issued from stock (`parts_issue`) and external invoices (finance bill lines tagged with the vehicle). `external_cost` is only for workspaces without finance.
- Total cost of ownership per vehicle is a selector over issues + bills + fuel. Nothing is stored.

### 4.9 Equipment

```python
class Equipment(WorkspaceOwned):
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=200)
    serial_number = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, default='ACTIVE')   # ACTIVE | IN_USE | MAINTENANCE | BROKEN | STORED | DISPOSED
    site = models.ForeignKey('sites.Site', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    store = models.ForeignKey(Store, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    custodian = models.ForeignKey('hcm.Employee', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    service_due_on = models.DateField(null=True, blank=True)
    # later: fixed_asset = FK('finance.FixedAsset') when fixed assets exist
    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'code'], name='uniq_equipment_code')]


class EquipmentSparePart(models.Model):
    """Many-to-many: one spare part can fit several machines."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    equipment = models.ForeignKey(Equipment, on_delete=models.CASCADE, related_name='spare_parts')
    material = models.ForeignKey(Material, on_delete=models.PROTECT, related_name='fits')
    class Meta:
        constraints = [models.UniqueConstraint(fields=['equipment', 'material'], name='uniq_spare_part')]
```

### 4.10 Store scope (model)

```python
class UserStoreScope(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='store_scopes')
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='user_scopes')
    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'store'], name='uniq_store_scope')]
```
Rules are in §11.

### 4.11 Controlled items (explosives, hazardous chemicals)

Materials with `control_class != 'none'` get extra rules on top of lot/serial tracking. The rules are configured per control class, so each client can match the conditions of its own licences and permits. **Confirm the exact requirements with each client's licence conditions and the relevant regulator before go-live.** The defaults below are a starting point, not legal advice.

```python
class ControlClassRule(WorkspaceOwned):
    control_class = models.CharField(max_length=20)                  # 'explosive', 'hazardous'
    requires_tracking = models.CharField(max_length=10, default='lot')   # minimum: 'lot' or 'serial'
    allowed_store_types = models.JSONField(default=list)             # e.g. ['MAGAZINE'] (store type added to registry)
    issue_requires_permit_type = models.ForeignKey('tracking.PermitType', null=True, blank=True,
                                                   on_delete=models.PROTECT)   # e.g. blasting licence
    issue_requires_witness = models.BooleanField(default=True)       # second user confirms issue and return
    return_unused_within_hours = models.PositiveSmallIntegerField(null=True, blank=True)  # e.g. same shift
    max_issue_quantity = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'control_class'], name='uniq_control_rule')]
```

What the services enforce for controlled materials:

| Rule | Where it's checked |
|---|---|
| Stored only in allowed store types (e.g. a `MAGAZINE` store) | Receipts, transfers, delivery notes |
| Issued only to an employee holding a valid permit of the required type (`tracking.Permit`, not expired) | Goods issue post |
| A second, different user witnesses issue and return (`witnessed_by` on the document) | Goods issue / return post |
| Issued quantity per issue is capped | Goods issue post |
| Unused quantity is returned within the window; overdue items are flagged | Celery task → alert + compliance check `stock.controlled_unreturned` |
| Consumption = issued − returned, recorded per lot, per employee, per site | Selector; feeds the register below |
| No negative stock, ever (ignores `allow_negative_stock`) | Posting engine |
| Count adjustments need OPERATIONS_MANAGER approval and a reason | Adjustment post |

Reports for controlled items:
- **Magazine register**: per store, per day, per lot: opening, received, issued (to whom, which permit), returned, closing.
- **Lot trace**: every movement of a lot from receipt to consumption.
- **Unreturned / unreconciled**: issues past the return window.

`GoodsIssue` and `GoodsReturn` get a nullable `witnessed_by = FK(User)` field, used whenever a rule requires it.

---

## 5. Stock posting engine

`services/stock.py` is the **only** code that writes `StockMovement`, `StockBalance` or `MaterialCost`. Every document service calls it.

```python
@dataclass(frozen=True)
class MovementLine:
    material: Material
    bin: Bin
    quantity: Decimal                  # signed, base unit
    lot: StockLot | None = None        # required iff material.tracking != 'none' (new lots created by the caller in the same transaction)
    unit_cost: Decimal | None = None   # required for +RECEIPT/+ADJUSTMENT; None → current WAC
    source_line_id: str = ''
    site: Site | None = None
    employee: Employee | None = None
    vehicle: Vehicle | None = None
    equipment: Equipment | None = None


@transaction.atomic
def post_movements(*, workspace, movement_type, date, source_type, source_id, lines, actor,
                   consume_reservations=()) -> uuid.UUID:
    group = uuid.uuid4()

    # 1. Lock in a stable order to avoid deadlocks between concurrent postings
    keys = sorted({(l.material.pk, l.bin.pk, l.lot.pk if l.lot else 0) for l in lines})
    balances = lock_balances(workspace, keys)              # select_for_update, creating missing rows
    costs = lock_costs(workspace, {k[0] for k in keys})    # select_for_update on MaterialCost

    # 2. Release reservations being consumed (dispatch), before availability checks
    for res in consume_reservations:
        balances[(res.material_id, res.bin_id, res.lot_id or 0)].reserved -= res.quantity
        res.status, res.closed_at = 'CONSUMED', timezone.now()

    rows = []
    for l in lines:
        assert_same_workspace(workspace, l.material, l.bin, l.lot)
        check_lot_rules(l, movement_type)                  # §5.3
        check_control_rules(l, movement_type, context)     # §4.11 (store type, permit, witness, caps)
        bal, cost = balances[(l.material.pk, l.bin.pk, l.lot.pk if l.lot else 0)], costs[l.material.pk]

        if l.quantity > 0:
            unit_cost = l.unit_cost if l.unit_cost is not None else cost.average_unit_cost
            apply_receipt_to_wac(cost, l.quantity, unit_cost)          # §5.1
        else:
            unit_cost = cost.average_unit_cost                         # outflows always at WAC
            new_on_hand = bal.on_hand + l.quantity
            if new_on_hand < bal.reserved and not reservation_covers(l, consume_reservations):
                raise InsufficientStock(l.material, l.bin, available=bal.available, requested=-l.quantity)
            if new_on_hand < 0 and not settings_for(workspace).allow_negative_stock:
                raise InsufficientStock(l.material, l.bin, available=bal.on_hand, requested=-l.quantity)
            apply_issue_to_wac(cost, l.quantity)

        bal.on_hand += l.quantity
        bal.last_movement_at = timezone.now()
        rows.append(StockMovement(workspace=workspace, movement_group=group, movement_type=movement_type,
                                  date=date, posted_by=actor, material=l.material, lot=l.lot,
                                  bin=l.bin, store=l.bin.store,
                                  quantity=l.quantity, unit_cost=unit_cost, value=money(l.quantity * unit_cost),
                                  source_type=source_type, source_id=str(source_id), source_line_id=l.source_line_id,
                                  site=l.site, employee=l.employee, vehicle=l.vehicle, equipment=l.equipment))

    StockMovement.objects.bulk_create(rows)
    save_all(balances.values(), costs.values(), consume_reservations)
    audit.record('stock.movements_posted', metadata={'group': str(group), 'source': f'{source_type}:{source_id}',
                                                     'lines': len(rows)})
    return group
```
- One posting = one `movement_group`, and the whole thing succeeds or fails together. If any line is short, nothing posts.
- **Reversal** (`reverse_movements(group, reason)`) posts the negated rows with `reverses` set, using the **original** unit costs. It's refused if it would make stock negative, e.g. reversing a receipt whose stock has already been issued. The user must reverse the issues first, or post an adjustment instead.
- Transfers pass both lines (−from at WAC, +to at the same cost) in one call.

### 5.1 Weighted average cost
```python
def apply_receipt_to_wac(cost, qty, unit_cost):
    cost.value = money(cost.value + qty * unit_cost)
    cost.quantity += qty
    cost.average_unit_cost = (cost.value / cost.quantity).quantize(Decimal('0.000001')) if cost.quantity > 0 else unit_cost

def apply_issue_to_wac(cost, qty):            # qty negative
    cost.value = money(cost.value + qty * cost.average_unit_cost)
    cost.quantity += qty
    if cost.quantity == 0:
        cost.value = Decimal('0')             # clear rounding residue when stock reaches zero
```
`sc_rebuild_balances` replays the ledger in `(date, id)` order and must produce identical `StockBalance` and `MaterialCost`. A nightly invariant check compares them.

### 5.2 Back-dated postings
Movements are dated, but WAC is maintained in posting order. Back-dating a receipt doesn't revalue issues already posted after that date. That's standard for perpetual WAC and keeps posted costs immutable. The UI warns when the date is earlier than the material's last movement. If the workspace has finance, the date must fall in an open accounting period.

### 5.3 Lot and serial rules
`check_lot_rules` refuses a line when:
- the material is tracked and the line has no lot, or it's untracked and has one;
- the lot belongs to a different material;
- an outflow uses a lot with status `QUARANTINE` or `BLOCKED`, or one past `expires_on` (expired stock can only move to a QUARANTINE or SCRAP store, or be adjusted out);
- a serial item's quantity isn't exactly ±1;
- a serial receipt would make that serial's total on hand across **all** bins greater than 1 (the same serial can't be in two places);
- a receipt has a lot number that already exists with a different expiry date.

**Picking (FEFO).** When a requisition approval or an issue doesn't name a lot, the service picks lots first-expiry-first-out (then oldest receipt), skipping quarantined, blocked and expired lots. The chosen lots are written on the reservation or document line, so the user sees what was picked before dispatching.

**Quarantine.** Setting a lot to `QUARANTINE` blocks outflows from it wherever it is. Optionally the service also proposes a transfer into the QUARANTINE store. Releasing it back to `AVAILABLE` needs OPERATIONS_MANAGER and is audited.

---

## 6. Workflows

### 6.1 Purchasing (no bidding)
```
Requisition shortfall / reorder report / direct
  → PurchaseRequest  DRAFT → SUBMITTED → APPROVED
      (optional) record SupplierQuotes; if total > quotes_required_over, need quotes_required_count
      select a quote (reason required if not the cheapest)
  → PurchaseOrder    DRAFT → APPROVED (second approver above po_approval_over) → SENT
  → GoodsReceipt     against PO lines; partial receipts allowed; over-receipt blocked above tolerance
  → finance Bill     lines matched to PO/GRN lines (BillMatch); price variance handled in §7
  → PO CLOSED when fully received and billed (or closed manually with reason)
```

### 6.2 Direct stock documents
GRN without a PO (cash purchases, donations, opening stock), goods issue, return, transfer and adjustment all go **DRAFT → POSTED** via `post_movements`. Drafts can be edited or deleted; posted documents can only be reversed.

### 6.3 Requisition → delivery note → site store
```
SITE                         HQ STORE                  TRANSIT STORE            SITE STORE
Requisition DRAFT → SUBMITTED → VALIDATED (storekeeper checks)
  → APPROVED ───── reserve per line, bin by bin (FEFO/oldest bin first)
                   shortfall → offer PurchaseRequest for the missing qty
DeliveryNote DRAFT → APPROVED
  dispatch ─────── −TRANSFER (consumes that line's reservations) ──▶ +TRANSFER
               (driver + vehicle recorded on the note and movements)
  receive  ─────────────────────────────── −TRANSFER (qty received) ──▶ +TRANSFER into to_bin
               short / damaged qty → stays in transit until resolved:
                  found → receive later; lost → StockAdjustment (reason 'theft'/'damage') from transit
Requisition CLOSED when every approved line is fully received (or remaining qty cancelled)
```
Why a transit store instead of ISSUE at dispatch and RECEIPT at receipt:
- Stock on the truck still exists and is still ours. ISSUE-then-RECEIPT would expense it and then re-capitalise it in the GL.
- Shortages show up as stock left in transit instead of disappearing silently.
- Partial deliveries and receipts work naturally.

Rejecting or cancelling a requisition releases its ACTIVE reservations. Cancelling remaining quantity releases the remainder.

### 6.4 Consumption at site
A site storekeeper issues from the site store (`GoodsIssue`, `purpose='site_use'`, `site` set). **That** is the moment stock becomes cost, charged to the site. Moving stock to the site store is only a transfer.

---

## 7. Finance integration

Only when the workspace has the `finance` module. `supply_chain/integrations/finance.py` builds journals and calls `finance.services.post_journal`, with idempotency keys `('sc.<doc>', doc.id, 1)`. Posting happens in the same transaction as the stock movements, so stock and GL can't drift.

New account roles, registered by supply_chain in the finance role registry:

| Role | Type |
|---|---|
| `inventory` | ASSET |
| `goods_received_not_invoiced` | LIABILITY |
| `stock_consumption_expense` | EXPENSE |
| `stock_adjustment_expense` | EXPENSE (losses, write-offs; gains credited here too) |
| `purchase_price_variance` | EXPENSE |
| `fuel_expense` | EXPENSE |
| `vehicle_maintenance_expense` | EXPENSE |

`MaterialCategory.inventory_account` / `consumption_account` override the role per category.

| Stock event | Debit | Credit |
|---|---|---|
| GRN (with or without PO) | `inventory` (Σ value) | `goods_received_not_invoiced` |
| Bill matched to GRN | `goods_received_not_invoiced` (GRN value) · `vat_input` · `purchase_price_variance` (bill − GRN value, ±) | `accounts_payable` |
| GRN for cash purchase / no bill expected | `inventory` | bank / `accounts_payable` (chosen on GRN) |
| Goods issue (site use, PPE, other) | `stock_consumption_expense`, line dimension **site** | `inventory` |
| Goods issue for fuel / maintenance | `fuel_expense` / `vehicle_maintenance_expense`, dimension **site** + vehicle in description | `inventory` |
| Goods return (from use) | `inventory` | same expense account as the original issue |
| Transfer (incl. delivery notes) | none (stock value unchanged) | |
| Adjustment down | `stock_adjustment_expense` | `inventory` |
| Adjustment up / opening balance | `inventory` | `stock_adjustment_expense` / `retained_earnings` (opening) |
| Reversal of any of these | `reverse_journal` on the linked journal | |

**Required finance change.** Add a nullable `site = FK('sites.Site')` dimension to `finance.JournalLine` (and to bill and invoice lines, so external costs can be charged to a site). It's additive, and it gives cost per site across payroll, stock and bills.

**Finance enabled later.** Movements already carry cost, so enabling finance posts one **opening stock journal** (Dr `inventory` / Cr `retained_earnings`) from `MaterialCost` values. Journals are posted from that date on.

**GRNI reconciliation.** The GRNI account balance must equal Σ(received value − billed value) for open PO lines. A selector reports it, and a compliance check `stock.grni_reconciles` flags drift.

---

## 8. HR and sites integration

| Link | Behaviour |
|---|---|
| `sites.Site` ↔ SITE `Store` | A site can have one or more stores; the site page shows its stock, requisitions, deliveries and consumption cost |
| `hcm.Employee` as requester, recipient, driver, custodian, receiver | No separate Driver or recipient tables; terminated employees can't be selected for new documents |
| PPE | Employee profile shows PPE issued (`GoodsIssue purpose='ppe'`) with dates; returnable items still outstanding are listed at offboarding |
| Driver licence | Dispatching with a driver checks for a valid driving-licence `tracking.Permit` (if the workspace uses permit tracking); warn or block by setting |
| Site cost | Payroll (by site when payroll posts with a site dimension) + stock consumption + bills → one cost-per-site report |
| Offboarding | Returnable issues and equipment custody for the employee appear on the exit checklist |

---

## 9. Reports

All are selectors over the ledger, so dashboards and reports always agree.

| Report | Source |
|---|---|
| Stock on hand / value by store, bin, category | `StockBalance` + `MaterialCost` |
| Stock card (material history) | `StockMovement` for one material, running balance via window function |
| Lot / serial trace | Every movement of one lot or serial: received from whom, stored where, issued to which employee/site/vehicle, returned, consumed |
| Serial custody | For serialised tools: who currently holds each serial (issued and not returned), since when |
| Expiry | Lots expiring within N days, and expired lots still on hand, by store |
| Magazine register | Controlled items, per store, per day, per lot (§4.11) |
| Low stock | available < `min_level`; suggests PR quantity = `reorder_qty` |
| Dead stock | `last_movement_at` older than `dead_stock_days` |
| In transit | balances in the TRANSIT store, by delivery note and age |
| Requisition fulfilment & SLA | approved vs received quantities; days pending vs `requisition_sla_days` |
| Most requested / most consumed | requisition lines / issue movements by material |
| Stock in vs out | movements by type and period. **Only from `StockMovement`** |
| Open POs, overdue deliveries | PO lines minus GRN lines |
| GRNI | received not billed, by supplier and age |
| Fleet due list | latest `VehicleComplianceItem` per kind expiring within 30 days or due by km |
| Fuel efficiency | litres/km per vehicle from `FuelLog` odometer readings |
| Vehicle / equipment cost | issues + bills + fuel per vehicle/equipment and period |
| Site consumption cost | issue movements by site (+ GL when finance enabled) |

---

## 10. API

Base path `/api/v1/supply-chain/`. Filtered by `request.workspace` and the user's store scope; `403` without the `supply_chain` module.

```
uoms/  categories/  materials/                         CRUD (materials: no delete once moved)
warehouses/  stores/  stores/{id}/bins/                CRUD (no delete once used; deactivate)
stock/balances/          ?store=&bin=&material=&category=&below_min=
stock/movements/         ?material=&store=&site=&type=&date_from=&date_to=&source=
stock/card/{material_id}/
lots/                    GET ?material=&number=&expiring_within=&status=   PATCH {id}/ (status + reason only)
lots/{id}/trace/
control-rules/           CRUD (OWNER, ADMIN, OPERATIONS_MANAGER)
grns/                    CRUD draft   POST {id}/post/ | {id}/reverse/
issues/                  CRUD draft   POST {id}/post/ | {id}/reverse/
returns/                 CRUD draft   POST {id}/post/ | {id}/reverse/
transfers/               CRUD draft   POST {id}/post/ | {id}/reverse/
adjustments/             CRUD draft   POST {id}/post/ | {id}/reverse/
requisitions/            CRUD draft   POST {id}/submit/ | validate/ | approve/ | reject/ | cancel-remaining/
                                      POST {id}/purchase-request/   (shortfall → PR)
delivery-notes/          CRUD draft   POST {id}/approve/ | dispatch/ | receive/ {lines:[{id, qty, reason}]}
purchase-requests/       CRUD draft   POST {id}/submit/ | approve/ | reject/
purchase-requests/{id}/quotes/        CRUD    POST {qid}/select/ {reason}
purchase-orders/         CRUD draft   POST {id}/approve/ | send/ | close/ | cancel/   GET {id}/pdf/
bill-matches/            GET, POST (used by the finance bill screen)
vehicles/  vehicles/{id}/compliance/  fuel-logs/  maintenance/   CRUD
equipment/  equipment/{id}/spare-parts/                           CRUD
store-scopes/            GET, POST, DELETE (OPERATIONS_MANAGER / ADMIN)
reports/<name>/          see §9
```

---

## 11. Roles and store scope

New `WorkspaceMembership` roles: `OPERATIONS_MANAGER`, `STOREKEEPER`, `PROCUREMENT_OFFICER`, `FLEET_OFFICER`. Permissions are in code (`api/permissions.py`):

| Action | Allowed roles |
|---|---|
| Catalogue, warehouses, stores, bins | OWNER, ADMIN, OPERATIONS_MANAGER, STOREKEEPER |
| Post stock documents | OPERATIONS_MANAGER, STOREKEEPER (within store scope) |
| Count adjustments, reversals | OPERATIONS_MANAGER (STOREKEEPER may draft) |
| Create requisitions | any member linked to an employee on the site; SITE storekeepers |
| Validate / approve requisitions | STOREKEEPER validates; OPERATIONS_MANAGER approves |
| Delivery notes | STOREKEEPER, FLEET_OFFICER (dispatch); site STOREKEEPER (receive) |
| Purchase requests | any of the above; approve: OPERATIONS_MANAGER, FINANCE_MANAGER |
| Quotes, purchase orders | PROCUREMENT_OFFICER; approve: OPERATIONS_MANAGER / FINANCE_MANAGER; above `po_approval_over` needs a second, different approver |
| Fleet, equipment | FLEET_OFFICER, OPERATIONS_MANAGER |
| Read all | OWNER, ADMIN, OPERATIONS_MANAGER, AUDITOR |

**Store scope**:
- OWNER, ADMIN, OPERATIONS_MANAGER and AUDITOR ignore scope.
- Every other role with **no** `UserStoreScope` rows sees no stores. Being restricted is the default.
- Lists filter to scoped stores. Posting checks every bin's store against the scope, inside the service, not only in the view.
- A transfer or delivery note needs scope on the store being acted on: the source store to dispatch, the destination store to receive.

Segregation of duties (service rules): the requester can't approve their own requisition or PR. The PO creator can't approve their own PO. The GRN poster can't approve the matched bill.

---

## 12. Testing

| Area | Test |
|---|---|
| Ledger invariant | `StockBalance` and `MaterialCost` equal a replay of `StockMovement` after random document sequences (factory-boy) |
| Concurrency | Two simultaneous issues of the last unit (Postgres): one succeeds, one gets `InsufficientStock` |
| Reservations | Approve reserves per line; dispatch consumes exactly that line's reservations; reject/cancel releases; reserved never negative |
| Transit | Dispatch moves stock to transit at the same value; partial receipt leaves the remainder in transit; GL unchanged by both |
| WAC | Receipts at different costs give the expected average; issues at WAC; zero stock clears residue |
| Reversal | Reversing a GRN whose stock is issued is refused; reversal uses original costs |
| Finance | Every stock event posts the expected journal; GRNI reconciles to open receipts; site dimension is set on issue lines |
| Scope & tenancy | Out-of-scope store can't be listed or posted; workspace A can't touch B's bins/materials |
| Units | PO in BOX, GRN in BOX → ledger in EA via conversion |
| Fuel | Own-stock fuel log decreases stock; external fuel log doesn't |
| Lots | Tracked material without lot refused; untracked with lot refused; FEFO picks earliest expiry and skips quarantined/expired; expired lot can't be issued |
| Serials | Same serial can't be received twice or be in two bins; serial lines must be ±1; trace shows the full custody chain |
| Controlled items | Issue refused without valid permit, without witness, above cap, or into a non-magazine store; unreturned items flagged after the window; negative stock always refused |

---

## 13. Lessons from SupplyChain_MNG

What we keep, and what we deliberately change:

| SupplyChain_MNG | Here | Why |
|---|---|---|
| One `InventoryMovement` ledger, balances per bin | Kept: `StockMovement` + `StockBalance` | Right core design |
| Movement `save()` updates balances; editing a movement re-applies it | Movements immutable; only `services/stock.py` writes; corrections are reversals | Editable history isn't auditable; logic in `save()` is bypassed by bulk ops |
| Quantity only, no cost | Unit cost + value on every movement, WAC | Costs can't be reconstructed later; finance needs them |
| Legacy `StockTransaction`, `MaterialReturn`, `Material.quantity` feeding analytics | Not ported; all reports read `StockMovement` | Analytics showed figures unrelated to real stock |
| Requisition properties in the wrong model (crash) | Computed in selectors, covered by tests | Derived values belong in selectors |
| Reservations matched on the old single-material field | Reservations tied to requisition lines; consumed by DN lines pointing to them | Multi-line requisitions never consumed reservations |
| `RETURN` adds stock only, also used site→HQ | Store-to-store is always `StockTransfer`; `GoodsReturn` only from people/use | Site→HQ returns double-counted stock |
| Dispatch = ISSUE, receive = RECEIPT | Transfer via TRANSIT store | Stock on the truck is still an asset; shortages stay visible |
| Destination store by name match fallback | `to_store` always explicit | Name matching misroutes stock |
| "Store's first bin" fallback | One explicit default bin per store | Implicit ordering is unpredictable |
| `FleetFuelLog.consumable` without stock deduction | Own-stock fuel posts a goods issue | Fuel stock was never reduced |
| Fixed due-date columns on vehicles | `VehicleComplianceItem` rows with history | New compliance kinds need no migration |
| Separate `Driver`, `Project` tables | `hcm.Employee`, `sites.Site` | One person, one site, across HR and stock |
| Django Groups created by signals | Workspace roles + permission map | Matches the rest of the ERP; per-workspace |
| `AuditLog` via `_log_action` | `audit.record` + automatic tracking | One audit trail for the whole ERP |
| Single company | `workspace` on every row | Multi-tenant |
| No suppliers, POs, or link to accounting | Purchasing + GL posting | GRNs had no source and no financial effect |

---

## 14. Migrating data from SupplyChain_MNG

**Situation (Oct 2026)**: SupplyChain_MNG was used online, has since been taken offline, and its stock figures are out of date. So:

- **Stock quantities are not imported.** Old balances don't describe what's on the shelves today, and for controlled items an unverified opening balance is a real problem. Opening stock comes from a **physical count** at go-live, entered as `StockAdjustment` (`reason='opening_balance'`), with lots, serials and expiry dates captured during the count.
- **Master data can be imported**, if a database backup or export of the old system still exists. It saves retyping catalogues. One-time command `sc_import_supplychain_mng --source-dump <file> --workspace <id> --dry-run`:
  1. Materials, categories, units, warehouses, stores, bins, equipment and vehicles. The legacy id is kept in a notes/metadata field.
  2. Drivers and projects are matched to existing `hcm.Employee` / `sites.Site` through a mapping CSV. Unmatched rows stop the import; nothing is guessed.
  3. Vehicle due dates become `VehicleComplianceItem` rows, to be checked against the actual papers.
  4. Materials come in with `tracking='none'`. Set tracking and control class **before** the opening count (it can't change after stock moves).
  5. The dry run prints every mapping and count before anything is written.
- **History stays in the backup.** Old movements, requisitions and delivery notes aren't recreated. If anyone needs them (e.g. an audit query about last year's issues), they're read from the backup, which should be kept somewhere safe and read-only.
- **If no backup exists**, the catalogue is loaded from a spreadsheet template instead (same command, `--source-csv`).

Go-live checklist for supply chain:
1. Load or import catalogue; set `tracking`, `has_expiry` and `control_class` per material.
2. Create warehouses, stores (incl. MAGAZINE and QUARANTINE where needed) and bins; set store scopes.
3. Configure `ControlClassRule`s with the client's licence conditions.
4. Physical count per store → opening balance adjustments (with unit costs, lots, serials, expiries).
5. If finance is enabled: post the opening stock journal (§7) and agree it with the accountant.

---

## 15. Deferred features

All additive to the schema above:

| Feature | How it fits |
|---|---|
| **Bidding / tenders** | `Tender` (on a `PurchaseRequest`) with deadline, sealed flag and evaluation criteria; bids are `SupplierQuote` rows with a `tender` FK plus `EvaluationScore` rows. Supplier portal is a separate auth surface |
| Cycle counting | `StockCount` + lines generating `StockAdjustment` on approval |
| Reorder automation | Celery task creating draft PRs from the low-stock selector |
| Barcode / QR scanning | Mobile API endpoints for issue, receive and count by bin/material code |
| Per-store costing | Setting + `MaterialCost` keyed by (material, store) |
| Fixed assets | `Equipment.fixed_asset` → `finance.FixedAsset` with depreciation journals |
| Supplier performance | Selector over PO dates vs GRN dates, rejection/variance rates |
