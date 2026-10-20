# Finance Module: Structure & Implementation

**Location**: `apps/finance/`
**Status**: Design. Build starts in roadmap Phase 2
**Depends on**: `apps/core`, `apps/audit`; reads `apps/payroll` and `apps/hcm` through `finance/integrations/`
**Read first**: [ERP_IMPLEMENTATION_PLAN.md §2 Design rules](../../ERP_IMPLEMENTATION_PLAN.md#2-design-rules)

---

## Contents
1. [Scope by phase](#1-scope-by-phase)
2. [Conventions](#2-conventions)
3. [App layout](#3-app-layout)
4. [Models](#4-models)
5. [Posting engine](#5-posting-engine)
6. [Posting rules](#6-posting-rules)
7. [Payroll integration](#7-payroll-integration)
8. [Reports](#8-reports)
9. [API](#9-api)
10. [Permissions](#10-permissions)
11. [Testing](#11-testing)
12. [Deferred features](#12-deferred-features)

---

## 1. Scope by phase

| Phase | Models | Outcome |
|---|---|---|
| 2: Ledger core | `FinanceSettings`, `FiscalYear`, `AccountingPeriod`, `Account`, `AccountRole`, `DocumentSequence`, `JournalEntry`, `JournalLine` | Manual journals, trial balance, general ledger |
| 3: Payroll | (no new models) `integrations/payroll.py` | Payroll periods post to the GL |
| 4: Sales | `Contact`, `TaxCode`, `Invoice`, `InvoiceLine`, `Payment`, `PaymentAllocation` | Invoices, credit notes, receipts, AR aging, P&L, balance sheet |
| 5: Purchases & bank | `Bill`, `BillLine`, `BankAccount`, `BankReconciliation`, `ExpenseCategory`, `ExpenseClaim`, `ExpenseLine`, `Attachment` | Bills, payments made, WHT, reconciliation, expense claims |
| Later | `Quote`, `PurchaseOrder`, `FiscalSubmission`, `ExchangeRate`, `AccountBalanceSnapshot` | See §12. All additive |

---

## 2. Conventions

### 2.1 Money
```python
# apps/finance/money.py
from decimal import Decimal, ROUND_HALF_UP

MONEY_PLACES = Decimal('0.01')

def money(value) -> Decimal:
    """The only way to round money. Never pass a float."""
    if isinstance(value, float):
        raise TypeError('Use Decimal or str for money, not float')
    return Decimal(value).quantize(MONEY_PLACES, rounding=ROUND_HALF_UP)

def MoneyField(**kwargs):
    return models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'), **kwargs)

def RateField(**kwargs):        # exchange rates
    return models.DecimalField(max_digits=18, decimal_places=6, default=Decimal('1'), **kwargs)

def QuantityField(**kwargs):
    return models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('1'), **kwargs)
```
- Tax is rounded **per line**, then summed. That rule matches what's printed on the invoice.
- Currency codes are ISO 4217 strings (`CharField(max_length=3)`), validated in code, with **no `choices`**. Adding a currency needs no migration.

### 2.2 Multi-currency
- Every document has `currency` and `exchange_rate` (units of base currency per 1 unit of document currency; `1` when equal).
- `JournalLine.debit`/`credit` are always in **base currency** (ZMW). `JournalLine.amount_currency` + `currency` keep the original amount.
- The rate is fixed on the document when it's issued or posted and is never changed.

### 2.3 Tenancy and base model
```python
# apps/finance/models/base.py
class WorkspaceOwned(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        abstract = True
```
- Every finance table has its own `workspace` column, including child tables like `JournalLine`. It's denormalized for indexing and for tenant checks.
- Services check that every related object (account, contact, tax code) has the same `workspace_id`. A `clean()` helper `assert_same_workspace(*objs)` is shared.
- `PROTECT` everywhere: a workspace with books can only be deactivated, never deleted.
- Viewsets always filter on `request.workspace`; there's a shared `WorkspaceScopedViewSetMixin`.

### 2.4 Status fields
- Statuses are `models.TextChoices` with `max_length=20` so new states can be added.
- Statuses describe the **lifecycle only** (DRAFT → ISSUED → VOID). Derived states ("paid", "overdue", "partially paid") are computed in selectors and never stored.
- Status changes happen only through service functions (`issue_invoice`, `void_invoice`), never through `PATCH status=`.

### 2.5 Immutability
Once a journal is POSTED or a document is ISSUED/POSTED:
- `save()` refuses to change protected fields (shared `ImmutableAfterPostMixin`, see §5.3).
- `delete()` refuses.
- APIs expose only actions (reverse, void, credit).
- On Postgres, a trigger blocks `UPDATE`/`DELETE` of journal lines where `OLD.is_posted` is true, as a second guard. The one-time `is_posted False → True` flip during posting is still allowed. It's a migration `RunSQL`, skipped on SQLite.

### 2.6 Where code goes
- `models/`: fields, constraints, trivial properties. No cross-model business logic in `save()`.
- `services/`: every write that has business meaning; wrapped in `transaction.atomic()`.
- `selectors/`: every read used by more than one view (balances, aging, statements). Dashboards reuse these.
- `serializers.py`: shape and input validation only.

---

## 3. App layout

```
apps/finance/
├─ apps.py
├─ money.py
├─ registry.py              # account role keys, source types, sequence keys
├─ models/
│  ├─ __init__.py
│  ├─ base.py               # WorkspaceOwned, ImmutableAfterPostMixin
│  ├─ settings.py           # FinanceSettings, FiscalYear, AccountingPeriod, DocumentSequence
│  ├─ accounts.py           # Account, AccountRole
│  ├─ journals.py           # JournalEntry, JournalLine
│  ├─ contacts.py           # Contact
│  ├─ tax.py                # TaxCode
│  ├─ sales.py              # Invoice, InvoiceLine
│  ├─ purchases.py          # Bill, BillLine
│  ├─ payments.py           # Payment, PaymentAllocation
│  ├─ bank.py               # BankAccount, BankReconciliation
│  ├─ expenses.py           # ExpenseCategory, ExpenseClaim, ExpenseLine
│  └─ attachments.py        # Attachment
├─ services/
│  ├─ journals.py           # post_journal, reverse_journal
│  ├─ sequences.py          # next_number
│  ├─ sales.py              # issue_invoice, void_invoice, create_credit_note
│  ├─ purchases.py
│  ├─ payments.py
│  ├─ expenses.py
│  └─ setup.py              # setup_workspace (CoA template, roles, fiscal year)
├─ selectors/
│  ├─ balances.py           # account_balance, trial_balance
│  ├─ statements.py         # profit_and_loss, balance_sheet
│  └─ aging.py              # ar_aging, ap_aging, invoice_payment_status
├─ integrations/
│  └─ payroll.py            # post_payroll_period
├─ fixtures/coa/
│  └─ zm_sme_v1.json        # chart-of-accounts template (versioned)
├─ management/commands/
│  ├─ finance_setup_workspace.py
│  └─ finance_check_invariants.py
├─ api/
│  ├─ serializers.py
│  ├─ views.py
│  ├─ permissions.py
│  └─ urls.py
├─ admin.py                 # read-only for posted data
└─ tests/
```

---

## 4. Models

### 4.1 Settings, fiscal years, periods, sequences

```python
class FinanceSettings(models.Model):
    workspace = models.OneToOneField('core.Workspace', on_delete=models.PROTECT, related_name='finance_settings')
    base_currency = models.CharField(max_length=3, default='ZMW')       # locked once any journal is posted
    fiscal_year_start_month = models.PositiveSmallIntegerField(default=1)
    tpin = models.CharField(max_length=10, blank=True)
    vat_registered = models.BooleanField(default=False)
    vat_registration_date = models.DateField(null=True, blank=True)
    coa_template = models.CharField(max_length=50, blank=True)          # e.g. 'zm_sme_v1', for traceability
    settings = models.JSONField(default=dict, blank=True)               # thresholds etc. {'schema_version': 1, ...}
    updated_at = models.DateTimeField(auto_now=True)


class FiscalYear(WorkspaceOwned):
    name = models.CharField(max_length=20)                 # 'FY2026'
    start_date = models.DateField()
    end_date = models.DateField()
    is_closed = models.BooleanField(default=False)
    closing_journal = models.OneToOneField('JournalEntry', null=True, blank=True,
                                           on_delete=models.PROTECT, related_name='+')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'start_date'], name='uniq_fy_start')]


class AccountingPeriod(WorkspaceOwned):
    class Status(models.TextChoices):
        OPEN = 'OPEN'
        CLOSED = 'CLOSED'      # reopenable by FINANCE_MANAGER
        LOCKED = 'LOCKED'      # permanent (after filing / audit)

    fiscal_year = models.ForeignKey(FiscalYear, on_delete=models.PROTECT, related_name='periods')
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'start_date'], name='uniq_period_start')]
        indexes = [models.Index(fields=['workspace', 'start_date', 'end_date'])]


class DocumentSequence(models.Model):
    """Gap-free numbering per workspace and key. Incremented under row lock."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT)
    key = models.CharField(max_length=30)                   # 'journal', 'invoice', 'credit_note', 'bill', 'payment'
    prefix = models.CharField(max_length=20, default='')    # 'INV-'
    include_year = models.BooleanField(default=True)        # INV-2026-000123
    padding = models.PositiveSmallIntegerField(default=6)
    reset_yearly = models.BooleanField(default=True)
    current_year = models.PositiveSmallIntegerField(null=True, blank=True)
    next_value = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'key'], name='uniq_sequence')]
```
- Numbers are assigned **only at issue/post time**, inside the posting transaction (`select_for_update`). A rolled-back post consumes no number, so issued documents have no gaps.
- Drafts are identified by `id`, not by number.

### 4.2 Chart of accounts

```python
class Account(WorkspaceOwned):
    class Type(models.TextChoices):
        ASSET = 'ASSET'
        LIABILITY = 'LIABILITY'
        EQUITY = 'EQUITY'
        REVENUE = 'REVENUE'
        EXPENSE = 'EXPENSE'

    code = models.CharField(max_length=20)
    name = models.CharField(max_length=150)
    type = models.CharField(max_length=20, choices=Type.choices)
    subtype = models.CharField(max_length=40, blank=True)    # 'current_asset', 'bank', 'cost_of_sales'… (registry)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='children')
    is_postable = models.BooleanField(default=True)          # header/group accounts are False
    currency = models.CharField(max_length=3, blank=True)    # set only for foreign-currency bank accounts
    is_active = models.BooleanField(default=True)
    description = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'code'], name='uniq_account_code')]
        indexes = [models.Index(fields=['workspace', 'type'])]

    @property
    def normal_balance(self):
        return 'DEBIT' if self.type in (self.Type.ASSET, self.Type.EXPENSE) else 'CREDIT'

    def clean(self):
        if self.parent_id:
            if self.parent.workspace_id != self.workspace_id:
                raise ValidationError('Parent account belongs to another workspace')
            if self.parent.type != self.type:
                raise ValidationError('Parent account must have the same type')
```
- **No stored balance.** Balances come from `selectors.balances` (§8).
- Once an account has posted lines, `type` can't change (enforced in the service and serializer) and the account can't be deleted. It can be deactivated or renamed.
- Codes aren't globally unique; each workspace has its own chart.

```python
class AccountRole(models.Model):
    """Maps a system role ('vat_output', 'paye_payable', …) to one account in a workspace.
    Replaces boolean control-account flags: adding a role is a registry entry, not a migration."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT)
    role = models.CharField(max_length=50)                    # validated against registry.ACCOUNT_ROLES
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='roles')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'role'], name='uniq_account_role')]
```

```python
# apps/finance/registry.py
ACCOUNT_ROLES = {
    # balance sheet
    'accounts_receivable':   'ASSET',
    'accounts_payable':      'LIABILITY',
    'vat_input':             'ASSET',
    'vat_output':            'LIABILITY',
    'wht_payable':           'LIABILITY',
    'paye_payable':          'LIABILITY',
    'napsa_payable':         'LIABILITY',
    'nhima_payable':         'LIABILITY',
    'other_deductions_payable': 'LIABILITY',
    'net_pay_payable':       'LIABILITY',
    'employee_reimbursements_payable': 'LIABILITY',
    'retained_earnings':     'EQUITY',
    # P&L
    'salaries_expense':      'EXPENSE',
    'employer_napsa_expense': 'EXPENSE',
    'employer_nhima_expense': 'EXPENSE',
    'employer_borne_statutory_expense': 'EXPENSE',
    'sales_revenue':         'REVENUE',      # default when a line has no account
    'fx_gain_loss':          'EXPENSE',
    'rounding':              'EXPENSE',
}
```
Other apps add roles at startup with `finance.registry.register_account_roles({...})`; supply chain adds `inventory`, `goods_received_not_invoiced` and similar (supply chain doc §7). Finance itself never imports those apps.

The setup service checks that each role's account has the expected type. Posting fails with a clear message ("Account role 'paye_payable' isn't mapped") instead of guessing.

### 4.3 Journals: the core of the module

```python
class JournalEntry(WorkspaceOwned, ImmutableAfterPostMixin):
    class Status(models.TextChoices):
        DRAFT = 'DRAFT'
        POSTED = 'POSTED'

    number = models.CharField(max_length=30, blank=True)          # assigned at post
    date = models.DateField()
    period = models.ForeignKey(AccountingPeriod, on_delete=models.PROTECT, null=True, blank=True)  # set at post
    description = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    # Where it came from: string keys, not FKs, so any module can be a source without a migration
    source_type = models.CharField(max_length=50, default='manual')   # 'manual', 'payroll.period', 'finance.invoice', …
    source_id = models.CharField(max_length=64, blank=True)
    source_version = models.PositiveIntegerField(default=1)

    # Reversal chain
    reverses = models.OneToOneField('self', null=True, blank=True, on_delete=models.PROTECT,
                                    related_name='reversed_by')
    reversal_reason = models.CharField(max_length=255, blank=True)

    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    metadata = models.JSONField(default=dict, blank=True)   # {'schema_version': 1, 'fingerprint': ...}

    IMMUTABLE_WHEN = ('status', Status.POSTED)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'number'], condition=~Q(number=''),
                                    name='uniq_journal_number'),
            # Idempotency: one journal per source version. Manual journals have no source_id.
            models.UniqueConstraint(fields=['workspace', 'source_type', 'source_id', 'source_version'],
                                    condition=~Q(source_id=''), name='uniq_journal_source'),
        ]
        indexes = [
            models.Index(fields=['workspace', 'date']),
            models.Index(fields=['workspace', 'source_type', 'source_id']),
        ]

    @property
    def is_reversed(self):
        return hasattr(self, 'reversed_by')


class JournalLine(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')  # = journal.workspace
    journal = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, related_name='lines')
    line_no = models.PositiveSmallIntegerField()
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='lines')
    description = models.CharField(max_length=255, blank=True)

    debit = MoneyField()                                   # base currency
    credit = MoneyField()                                  # base currency
    currency = models.CharField(max_length=3)              # transaction currency
    amount_currency = MoneyField()                         # signed: +debit / -credit, transaction currency

    # Tax reporting: VAT returns read these, not account totals
    tax_code = models.ForeignKey('TaxCode', null=True, blank=True, on_delete=models.PROTECT)
    tax_base_amount = MoneyField()                         # taxable amount this tax line relates to

    # Dimensions (nullable; new ones are additive columns)
    contact = models.ForeignKey('Contact', null=True, blank=True, on_delete=models.PROTECT)
    department = models.ForeignKey('hcm.Department', null=True, blank=True, on_delete=models.PROTECT)
    site = models.ForeignKey('sites.Site', null=True, blank=True, on_delete=models.PROTECT)  # cost per site

    # Denormalized from journal for fast reporting; set by post_journal
    date = models.DateField()
    is_posted = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['journal', 'line_no'], name='uniq_journal_line_no'),
            models.CheckConstraint(check=Q(debit__gte=0) & Q(credit__gte=0), name='jl_non_negative'),
            models.CheckConstraint(check=(Q(debit=0) & Q(credit__gt=0)) | (Q(credit=0) & Q(debit__gt=0)),
                                   name='jl_one_side_only'),
        ]
        indexes = [
            models.Index(fields=['workspace', 'account', 'date']),
            models.Index(fields=['workspace', 'is_posted', 'date']),
            models.Index(fields=['workspace', 'tax_code', 'date']),
            models.Index(fields=['workspace', 'contact']),
        ]
```

Key points:
- One `JournalEntry` = one balanced transaction. Lines are one-sided, and the database enforces that.
- Balance (`Σdebit == Σcredit`) can't be a row constraint. It's enforced in `post_journal` under lock and verified by `finance_check_invariants` (run nightly and in tests).
- No `running_balance`. Running balances are computed in the ledger report with a window function.
- Source documents point **to** their journal (`Invoice.journal`). The journal points back with `source_type/source_id`. Either side can be queried.

### 4.4 Contacts and tax codes

```python
class Contact(WorkspaceOwned):
    name = models.CharField(max_length=255)
    is_customer = models.BooleanField(default=False)
    is_vendor = models.BooleanField(default=False)
    is_individual = models.BooleanField(default=False)
    tpin = models.CharField(max_length=10, blank=True, validators=[validate_tpin])  # optional; 10 digits when set
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    default_currency = models.CharField(max_length=3, blank=True)
    payment_terms_days = models.PositiveSmallIntegerField(default=30)
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [models.Index(fields=['workspace', 'name']), models.Index(fields=['workspace', 'tpin'])]


class TaxCode(WorkspaceOwned):
    class Kind(models.TextChoices):
        VAT = 'VAT'
        WHT = 'WHT'

    class Treatment(models.TextChoices):
        STANDARD = 'STANDARD'
        ZERO_RATED = 'ZERO_RATED'
        EXEMPT = 'EXEMPT'
        NONE = 'NONE'

    code = models.CharField(max_length=20)                    # 'VAT-STD', 'VAT-ZERO', 'VAT-EXEMPT', 'WHT-RENT'
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    treatment = models.CharField(max_length=20, choices=Treatment.choices, default=Treatment.STANDARD)
    rate = models.DecimalField(max_digits=7, decimal_places=4)  # 16.0000 = 16%
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    sales_account_role = models.CharField(max_length=50, blank=True)     # 'vat_output'
    purchase_account_role = models.CharField(max_length=50, blank=True)  # 'vat_input' / 'wht_payable'
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'code', 'effective_from'],
                                               name='uniq_taxcode_version')]
```
- A rate change is a **new row** with a new `effective_from`. Old documents keep pointing at the old row and keep their snapshot rate.
- Workspaces that aren't VAT-registered get only `VAT-NONE`, and the invoice service refuses other VAT codes.

### 4.5 Sales: invoices and credit notes

One model for both, distinguished by `kind`. They share lines, posting and numbering logic.

```python
class Invoice(WorkspaceOwned, ImmutableAfterPostMixin):
    class Kind(models.TextChoices):
        INVOICE = 'INVOICE'
        CREDIT_NOTE = 'CREDIT_NOTE'

    class Status(models.TextChoices):
        DRAFT = 'DRAFT'
        ISSUED = 'ISSUED'
        VOID = 'VOID'        # only allowed before any payment; posts a reversal

    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.INVOICE)
    number = models.CharField(max_length=30, blank=True)              # assigned at issue
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name='invoices')
    original_invoice = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT,
                                         related_name='credit_notes')  # credit notes only

    issue_date = models.DateField()
    due_date = models.DateField()
    currency = models.CharField(max_length=3)
    exchange_rate = RateField()
    reference = models.CharField(max_length=100, blank=True)          # customer PO number etc.
    notes = models.TextField(blank=True)

    # Snapshot at issue: what the legal document says
    bill_to_name = models.CharField(max_length=255, blank=True)
    bill_to_tpin = models.CharField(max_length=10, blank=True)
    bill_to_address = models.TextField(blank=True)

    # Totals in document currency: recomputed from lines by the service, frozen at issue
    subtotal = MoneyField()
    tax_total = MoneyField()
    total = MoneyField()

    journal = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    issued_at = models.DateTimeField(null=True, blank=True)
    issued_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    IMMUTABLE_WHEN = ('status', Status.ISSUED)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'kind', 'number'], condition=~Q(number=''),
                                    name='uniq_invoice_number'),
            models.CheckConstraint(check=Q(due_date__gte=F('issue_date')), name='invoice_due_after_issue'),
        ]
        indexes = [
            models.Index(fields=['workspace', 'status', 'issue_date']),
            models.Index(fields=['workspace', 'contact']),
            models.Index(fields=['workspace', 'due_date']),
        ]


class InvoiceLine(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='lines')  # drafts only; see guard
    line_no = models.PositiveSmallIntegerField()
    description = models.CharField(max_length=500)
    quantity = QuantityField()
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    discount_percent = models.DecimalField(max_digits=7, decimal_places=4, default=Decimal('0'))
    account = models.ForeignKey(Account, on_delete=models.PROTECT)        # revenue account
    tax_code = models.ForeignKey(TaxCode, on_delete=models.PROTECT)
    tax_rate = models.DecimalField(max_digits=7, decimal_places=4)        # snapshot of tax_code.rate
    line_subtotal = MoneyField()
    line_tax = MoneyField()
    line_total = MoneyField()
    department = models.ForeignKey('hcm.Department', null=True, blank=True, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['invoice', 'line_no'], name='uniq_invoice_line_no')]
```
- `CASCADE` on lines only matters for deleting **drafts**. Issued invoices can't be deleted (§2.5), so their lines can't be cascaded away.
- Payment status (UNPAID / PARTIAL / PAID) and overdue are computed from `PaymentAllocation` in `selectors.aging.invoice_payment_status()`. Nothing stored goes stale.
- Corrections after issue: create a credit note (full or partial), then a new invoice if needed. Editing an issued invoice isn't allowed.

### 4.6 Purchases: bills

`Bill` / `BillLine` mirror `Invoice` / `InvoiceLine`, with these differences:
- `kind`: `BILL` / `VENDOR_CREDIT`.
- `vendor_reference` (the supplier's invoice number), with a unique constraint `(workspace, contact, vendor_reference)` to catch double entry.
- Status: `DRAFT` → `POSTED` → `VOID`.
- Line `account` is an expense or asset account; `tax_code` maps to `vat_input`.
- Our own `number` comes from the `bill` sequence.

### 4.7 Payments and allocations

```python
class Payment(WorkspaceOwned, ImmutableAfterPostMixin):
    class Direction(models.TextChoices):
        RECEIVED = 'RECEIVED'      # from customers
        MADE = 'MADE'              # to vendors / employees / tax authority

    class Status(models.TextChoices):
        DRAFT = 'DRAFT'
        POSTED = 'POSTED'
        VOID = 'VOID'

    number = models.CharField(max_length=30, blank=True)
    direction = models.CharField(max_length=10, choices=Direction.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    contact = models.ForeignKey(Contact, null=True, blank=True, on_delete=models.PROTECT)
    bank_account = models.ForeignKey('BankAccount', on_delete=models.PROTECT)
    date = models.DateField()
    currency = models.CharField(max_length=3)
    exchange_rate = RateField()
    amount = MoneyField()                          # cash moved, document currency
    wht_tax_code = models.ForeignKey(TaxCode, null=True, blank=True, on_delete=models.PROTECT)
    wht_amount = MoneyField()                      # withheld on payments MADE
    method = models.CharField(max_length=30, blank=True)   # 'bank_transfer', 'mobile_money', 'cheque'… (no choices)
    reference = models.CharField(max_length=100, blank=True)
    journal = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name='+')

    IMMUTABLE_WHEN = ('status', Status.POSTED)


class PaymentAllocation(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name='allocations')
    invoice = models.ForeignKey(Invoice, null=True, blank=True, on_delete=models.PROTECT, related_name='allocations')
    bill = models.ForeignKey('Bill', null=True, blank=True, on_delete=models.PROTECT, related_name='allocations')
    amount = MoneyField()                          # settles this much of the document (incl. WHT share)

    class Meta:
        constraints = [
            models.CheckConstraint(check=Q(amount__gt=0), name='alloc_positive'),
            models.CheckConstraint(
                check=(Q(invoice__isnull=False) & Q(bill__isnull=True)) |
                      (Q(invoice__isnull=True) & Q(bill__isnull=False)),
                name='alloc_exactly_one_target'),
        ]
```
- One payment can settle several documents, and one document can be settled by several payments.
- Unallocated amounts stay on the contact as a credit balance (computed).
- Future allocation targets (expense claims, tax remittances) are added as new nullable FKs, and the check constraint is widened in the same migration.

### 4.8 Bank accounts and reconciliation

```python
class BankAccount(WorkspaceOwned):
    name = models.CharField(max_length=100)
    bank_name = models.CharField(max_length=100)
    branch = models.CharField(max_length=100, blank=True)
    account_number = models.CharField(max_length=50)       # sensitive: masked in API and audit (last 4)
    currency = models.CharField(max_length=3)
    account = models.OneToOneField(Account, on_delete=models.PROTECT, related_name='bank_account')  # subtype='bank'
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'account_number'], name='uniq_bank_account_no')]


class BankReconciliation(WorkspaceOwned):
    class Status(models.TextChoices):
        IN_PROGRESS = 'IN_PROGRESS'
        COMPLETED = 'COMPLETED'

    bank_account = models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name='reconciliations')
    statement_date = models.DateField()
    statement_balance = MoneyField()                 # from the bank statement
    book_balance = MoneyField()                      # ledger balance at statement_date, captured on completion
    difference = MoneyField()                        # must be 0 to complete, unless explained
    explanation = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['bank_account', 'statement_date'], name='uniq_recon_date')]
```
- The bank balance is the ledger balance of `bank_account.account`. There's no stored `balance`.
- "Last reconciled" means the latest COMPLETED reconciliation. It's a query, not a field.
- Statement lines and per-transaction matching (`BankStatementLine`, `ReconciliationMatch`) are added later without changing these tables.

### 4.9 Expense claims

```python
class ExpenseCategory(WorkspaceOwned):
    name = models.CharField(max_length=100)
    account = models.ForeignKey(Account, on_delete=models.PROTECT)   # where approved claims post
    receipt_required_over = models.DecimalField(max_digits=18, decimal_places=2,
                                                null=True, blank=True)   # per-category threshold; null = never
    is_active = models.BooleanField(default=True)


class ExpenseClaim(WorkspaceOwned, ImmutableAfterPostMixin):
    class Status(models.TextChoices):
        DRAFT = 'DRAFT'
        SUBMITTED = 'SUBMITTED'
        APPROVED = 'APPROVED'     # posts journal: Dr expense / Cr employee_reimbursements_payable
        REJECTED = 'REJECTED'
        # "paid" is computed from PaymentAllocation, not stored

    number = models.CharField(max_length=30, blank=True)
    employee = models.ForeignKey('hcm.Employee', on_delete=models.PROTECT, related_name='expense_claims')
    submitted_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    currency = models.CharField(max_length=3)
    exchange_rate = RateField()
    total = MoneyField()
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    decision_notes = models.TextField(blank=True)
    journal = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name='+')

    IMMUTABLE_WHEN = ('status', Status.APPROVED)


class ExpenseLine(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    claim = models.ForeignKey(ExpenseClaim, on_delete=models.CASCADE, related_name='lines')
    date = models.DateField()
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT)
    description = models.CharField(max_length=500)
    amount = MoneyField()
    tax_code = models.ForeignKey(TaxCode, null=True, blank=True, on_delete=models.PROTECT)
```
- Approvers can't approve their own claims (service rule).
- Linked to `hcm.Employee`, not only `User`, because not every employee has a login.

### 4.10 Attachments

```python
class Attachment(WorkspaceOwned):
    content_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    object_id = models.CharField(max_length=64)
    target = GenericForeignKey('content_type', 'object_id')
    file = models.FileField(upload_to=attachment_upload_path)    # workspace-prefixed path; S3 via django-storages
    original_name = models.CharField(max_length=255)
    content_hash = models.CharField(max_length=64)               # sha256, detects duplicates / tampering
    size_bytes = models.PositiveBigIntegerField()

    class Meta:
        indexes = [models.Index(fields=['workspace', 'content_type', 'object_id'])]
```
One table serves invoices, bills, claims, journals and reconciliations. Attachments on posted documents can be added but not removed.

### 4.11 `ImmutableAfterPostMixin`

```python
class ImmutableAfterPostMixin:
    """Blocks edits/deletes once IMMUTABLE_WHEN = (field, value) is met in the DATABASE copy.
    Fields in MUTABLE_AFTER_POST may still change (e.g. status for VOID transitions done by services)."""
    IMMUTABLE_WHEN: tuple
    MUTABLE_AFTER_POST: tuple = ('status', 'updated_at')

    def _db_copy(self):
        return type(self).objects.filter(pk=self.pk).first() if self.pk else None

    def save(self, *args, **kwargs):
        stored = self._db_copy()
        field, locked_value = self.IMMUTABLE_WHEN
        if stored and getattr(stored, field) == locked_value:
            for f in self._meta.concrete_fields:
                if f.attname in self.MUTABLE_AFTER_POST:
                    continue
                if getattr(stored, f.attname) != getattr(self, f.attname):
                    raise ImmutableRecordError(f'{type(self).__name__} {self.pk} is posted; {f.name} cannot change')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        stored = self._db_copy()
        field, locked_value = self.IMMUTABLE_WHEN
        if stored and getattr(stored, field) == locked_value:
            raise ImmutableRecordError(f'{type(self).__name__} {self.pk} is posted and cannot be deleted')
        super().delete(*args, **kwargs)
```
Queryset `.update()`/`.delete()` bypass this, so the manager for these models overrides both to refuse when posted rows are in the queryset. On Postgres, the trigger in §2.5 is the final guard.

---

## 5. Posting engine

### 5.1 `post_journal`
```python
# apps/finance/services/journals.py
@transaction.atomic
def post_journal(journal: JournalEntry, *, actor) -> JournalEntry:
    journal = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    if journal.status == JournalEntry.Status.POSTED:
        return journal                                            # idempotent

    lines = list(journal.lines.select_related('account'))
    if len(lines) < 2:
        raise PostingError('A journal needs at least two lines')

    total_debit = sum((l.debit for l in lines), Decimal('0'))
    total_credit = sum((l.credit for l in lines), Decimal('0'))
    if total_debit != total_credit:
        raise PostingError(f'Unbalanced journal: debit {total_debit} ≠ credit {total_credit}')

    for line in lines:
        if line.workspace_id != journal.workspace_id or line.account.workspace_id != journal.workspace_id:
            raise PostingError('Line or account belongs to another workspace')
        if not (line.account.is_active and line.account.is_postable):
            raise PostingError(f'Account {line.account.code} is not postable')

    period = get_open_period(journal.workspace, journal.date)     # raises if none or CLOSED/LOCKED
    journal.number = next_number(journal.workspace, 'journal')    # row-locked sequence
    journal.period = period
    journal.status = JournalEntry.Status.POSTED
    journal.posted_at = timezone.now()
    journal.posted_by = actor
    journal.save()
    JournalLine.objects.filter(journal=journal).update(is_posted=True, date=journal.date)

    audit.record('journal.posted', target=journal, metadata={'total': str(total_debit)})
    return journal
```

### 5.2 `reverse_journal`
```python
@transaction.atomic
def reverse_journal(journal, *, date, reason, actor) -> JournalEntry:
    journal = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    if journal.status != JournalEntry.Status.POSTED:
        raise PostingError('Only posted journals can be reversed')
    if journal.is_reversed:
        raise PostingError('Journal already reversed')

    reversal = JournalEntry.objects.create(
        workspace=journal.workspace, date=date, description=f'Reversal of {journal.number}: {reason}',
        source_type=f'{journal.source_type}.reversal',   # keeps the idempotency constraint from clashing
        source_id=journal.source_id, source_version=journal.source_version,
        reverses=journal, reversal_reason=reason, created_by=actor,
    )
    # ...copy lines with debit/credit swapped and amount_currency negated...
    return post_journal(reversal, actor=actor)
```
The reversal date must fall in an open period. Usually it's today, not the original date, so closed periods stay untouched.

### 5.3 Period rules
- Posting into a CLOSED or LOCKED period is refused. A FINANCE_MANAGER can reopen a CLOSED period (audited); LOCKED is permanent.
- Year end: `close_fiscal_year` posts a closing journal that moves P&L balances to `retained_earnings`, then marks the year closed.

---

## 6. Posting rules

Every rule builds lines through account roles and then calls `post_journal`.

| Event | Debit | Credit |
|---|---|---|
| Invoice issued | `accounts_receivable` (total) | line `account` (line subtotal) · tax code's sales role, e.g. `vat_output` (line tax) |
| Credit note issued | mirror of invoice | mirror of invoice |
| Invoice voided | `reverse_journal(invoice.journal)` | |
| Payment received | bank account (amount) | `accounts_receivable` (allocated) |
| Bill posted | line `account` (subtotal) · `vat_input` (tax) | `accounts_payable` (total) |
| Payment made (with WHT) | `accounts_payable` (allocated) | bank (amount) · `wht_payable` (wht_amount) |
| Expense claim approved | category `account` (+ `vat_input` if any) | `employee_reimbursements_payable` |
| Expense claim paid | `employee_reimbursements_payable` | bank |
| Payroll period | see §7 | |
| Tax remittance | `paye_payable` / `napsa_payable` / `nhima_payable` / `vat_output`… | bank |

Foreign currency: lines are converted at the document's `exchange_rate`. If the converted line totals differ by rounding, a final line to the `rounding` role absorbs the difference. That line is at most 0.01 × number of lines, otherwise posting fails. Realised FX gains and losses on payment are posted to `fx_gain_loss`.

---

## 7. Payroll integration

```python
# apps/finance/integrations/payroll.py
def post_payroll_period(workspace, period, *, actor) -> JournalEntry:
    """Called explicitly (button or period COMPLETED transition). Never from a model signal."""
```

Steps:
1. Require `period.workspace == workspace` (after Phase 0) and `period.status in (COMPLETED, PAID)`.
2. Load **active** payslips only (`is_active=True`) for the period.
3. Compute a `fingerprint`: the sha256 of the sorted `(payslip.id, payslip.version)` pairs.
4. Find the latest unreversed journal with `source_type='payroll.period', source_id=str(period.id)`:
   - None → post with `source_version=1`.
   - Same `metadata['fingerprint']` → return it (idempotent).
   - Different fingerprint → `reverse_journal(old)`, then post the new one with `source_version = old.source_version + 1`.
5. Aggregate and build lines:

| Role | Amount |
|---|---|
| Dr `salaries_expense` | Σ (`gross_salary` − `unpaid_leave_deduction` − `absenteeism_deduction`) |
| Dr `employer_napsa_expense` | Σ `napsa_employer` |
| Dr `employer_nhima_expense` | Σ `nhima_employer` |
| Dr `employer_borne_statutory_expense` | Σ (`paye_tax` + `napsa_employee` + `nhima_employee`) where `employer_borne_deductions=True` |
| Cr `paye_payable` | Σ `paye_tax` |
| Cr `napsa_payable` | Σ (`napsa_employee` + `napsa_employer`) |
| Cr `nhima_payable` | Σ (`nhima_employee` + `nhima_employer`) |
| Cr `other_deductions_payable` | Σ `total_custom_deductions` |
| Cr `net_pay_payable` | Σ `net_salary` |

6. If debits ≠ credits, **fail and post nothing**, with a per-payslip diagnostic listing the payslips that don't satisfy the identities below. Posting a plug amount would hide payroll bugs.
7. Optional: split lines by `employee.department` using the `department` dimension. Totals stay the same.

**How the payroll code computes net** (`Payslip.calculate()` in `apps/payroll/models.py`, `calculate_zambian_payroll()` in `apps/payroll/utils.py`, checked Oct 2026):

| Mode | `net_salary` |
|---|---|
| Normal | `gross − napsa_employee − paye_tax − nhima_employee − unpaid_leave_deduction − absenteeism_deduction − total_custom_deductions` |
| Employer-borne | `gross − unpaid_leave_deduction − absenteeism_deduction − total_custom_deductions` (statutory amounts are still calculated and must be remitted, but the employer pays them; `paye_tax` is grossed up, see below) |

Notes:
- `gross_salary` is stored **before** unpaid leave. Unpaid leave and absenteeism are pay that was never earned, not money owed to anyone. They reduce the salary expense rather than crediting a payable.
- Since fix F5 (Oct 2026), absenteeism is deducted **before** NAPSA/PAYE/NHIMA like unpaid leave, and is no longer part of `total_custom_deductions`.
- Since fix F6, employer-borne payslips gross up PAYE: the tax the employer pays is itself taxable, so `paye_tax` is solved as tax on (chargeable pay + `paye_tax`), and `paye_gross_up` records the benefit. The posting is unchanged: the higher `paye_tax` appears in both `employer_borne_statutory_expense` and `paye_payable`.
- With these adjustments, the table balances in both modes.

**Prerequisites in payroll before Phase 3** (added to the roadmap):
1. **Decimal arithmetic.** The calculator works in `float` and rounds each component separately, so `gross − Σdeductions` can differ from `net_salary` by a few ngwee per payslip. Across a full payroll that makes the journal unbalanced. Fix: compute in `Decimal`, round each component, then set net = gross − Σ(rounded components). Payroll then satisfies the identity exactly and posting needs no tolerance.
2. **Typed custom deductions.** `PayslipDeduction` has only a free-text `description`. Loan repayments should reduce an employee-loans receivable, and fines may be income, so they can't all go to one payable. Add a nullable `kind` (registry key, e.g. `loan_repayment`, `advance_recovery`, `union_dues`, `other`) that maps to an account role. Untyped rows fall back to `other_deductions_payable`, and the posting preview lists them.

---

## 8. Reports

All are selectors over **posted** `JournalLine`s, and dashboards reuse them.

| Report | Definition |
|---|---|
| Account balance | Σdebit − Σcredit for lines with `account`, `is_posted`, `date ≤ as_of`; sign flipped for credit-normal accounts |
| Trial balance | Account balance per postable account as of a date; totals must be equal |
| General ledger | Lines per account in a date range, opening balance + running balance via `Window(Sum(...))` |
| Profit & loss | REVENUE − EXPENSE for a date range, grouped by `subtype` |
| Balance sheet | ASSET = LIABILITY + EQUITY + current-year earnings (computed, until year-end close) |
| AR / AP aging | Open document amounts (total − allocations) bucketed by days past `due_date` |
| VAT summary | Lines grouped by `tax_code` for a period: Σ tax amount and Σ `tax_base_amount` → feeds `compliance` VAT return |

Performance: when line counts justify it, add `AccountBalanceSnapshot(workspace, account, period, debit_total, credit_total)`. It's filled at period close and rebuildable by a command, and reports then read the snapshots plus lines after the last snapshot. Nothing else changes.

---

## 9. API

Base path `/api/v1/finance/`. All viewsets filter by `request.workspace` and return `403` if the workspace doesn't have the `finance` module.

```
accounts/                        GET, POST            PATCH {id}/ (name, parent, is_active, description)
account-roles/                   GET, PUT {role}/
fiscal-years/                    GET, POST            POST {id}/close/
periods/                         GET                  POST {id}/close/ | {id}/reopen/ | {id}/lock/
journals/                        GET, POST (draft)    PATCH {id}/ (draft only)  DELETE {id}/ (draft only)
                                                      POST {id}/post/ | {id}/reverse/ {date, reason}
ledger/                          GET  ?account=&date_from=&date_to=&type=&contact=&department=
contacts/                        GET, POST, PATCH
tax-codes/                       GET, POST            (new version = POST with later effective_from)
invoices/                        GET, POST (draft), PATCH/DELETE (draft only)
                                                      POST {id}/issue/ | {id}/void/ | {id}/credit-note/
                                                      GET  {id}/pdf/
bills/                           GET, POST, PATCH/DELETE (draft only)   POST {id}/post/ | {id}/void/
payments/                        GET, POST            POST {id}/post/ | {id}/void/
bank-accounts/                   GET, POST, PATCH
bank-accounts/{id}/reconciliations/  GET, POST        POST {rid}/complete/
expense-categories/              GET, POST, PATCH
expense-claims/                  GET, POST, PATCH (draft)  POST {id}/submit/ | {id}/approve/ | {id}/reject/
attachments/                     POST (multipart, target type+id), GET, DELETE (only if target not posted)
reports/trial-balance/           ?as_of=
reports/profit-and-loss/         ?date_from=&date_to=
reports/balance-sheet/           ?as_of=
reports/ar-aging/ | ap-aging/    ?as_of=
reports/vat-summary/             ?period_start=&period_end=
integrations/payroll/{period_id}/post/   POST
```

Every state-changing action is a `POST` to an action endpoint that calls one service function. Serializers mark computed fields read-only (`subtotal`, `tax_total`, `total`, `number`, `status`, `payment_status`).

---

## 10. Permissions

Roles come from `WorkspaceMembership` (see ERP plan §5.3). Permissions are checked per action in `api/permissions.py`:

```python
FINANCE_PERMISSIONS = {
    'journal.post':        {'OWNER', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'},
    'journal.reverse':     {'OWNER', 'ADMIN', 'FINANCE_MANAGER'},
    'period.close':        {'OWNER', 'ADMIN', 'FINANCE_MANAGER'},
    'period.lock':         {'OWNER', 'FINANCE_MANAGER'},
    'invoice.issue':       {'OWNER', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'},
    'expense.approve':     {'OWNER', 'ADMIN', 'FINANCE_MANAGER', 'MANAGER'},
    'payroll.post_to_gl':  {'OWNER', 'ADMIN', 'FINANCE_MANAGER'},
    'finance.read':        {'OWNER', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'AUDITOR'},
    # ...
}
```
Permissions are code, not schema. Changing who can do what needs a deploy but no migration.

---

## 11. Testing

Must-have tests before each phase ships:

| Area | Test |
|---|---|
| Invariants | Random journals (factory-boy) → every posted journal balances; trial balance totals equal; `finance_check_invariants` passes |
| Immutability | Editing/deleting a posted journal, line, issued invoice raises; queryset `update()` on posted rows raises |
| Tenancy | Workspace A can't read, post to, or reference workspace B's accounts/contacts/tax codes (API and service level) |
| Idempotency | Posting the same payroll period twice → one journal; regenerate payslips → reversal + new journal |
| Sequences | Concurrent issue of 20 invoices (Postgres) → 20 distinct consecutive numbers, no gaps |
| Periods | Posting into CLOSED/LOCKED period refused; reopen is audited |
| Money | Per-line VAT rounding matches printed invoice; floats rejected |
| Payroll | Real payslip fixtures, normal and employer-borne → journal totals equal payslip totals |
| Audit | Each service writes the expected audit event |

Concurrency and trigger tests run against Postgres in CI. SQLite ignores `select_for_update`.

---

## 12. Deferred features

Each one is additive. None changes the tables above.

| Feature | How it fits |
|---|---|
| Quotes | `Quote` + `QuoteLine` (same line shape as invoices); `convert_to_invoice` creates a **draft** invoice copying contact, lines and tax codes; no GL impact |
| Purchase orders | Owned by supply chain (`apps/supply_chain`); commitments only, no GL posting; bill ↔ PO/GRN matching via `supply_chain.BillMatch`, so finance has no FK to supply chain |
| ZRA Smart Invoice | `FiscalSubmission(workspace, content_type, object_id, provider, status, external_id, request, response, submitted_at)`; invoice issue enqueues a submission task |
| Exchange rates | `ExchangeRate(currency, date, rate, source)` to prefill document rates |
| Bank feeds / statement import | `BankStatementLine`, `ReconciliationMatch` |
| Budgets | `Budget(workspace, fiscal_year, account, period, amount)` |
| Fixed assets | `FixedAsset` + depreciation schedule posting journals via `source_type='finance.depreciation'` |
| Consolidation | Reads trial balances across workspaces in a consultant portfolio; no schema change |
