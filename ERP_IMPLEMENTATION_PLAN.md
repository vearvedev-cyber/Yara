# ERP Implementation Plan

**Last updated**: October 2026
**Status**: Design, approved for Phase 0
**Detailed designs**:
- [apps/finance/FINANCE_MODULE_STRUCTURE.md](apps/finance/FINANCE_MODULE_STRUCTURE.md): ledger, documents, posting
- [apps/audit/AUDIT_ARCHITECTURE.md](apps/audit/AUDIT_ARCHITECTURE.md): audit trail
- [apps/supply_chain/SUPPLY_CHAIN_ARCHITECTURE.md](apps/supply_chain/SUPPLY_CHAIN_ARCHITECTURE.md): inventory, requisitions, purchasing, fleet

---

## Contents
1. [Goal](#1-goal)
2. [Design rules](#2-design-rules)
3. [What already exists](#3-what-already-exists)
4. [Module boundaries](#4-module-boundaries)
5. [Phase 0: prerequisites in existing code](#5-phase-0-prerequisites-in-existing-code)
6. [Roadmap](#6-roadmap)
7. [Cross-module flows](#7-cross-module-flows)
8. [Zambian statutory data](#8-zambian-statutory-data)
9. [Compliance checks](#9-compliance-checks)
10. [Frontend outline](#10-frontend-outline)
11. [Decisions](#11-decisions)
12. [Risks](#12-risks)

---

## 1. Goal

Extend the HRMS into an ERP for Zambian companies by adding:

- **Finance**: double-entry general ledger, sales invoices, vendor bills, payments, bank accounts, expense claims, financial statements.
- **Audit**: one append-only audit trail covering HR, payroll and finance.
- **Compliance**: statutory filing calendar, VAT returns, and readiness checks that build on the existing PAYE return.
- **Supply chain**: materials, warehouses and bins, a costed stock ledger, site requisitions and delivery notes, purchasing (purchase request → PO → GRN → bill; **no bidding** in v1), fleet and equipment. The domain design comes from the standalone SupplyChain_MNG project, rebuilt for this codebase.

Payroll posts to the ledger automatically. Everything is workspace-isolated, the same as today.

---

## 2. Design rules

These rules exist so that later changes don't need risky migrations of live financial data. The other two documents follow them, and reviews should check against them.

### 2.1 Get the irreversible parts right first
Some structures are very expensive to change once real books exist, so they are fixed now:

| Decision | Choice | Why it is hard to change later |
|---|---|---|
| Ledger shape | `JournalEntry` header + `JournalLine` rows | Can't regroup historical lines into transactions after the fact |
| Posted data | Immutable; corrected only by reversal | Editing posted entries destroys the audit trail and can't be undone |
| Money type | `Decimal`, `max_digits=18, decimal_places=2`; never `float` | Precision lost in stored data can't be recovered |
| Currency | Every document and line stores `currency` + `exchange_rate`; ledger amounts in base currency | Missing rates on old transactions can't be reconstructed |
| Tenancy | Every finance and audit row has its own `workspace` FK | Backfilling tenant ids on millions of rows is slow and error-prone |
| Uniqueness | Always scoped: `(workspace, code)`, never global | A global unique blocks the second tenant |
| Document numbers | Assigned from a per-workspace sequence, at issue time | Renumbering issued invoices isn't legally possible |
| Deletion | `on_delete=PROTECT` from finance and audit to workspace, accounts, contacts | A cascade can't be undone |

### 2.2 Things that change often are data, not schema
- **Tax rates, tax bands, ceilings** live in tables with `effective_from`/`effective_to`. Payroll already does this (`PayeTaxBand`, `WorkspaceStatutorySettings`); finance follows it with `TaxCode`.
- **Which account receives which posting** is a per-workspace `AccountRole` mapping, not boolean flags on accounts.
- **Enabled modules** are rows in `WorkspaceModule`, not boolean columns on `Workspace`.
- **Event types, check keys, source types** are plain `CharField`s validated against a registry in code. New values need no migration.
- **Statutory due dates** are seed data (`StatutoryObligation`), not constants.
- **Chart of accounts templates** are versioned JSON fixtures loaded by a management command, not migrations.

### 2.3 Store facts, compute everything else
- Account balances, invoice payment status, "overdue", aging and readiness scores are **computed** from the source rows.
- If a value is cached for speed (e.g. period-end balances), it is in a separate table that a command can rebuild from scratch.
- Documents store **snapshots** of what was legally issued (customer name, TPIN, address, tax rate) because those must not change when the master record changes.

### 2.4 Explicit integration, not hidden signals
- Business side effects (posting payroll to the GL, posting an invoice) are explicit **service calls** (`finance.services.post_journal(...)`), triggered by a user action or a state transition.
- Django signals are used only for the generic audit tracker, never for business logic.
- Every automated posting carries an **idempotency key** `(source_type, source_id, source_version)`, unique per workspace. Running it twice cannot double-post.

### 2.5 Schemas only grow
- New columns are nullable or have defaults. Columns are renamed or dropped only in a later release, after code stops using them (expand → migrate → contract).
- Repeating data goes in child tables (`InvoiceLine`), not JSON lists. JSON is only for free-form metadata and audit payloads, and every JSON payload has a `schema_version`.

---

## 3. What already exists

The new modules must reuse or extend these. They must not duplicate them.

| Existing | Location | Plan |
|---|---|---|
| `Workspace`, `WorkspaceMembership` (roles: OWNER, ADMIN, HR_MANAGER, MANAGER, VIEWER) | `apps/core/models.py` | Add `WorkspaceModule`; add finance roles (Phase 0) |
| `WorkspaceMiddleware` → `request.workspace` | `apps/core/middleware.py` | All new views use `request.workspace` |
| `PayrollPeriod` (**global**, unique on `year, month`, global `status`) | `apps/payroll/models.py:108` | **Scope to workspace (Phase 0)** |
| `Payslip` (versioned via `version`/`is_active`; has `napsa_employer`, `nhima_employer`, `employer_borne_deductions`) | `apps/payroll/models.py:140` | Source for payroll posting; only active versions are posted |
| `WorkspaceStatutorySettings`, `PayeTaxBand` | `apps/payroll/models.py` | Stay the source of payroll tax rules |
| `PAYEReturn` (per workspace + period) | `apps/payroll/models.py:706` | Stays in payroll; compliance reads it |
| `ComplianceDocument` (NAPSA, NHIMA, TCC, PACRA…) | `apps/payroll/models.py:581` | Compliance checks read it (e.g. TCC expiry) |
| `PayslipAuditLog` | `apps/payroll/models.py:676` | Backfilled into the new audit table, then retired (see audit doc) |
| Celery + Redis | `hrms/settings.py` | Scheduled checks use Celery beat, not cron |
| Postgres (prod), SQLite (dev) | `hrms/settings.py` | DB-level guards are Postgres-only; app-level guards apply everywhere |

---

## 4. Module boundaries

```
             ┌─────────┐
             │  core   │  Workspace, membership, WorkspaceModule
             └────▲────┘
                  │ (everyone depends on core)
   ┌──────────────┼─────────────────┬──────────────────┐
   │              │                 │                  │
┌──┴───┐     ┌────┴────┐      ┌─────┴─────┐      ┌─────┴──────┐
│ hcm  │◄────│ payroll │◄─────│  finance  │◄─────│ compliance │
└──────┘     └─────────┘ reads└───────────┘ reads└────────────┘
                 (finance.integrations.payroll reads payroll;
                  payroll never imports finance)

┌───────┐
│ audit │  depends only on core + contenttypes; every app registers
└───────┘  its models with audit; audit imports no business app

┌──────────────┐  reads hcm (employees), sites (SITE stores), finance (contacts, tax codes);
│ supply_chain │  posts journals via supply_chain.integrations.finance;
└──────────────┘  finance never imports supply_chain (bill ↔ PO matching lives in supply_chain)
```

Rules:
- Dependencies point one way only. `payroll` must never import `finance`. When payroll needs to tell finance something, a view or task calls `finance.integrations.payroll.post_payroll_period(...)`.
- Each app exposes a `services.py` (writes) and `selectors.py` (reads). Other apps call those and don't touch another app's models directly for writes.
- `compliance` is a new app (Phase 5). It owns the filing calendar, VAT return and check runs. It does **not** live inside `audit`. Audit records what happened; compliance judges whether obligations are met.

---

## 5. Phase 0: prerequisites in existing code

These change existing HR/payroll data, so they go first, while the finance tables are still empty.

### 5.1 Scope `PayrollPeriod` to a workspace
Today one global row per month is shared by every workspace, including its `status`. Payroll → GL posting needs per-workspace periods.

Migration plan (expand → migrate → contract):
1. **Expand**: add `PayrollPeriod.workspace = FK(Workspace, null=True, on_delete=PROTECT)`.
2. **Data migration**: for each existing period, collect the distinct `payslip.employee.workspace` values.
   - The first workspace keeps the original row (set its `workspace`).
   - For each other workspace, clone the period (same year/month/status/timestamps) and repoint that workspace's `Payslip` rows and `PAYEReturn` rows (match on `PAYEReturn.workspace`) to the clone.
   - Payslips whose employee has `workspace=NULL` (the field is nullable) are listed by the migration and stop it. Fix the data and re-run; don't guess.
3. **Code**: update every call site to pass the workspace. Currently `apps/payroll/views.py:168, 419, 1111, 1351`. Line 168 (`PayrollPeriod.objects.all()`) must filter by `request.workspace`.
4. **Contract**: make `workspace` non-null; replace `unique_together = [['year', 'month']]` with `UniqueConstraint(fields=['workspace', 'year', 'month'])`.

Tests: two workspaces processing the same month independently; status change in one doesn't affect the other.

### 5.2 Module enablement table
```python
# apps/core/models.py
class WorkspaceModule(models.Model):
    """Which product modules a workspace has. Rows, not columns, so new modules need no migration."""
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='modules')
    module = models.CharField(max_length=50)   # 'hr', 'finance', 'supply_chain' (validated in code registry)
    is_enabled = models.BooleanField(default=True)
    enabled_at = models.DateTimeField(auto_now_add=True)
    enabled_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'module'], name='uniq_workspace_module')]
```
- Data migration: insert `hr` for every existing workspace.
- Helper: `workspace_has_module(workspace, 'finance')`, cached per request.
- The current-workspace API returns `modules: ['hr', 'finance']`; the frontend routes on that list.
- Enabling finance runs `finance_setup_workspace` (creates `FinanceSettings`, loads the chart of accounts template, creates account roles and the first fiscal year).

### 5.3 Finance roles
Add `ACCOUNTANT`, `FINANCE_MANAGER` and `AUDITOR` to `WorkspaceMembership.ROLE_CHOICES`. This changes choices only; Django makes a migration, but it runs no SQL. Permissions are defined in code per action, as a map from role to permissions:

| Role | Finance | Payroll posting | Audit trail |
|---|---|---|---|
| OWNER, ADMIN | full | post / reverse | read all |
| FINANCE_MANAGER | full, incl. period close, reversals | post / reverse | read finance |
| ACCOUNTANT | create, issue, post documents | view | read finance |
| AUDITOR | read-only everything | view | read all, export |
| HR_MANAGER | expense claims only | trigger "Post to GL" request | read HR/payroll |
| MANAGER, VIEWER | approve own team's expense claims (MANAGER) | none | none |

### 5.4 Audit context middleware
Install the audit context middleware (see the audit doc) after `WorkspaceMiddleware`, so every later change is attributed from day one.

**Phase 0 exit criteria**: periods are per-workspace in prod; `WorkspaceModule` populated; new roles available; the audit middleware is installed and leaks nothing between requests (tested).

---

## 6. Roadmap

Estimates assume one developer. Every phase ends with something usable, so the plan can stop after any phase without leaving half-built features.

| Phase | Scope | Estimate | Exit criteria |
|---|---|---|---|
| **0. Prerequisites** | §5 | 1 week | See §5 |
| **1. Audit trail** | `AuditEvent`, tracker, registry for HR/payroll models, backfill `PayslipAuditLog`, read API | 1–2 weeks | Every tracked change has exactly one event with correct actor; bulk payroll generation is logged |
| **2. Ledger core** | `FinanceSettings`, `Account`, `AccountRole`, `FiscalYear`, `AccountingPeriod`, `JournalEntry`/`Line`, sequences, posting and reversal services, manual journals, trial balance, general ledger report | 2–3 weeks | Invariant tests pass (every posted journal balances; trial balance balances; posted rows immutable) |
| **3. Payroll → GL** | Payroll prerequisites first (Decimal calculation, typed custom deductions; finance doc §7), then `post_payroll_period`, payroll account roles, repost on payslip regeneration, payment journal | 2 weeks | Posted period reconciles exactly to payslip totals for normal and employer-borne cases |
| **4. Sales (AR) + VAT** | `Contact`, `TaxCode`, `Invoice` + credit notes, receipts and allocations, AR aging, P&L, balance sheet | 2–3 weeks | Issue → post → receive → statements all tie out; VAT per tax code per period is correct |
| **5. Purchases (AP), bank, expenses, compliance** | `Bill`, payments made + WHT, bank accounts and reconciliation records, expense claims, `compliance` app, filing calendar, VAT return, check runs | 3 weeks | Bank reconciliation for a month; VAT return matches ledger; checks run daily via Celery beat |
| **6. Dashboards** | Finance dashboard, company health tab, consultant portfolio | 2 weeks | Numbers on dashboards come from selectors already used by reports (no separate maths) |
| **SC1. Stock core** | Catalogue, warehouses/stores/bins, `StockMovement` ledger with WAC, lots and serials (expiry, quarantine, FEFO), controlled-item rules, balances, rebuild command | 3 weeks | Ledger replay equals balances and costs; concurrency test passes; a serial can't exist in two places; controlled issue refused without permit and witness |
| **SC2. Stock documents** | GRN (no PO), issue incl. PPE, return, transfer, adjustment, finance posting for each | 1–2 weeks | Every document posts the expected movements and journal; site dimension on consumption |
| **SC3. Requisitions & delivery** | Requisitions, reservations, delivery notes via transit store, drivers/vehicles on dispatch | 2 weeks | HQ → transit → site flow with partial receipts; reservations consumed per line |
| **SC4. Purchasing** | Purchase requests, optional supplier quotes, POs, GRN against PO, bill matching, GRNI | 2 weeks | Three-way match report; GRNI reconciles |
| **SC5. Fleet & equipment** | Vehicles, compliance items, fuel (own stock / external), maintenance, equipment and spare parts, reports | 1–2 weeks | Due list, fuel efficiency and cost-per-vehicle reports from real movements and bills |
| Later | Quotes (sales), Smart Invoice API submission, bank feeds, budgets, multi-company consolidation, FX revaluation, bidding/tenders | n/a | Each is additive to the schema above |

Total: about **12–16 weeks** for finance and audit, plus **9–11 weeks** for supply chain. Supply chain starts after finance Phase 5, because it needs contacts, tax codes, bills and the ledger. SC1–SC2 could start after Phase 4 if needed: movements carry cost regardless, and journals are posted once finance is on. The original 8-week plan covered fewer features than this and would have shipped the ledger without its safety guarantees.

---

## 7. Cross-module flows

### 7.1 Payroll period → GL
Triggered explicitly ("Post to GL" button, or automatically when a period is marked COMPLETED). It is **not** a model signal.

```
PayrollPeriod (workspace W, 2026-09) status → COMPLETED
  └─ finance.integrations.payroll.post_payroll_period(W, period, actor)
       1. Read active payslips (is_active=True) for W + period
       2. Sum by component (gross, PAYE, NAPSA ee/er, NHIMA ee/er,
          custom deductions, net, employer-borne amounts)
       3. Build one JournalEntry via account roles (see finance doc §6)
       4. Assert debits == credits; else fail with a clear error, post nothing
       5. Idempotency key: ('payroll.period', period.id, payroll_version)
       6. post_journal() → audit event 'journal.posted'
```
If payslips are regenerated after posting, the payroll version changes. The service then **reverses** the old journal and posts the new one. It never edits the old one.

Worked example (normal deductions, 245 employees):

| Account role | Debit (K) | Credit (K) |
|---|---|---|
| `salaries_expense` | 2,500,000.00 | |
| `employer_napsa_expense` | 65,000.00 | |
| `employer_nhima_expense` | 25,000.00 | |
| `paye_payable` | | 280,000.00 |
| `napsa_payable` (employee + employer) | | 130,000.00 |
| `nhima_payable` (employee + employer) | | 50,000.00 |
| `net_pay_payable` | | 2,130,000.00 |
| **Total** | **2,590,000.00** | **2,590,000.00** |

Paying salaries is a second journal: Dr `net_pay_payable` / Cr bank. Remitting PAYE: Dr `paye_payable` / Cr bank.

### 7.2 Sales invoice
```
Draft invoice (lines with tax codes) → issue()
  1. Assign number from the workspace 'invoice' sequence
  2. Snapshot contact name / TPIN / address and line tax rates
  3. Post journal: Dr AR (total) / Cr revenue per line / Cr VAT output per tax code
  4. Status DRAFT → ISSUED (no further edits; corrections by credit note)
  5. Later: FiscalSubmission to ZRA Smart Invoice (separate model, separate phase)
```

### 7.3 Compliance check run
A Celery beat task runs daily per finance-enabled workspace. Each registered check writes a `ComplianceCheckRun` row (history kept). The dashboard reads the latest run per check (§9).

---

## 8. Zambian statutory data

All values below are **seed data loaded into tables**, not constants in code. They need checking against current ZRA, NAPSA and NHIMA publications before go-live, and they can be updated without a deploy.

| Item | Where it lives | Seed value (verify) |
|---|---|---|
| PAYE bands | `payroll.PayeTaxBand` (exists) | Already configured per workspace |
| NAPSA rate + ceiling | `payroll.WorkspaceStatutorySettings` (exists) | 5% employee + 5% employer, monthly ceiling |
| NHIMA rate | `payroll.WorkspaceStatutorySettings` (exists) | 1% employee + 1% employer |
| VAT standard rate | `finance.TaxCode` `VAT-STD` | 16% |
| VAT zero-rated / exempt | `finance.TaxCode` `VAT-ZERO`, `VAT-EXEMPT` | 0% (different reporting treatment) |
| Withholding tax | `finance.TaxCode` kind `WHT`, one per payment type | Rates differ per payment type |
| Filing due dates | `compliance.StatutoryObligation` | PAYE / NAPSA / NHIMA: 10th of following month; VAT: 18th of following month (online submission). **Confirmed Oct 2026** |
| VAT registration | `finance.FinanceSettings.vat_registered` | Per workspace. If not registered, no VAT is charged and VAT checks are N/A |
| TPIN format | Validator | 10 digits |

Other rules:
- **Weekend and holiday roll-forward.** A due date that falls on a weekend or public holiday moves to the next working day. `StatutoryObligation` stores the nominal day (e.g. 10), and `compliance.due_date(obligation, period)` applies the roll-forward. Public holidays are data in `compliance.PublicHoliday(date, name)`, seeded yearly, including one-off holidays the government declares. Checks and the tax calendar always use the adjusted date.
- **Customer TPIN is optional.** Sales to individuals often have no TPIN. A missing TPIN is a compliance issue only where the business rule requires one (e.g. B2B over a threshold). That rule is configuration.
- **Books are kept in ZMW.** `FinanceSettings.base_currency` defaults to ZMW and can't be changed once any journal is posted. Foreign-currency documents store the rate used.
- Corporate income tax returns and provisional tax are **out of scope** for v1. They come from year-end statements and can be added as obligations later.

---

## 9. Compliance checks

Lives in `apps/compliance` (Phase 5). Checks are **code-registered functions**; results are append-only rows.

```python
# apps/compliance/models.py
class ComplianceCheckRun(models.Model):
    STATUS = [('PASS', 'Pass'), ('FAIL', 'Fail'), ('NOT_APPLICABLE', 'N/A'), ('ERROR', 'Error')]

    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT)
    check_key = models.CharField(max_length=80)          # e.g. 'vat.return_filed' (registry, not choices)
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS)
    total_items = models.PositiveIntegerField(default=0)
    passing_items = models.PositiveIntegerField(default=0)
    details = models.JSONField(default=dict)              # {'schema_version': 1, 'failing': [{'id':..,'label':..}]}
    run_at = models.DateTimeField(auto_now_add=True)
    check_version = models.PositiveSmallIntegerField(default=1)

    class Meta:
        indexes = [models.Index(fields=['workspace', 'check_key', 'period_start', '-run_at'])]
```

- Each run inserts a new row, so history is kept and there's no unique-constraint clash on re-runs. "Current" means the latest row per `(workspace, check_key, period)`.
- `total_items == 0` → `NOT_APPLICABLE`, not a failure.
- If a check raises, the run stores `ERROR` with the message; one broken check doesn't stop the others.
- The readiness score is computed when read: passed ÷ (applicable checks). It isn't stored.

Initial checks:

| Key | Passes when |
|---|---|
| `payroll.posted_to_gl` | Every COMPLETED payroll period has a posted, unreversed journal |
| `payroll.paye_return_submitted` | `PAYEReturn` for the period is SUBMITTED/ACCEPTED by the due date |
| `ledger.trial_balance` | Trial balance totals are equal (should always pass; a failure means a bug) |
| `ledger.unposted_drafts` | No draft journals older than N days in a closed period |
| `bank.reconciled` | Every active bank account has a completed reconciliation for the period |
| `vat.return_filed` | VAT return filed by the due date (N/A if not VAT-registered) |
| `sales.tpin_where_required` | B2B invoices above the configured threshold carry a TPIN |
| `docs.attachments` | Bills and expense claims above the configured amount have an attachment |
| `statutory.tcc_valid` | `ComplianceDocument` ZRA_TCC is active and not expired |

---

## 10. Frontend outline

The frontend (`hrms-web`) routes on `workspace.modules`, not on boolean flags.

```
Login → GET current workspace → modules + role
  consultant workspace          → /portfolio (shows finance columns if any client has finance)
  modules = [hr]                → /dashboard
  modules = [hr, finance]       → /workspace-dashboard  (tabs: HR | Finance | Company health)
  modules = [finance]           → /finance/dashboard
```

Routes (added phase by phase):
```
/finance/dashboard
/finance/accounts                 chart of accounts
/finance/journals                 list, detail, new manual journal
/finance/ledger                   general ledger (filter by account / role / date)
/finance/contacts
/finance/invoices                 incl. credit notes
/finance/bills
/finance/payments
/finance/bank-accounts            and /:id/reconciliations
/finance/expenses
/finance/reports/trial-balance | profit-and-loss | balance-sheet | ar-aging | ap-aging
/finance/settings                 fiscal years, periods, tax codes, account roles, sequences
/compliance                       checklist, calendar, VAT returns
/audit                            audit trail viewer (role-gated)
/supply-chain/stock               balances, stock card, low / dead stock
/supply-chain/warehouses          warehouses, stores, bins
/supply-chain/documents           GRN, issues (incl. PPE), returns, transfers, adjustments
/supply-chain/requisitions        and /delivery-notes
/supply-chain/purchasing          purchase requests, quotes, purchase orders
/supply-chain/fleet               vehicles, compliance due list, fuel, maintenance
/supply-chain/equipment
```

The separate "Asset/Liability/Equity ledger" pages from the old plan are replaced by one ledger view with an account-type filter.

---

## 11. Decisions

### Made
- Journal header + lines; posted data immutable; reversal-only corrections.
- Tax rates, account mappings, due dates and modules are data.
- `PayrollPeriod` becomes workspace-scoped before any finance work.
- Audit is a custom single append-only table (rationale in the audit doc).
- Compliance is its own app; audit doesn't judge compliance.
- Sales quotes are deferred. Purchase orders belong to supply chain and never post to the GL.
- Supply chain: no bidding in v1, only optional supplier quotes on purchase requests. Every stock movement carries a weighted-average cost. Delivery to sites goes through a transit store. Sites are `sites.Site` and people are `hcm.Employee`.
- Lot and serial tracking is built into SC1 (clients have explosives, chemicals and serialised tools), along with controlled-item rules.
- SupplyChain_MNG is offline and its stock is out of date: opening stock comes from a physical count at go-live; only master data is imported.
- Smart Invoice submission is modelled as a separate `FiscalSubmission` record so the integration can change without touching invoices.

### Pending (none block Phase 0–2)
- [ ] Payroll posting granularity: one journal per period, or per department (department is a line dimension either way)?
- [ ] B2B TPIN threshold for `sales.tpin_where_required`.
- [ ] Auto-post payroll on COMPLETED, or always require a manual "Post to GL"?
- [ ] Smart Invoice integration method (direct API vs certified middleware) and timing.
- [ ] Audit retention period and whether old events are archived to cold storage.
- [ ] Each client's licence conditions for explosives and hazardous chemicals, so `ControlClassRule` defaults can be set (supply chain doc §4.11).
- [ ] Is there a database backup or export of SupplyChain_MNG to import master data from? If not, a spreadsheet template is used instead.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| `PayrollPeriod` migration hits inconsistent legacy data | Migration refuses to guess; dry-run command lists conflicts first; run on a prod snapshot |
| Payroll regenerated after posting causes mismatch | Version-based reposting (reverse + post); `payroll.posted_to_gl` check catches drift |
| Tax figures wrong or outdated | Seed data reviewed by a Zambian accountant; editable without deploy |
| SQLite in dev hides concurrency bugs | Sequence and posting tests run against Postgres in CI |
| Audit table grows large | Indexed on `(workspace, occurred_at)`; partition by month when it passes ~50M rows |
| Supply chain starts before the ledger is stable | SC phases start after finance Phase 5 (SC1–SC2 at the earliest after Phase 4) |

---

## 13. Fix backlog (existing code)

Problems found in current code while designing. They aren't fixed yet. The roadmap phase each one must be done by is listed.

| # | Issue | Location | Severity | Fix by |
|---|---|---|---|---|
| F1 | ~~`bulk_set_employer_borne` updates payslips in **every** workspace when `request.workspace` isn't set~~ | `apps/payroll/views.py` | High (cross-tenant write) | **Fixed Oct 2026**: refuses without a workspace |
| F2 | `PayrollPeriod` is global, including `status`; one workspace completing a month completes it for all | `apps/payroll/models.py:108` | High | Phase 0 (§5.1) |
| F3 | Payroll maths uses `float` with per-component rounding, so `gross − Σdeductions` can differ from `net_salary` by ngwee | `apps/payroll/utils.py:72`, `models.py:454` | Medium (blocks GL posting) | Phase 3 |
| F4 | `PayslipDeduction` has no type, so loans, advances and fines can't map to accounts | `apps/payroll/models.py:466` | Medium (blocks GL posting) | Phase 3 |
| F5 | ~~Absenteeism is deducted from pay but not from the base for NAPSA/PAYE/NHIMA~~ | `apps/payroll/models.py` `Payslip.calculate` | Was over-taxing | **Fixed Oct 2026**: deducted before tax like unpaid leave (Income Tax Act s2). Gratuity is still reduced only by unpaid leave |
| F6 | ~~Employer-borne mode doesn't gross up PAYE~~ | `apps/payroll/utils.py`, `settlement.py` | Was under-declaring | **Fixed Oct 2026**: PAYE grossed up (`Payslip.paye_gross_up`); PAYE return reports taxable pay. Employers must notify ZRA in writing of free-of-tax schemes |
