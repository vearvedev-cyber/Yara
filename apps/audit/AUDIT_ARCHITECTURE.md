# Audit Module: Architecture & Implementation

**Location**: `apps/audit/`
**Status**: Design. Build in roadmap Phase 1 (context middleware in Phase 0)
**Depends on**: `apps/core`, `django.contrib.contenttypes`. Imports **no** business app; business apps register with audit
**Read first**: [ERP_IMPLEMENTATION_PLAN.md §2 Design rules](../../ERP_IMPLEMENTATION_PLAN.md#2-design-rules)

---

## Contents
1. [Purpose and non-goals](#1-purpose-and-non-goals)
2. [Why a custom table](#2-why-a-custom-table)
3. [App layout](#3-app-layout)
4. [Models](#4-models)
5. [Audit context (who, where, which request)](#5-audit-context)
6. [Recording events](#6-recording-events)
7. [Model change tracking](#7-model-change-tracking)
8. [Serialization and redaction](#8-serialization-and-redaction)
9. [Transactions and failure behaviour](#9-transactions-and-failure-behaviour)
10. [Immutability and retention](#10-immutability-and-retention)
11. [Event catalogue](#11-event-catalogue)
12. [Migrating `PayslipAuditLog`](#12-migrating-payslipauditlog)
13. [API, access and export](#13-api-access-and-export)
14. [Performance](#14-performance)
15. [Testing](#15-testing)
16. [Later](#16-later)

---

## 1. Purpose and non-goals

**Purpose**: an append-only record of **who did what, to which record, when, from where, and what changed**, across HR, payroll and finance, isolated per workspace.

There are two kinds of entries, in one table:
- **Record changes**, captured automatically for registered models: `record.created`, `record.updated`, `record.deleted`, with field-level old/new values.
- **Business events**, recorded explicitly by services: `journal.posted`, `invoice.issued`, `payroll.period.posted_to_gl`, `period.locked`. These carry meaning that a field diff can't express ("the invoice was issued", not "status changed from DRAFT to ISSUED").

**Non-goals**:
- **Compliance scoring.** That's the `compliance` app (ERP plan §9), which may *read* audit events.
- **Undo / restore.** Deleted records keep a full snapshot for investigation, but restoring is a manual, deliberate operation.
- **Risk "severity" stored on rows.** Risk rules change over time, so risk is computed at read time (§13.3).
- **Catching raw SQL.** Writes that bypass the ORM aren't captured. Data migrations must record a `system.data_migration` event themselves.

---

## 2. Why a custom table

We considered django-simple-history and django-auditlog.
- **simple-history** creates one history table per model. Every schema change to a tracked model then needs a history migration too, which doubles migration work on exactly the tables that change most.
- **auditlog** uses a single table, but it has no workspace column. Tenant filtering would rely on JSON lookups, and it has no notion of business events.

A small custom table gives us a real `workspace_id` column, business events and field changes in one stream, and full control over redaction and immutability. Its schema rarely changes, because everything variable lives in `changes`/`metadata` JSON with a `schema_version`.

The pitfalls of hand-rolled auditing are dealt with explicitly here: §5 actor leaks, §7 bulk operations, §8 serialization crashes, §9 swallowed errors, §10 mutable logs.

---

## 3. App layout

```
apps/audit/
├─ apps.py
├─ models.py            # AuditEvent, AuditReview
├─ context.py           # ContextVar-based AuditContext + helpers
├─ middleware.py        # AuditContextMiddleware
├─ celery.py            # propagate context into Celery tasks
├─ registry.py          # EVENT_TYPES, TrackingSpec, track()
├─ tracking.py          # pre_save/post_save/post_delete handlers, AuditedQuerySet
├─ serialization.py     # serialize_value(), redact/mask
├─ api.py               # record(), bulk(), suppress_tracking()   ← the public surface
├─ risk.py              # read-time risk rules
├─ exports.py           # CSV export task
├─ views.py / serializers.py / urls.py / permissions.py
├─ admin.py             # read-only
├─ migrations/
│  ├─ 0001_initial.py
│  ├─ 0002_postgres_immutability_trigger.py
│  └─ 0003_backfill_payslip_audit_log.py
└─ tests/
```

Other apps import only `from apps.audit import api as audit`.

---

## 4. Models

```python
# apps/audit/models.py
class AuditEvent(models.Model):
    """Append-only. Never updated or deleted by application code (see §10)."""

    id = models.BigAutoField(primary_key=True)
    workspace = models.ForeignKey('core.Workspace', null=True, blank=True,
                                  on_delete=models.PROTECT, related_name='+')   # null = system-level event
    occurred_at = models.DateTimeField(default=timezone.now)

    event_type = models.CharField(max_length=64)      # 'record.updated', 'journal.posted' (validated by registry)
    category = models.CharField(max_length=20)        # 'general' | 'personal' | 'payroll' | 'finance' | 'security'

    # Who. No DB constraint, so deleting a user never touches audit rows.
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.DO_NOTHING,
                              db_constraint=False, related_name='+')
    actor_label = models.CharField(max_length=255, blank=True)   # name/email snapshot at the time
    actor_type = models.CharField(max_length=20)                 # 'user' | 'system' | 'task'

    # Where from
    request_id = models.CharField(max_length=36, blank=True)     # groups all events of one request / task
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)

    # Which record
    target_type = models.ForeignKey(ContentType, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=255, blank=True)  # str(obj) snapshot, e.g. 'INV-2026-000123'

    # What
    changes = models.JSONField(null=True, blank=True)    # {'field': [old, new], ...} (see §8)
    metadata = models.JSONField(default=dict, blank=True)
    schema_version = models.PositiveSmallIntegerField(default=1)

    objects = AuditEventManager()        # queryset .update()/.delete() raise

    class Meta:
        indexes = [
            models.Index(fields=['workspace', '-occurred_at']),
            models.Index(fields=['workspace', 'target_type', 'target_id', '-occurred_at']),
            models.Index(fields=['workspace', 'actor', '-occurred_at']),
            models.Index(fields=['workspace', 'event_type', '-occurred_at']),
            models.Index(fields=['request_id']),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableAuditError('Audit events cannot be modified')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableAuditError('Audit events cannot be deleted')


class AuditReview(models.Model):
    """Review workflow lives outside the immutable log, so reviewing never mutates an event."""
    event = models.ForeignKey(AuditEvent, on_delete=models.PROTECT, related_name='reviews')
    workspace = models.ForeignKey('core.Workspace', on_delete=models.PROTECT, related_name='+')
    reviewer = models.ForeignKey(User, on_delete=models.PROTECT, related_name='+')
    reviewed_at = models.DateTimeField(auto_now_add=True)
    outcome = models.CharField(max_length=20)       # 'ok' | 'query' | 'escalated' (registry, no choices)
    notes = models.TextField(blank=True)
```

Choices on purpose:
- **Single table, no separate ChangeLog.** Field changes live in `changes`. A second table would duplicate data and double the write cost.
- `event_type`, `category`, `actor_type` and `outcome` have **no `choices`**. They're validated in code against the registry, so adding a value never needs a migration.
- `actor` uses `db_constraint=False` + `DO_NOTHING`. A `SET_NULL` FK would force the database to **update** audit rows whenever a user is deleted, which the immutability trigger forbids.
- `workspace` is `PROTECT`: a workspace with audit history can't be deleted by accident (§10.3).

---

## 5. Audit context

Who and where come from a `ContextVar`. ContextVars are request-safe under both WSGI threads and ASGI, and are always reset, so nothing leaks into the next request.

```python
# apps/audit/context.py
@dataclass(frozen=True)
class AuditContext:
    actor_id: int | None
    actor_label: str
    actor_type: str            # 'user' | 'system' | 'task'
    workspace_id: int | None   # request workspace (fallback only, see §7.3)
    request_id: str
    ip_address: str | None = None
    user_agent: str = ''

SYSTEM = AuditContext(actor_id=None, actor_label='System', actor_type='system',
                      workspace_id=None, request_id='')

_current: ContextVar[AuditContext | None] = ContextVar('audit_context', default=None)

def get_context() -> AuditContext:
    return _current.get() or SYSTEM

@contextmanager
def audit_context(ctx: AuditContext):
    token = _current.set(ctx)
    try:
        yield ctx
    finally:
        _current.reset(token)      # always restored, even on exceptions
```

### 5.1 Middleware
```python
# apps/audit/middleware.py
class AuditContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, 'user', None)
        authenticated = bool(user and user.is_authenticated)
        request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())
        ctx = AuditContext(
            actor_id=user.pk if authenticated else None,
            actor_label=(user.get_full_name() or user.email or user.username) if authenticated else 'Anonymous',
            actor_type='user' if authenticated else 'system',
            workspace_id=getattr(getattr(request, 'workspace', None), 'pk', None),
            request_id=request_id,
            ip_address=client_ip(request),          # respects the trusted proxy setting on Render
            user_agent=request.headers.get('User-Agent', '')[:255],
        )
        with audit_context(ctx):
            response = self.get_response(request)
        response['X-Request-ID'] = request_id
        return response
```
In `hrms/settings.py` it goes **after** `apps.core.jwt_middleware.JWTAuthenticationMiddleware` and `apps.core.middleware.WorkspaceMiddleware`, so the user and workspace are already resolved.

If a DRF view authenticates differently from the JWT middleware, the shared base viewset's `initial()` calls `audit.context.refresh_from_request(request)`. That sets a new context inside the middleware's, and the outer reset still restores the original.

### 5.2 Celery
```python
# apps/audit/celery.py
@before_task_publish.connect
def _attach(headers=None, **_):
    ctx = get_context()
    headers['audit'] = {'actor_id': ctx.actor_id, 'actor_label': ctx.actor_label, 'request_id': ctx.request_id}

@task_prerun.connect
def _enter(task_id=None, task=None, **_):
    data = getattr(task.request, 'audit', None) or {}
    ctx = AuditContext(actor_id=data.get('actor_id'), actor_label=data.get('actor_label') or task.name,
                       actor_type='task', workspace_id=None,
                       request_id=data.get('request_id') or task_id)
    _tokens[task_id] = _current.set(ctx)

@task_postrun.connect
def _exit(task_id=None, **_):
    token = _tokens.pop(task_id, None)
    if token:
        _current.reset(token)
```
A task started by a user is attributed as `actor_type='task'` with the originating user and request id. Scheduled tasks show as the task name.

### 5.3 Management commands and shell
These run with the `SYSTEM` context unless they wrap their work in `audit_context(...)`. Commands that change data should set `actor_label='command:<name>'`.

---

## 6. Recording events

The public API (`apps/audit/api.py`):

```python
def record(event_type: str, *, target=None, workspace=None, changes=None, metadata=None) -> AuditEvent:
    """Write one business event. Validates event_type against EVENT_TYPES."""

@contextmanager
def bulk(event_type: str, *, target=None, workspace=None, metadata=None):
    """Suppress per-row tracking inside the block and write ONE summary event at the end.
    The block can add to the summary via the yielded dict (e.g. counts, ids)."""

@contextmanager
def suppress_tracking():
    """Internal use only (backfills, tests). Requires AUDIT_ALLOW_SUPPRESS in the caller's module."""
```

Usage in a service:
```python
from apps.audit import api as audit

audit.record('invoice.issued', target=invoice,
             metadata={'number': invoice.number, 'total': str(invoice.total), 'currency': invoice.currency})
```

Usage for bulk payroll generation (replaces thousands of per-payslip rows with one meaningful event):
```python
with audit.bulk('payroll.payslips.generated', target=period) as summary:
    payslips = generate_payslips(period, employees)        # may use bulk_create / save() in loops
    summary['count'] = len(payslips)
    summary['payslip_ids'] = [p.id for p in payslips][:1000]
    summary['truncated'] = len(payslips) > 1000
```

---

## 7. Model change tracking

### 7.1 Opt-in registry
Only registered models are tracked. Each app registers its own models in `AppConfig.ready()`, so audit imports no business app.

```python
# apps/audit/registry.py
@dataclass(frozen=True)
class TrackingSpec:
    category: str                                    # 'personal' | 'payroll' | 'finance' | 'general'
    workspace: Callable[[models.Model], int | None]  # how to find the record's workspace id
    exclude: frozenset = frozenset({'updated_at', 'created_at'})
    redact: frozenset = frozenset()                  # value replaced with '[REDACTED]'
    mask: frozenset = frozenset()                    # value replaced with '••••1234'

def track(model, **spec_kwargs):
    spec = TrackingSpec(**spec_kwargs)
    _REGISTRY[model] = spec
    pre_save.connect(_pre_save, sender=model, dispatch_uid=f'audit_pre_{model._meta.label}')
    post_save.connect(_post_save, sender=model, dispatch_uid=f'audit_post_{model._meta.label}')
    post_delete.connect(_post_delete, sender=model, dispatch_uid=f'audit_del_{model._meta.label}')
```

```python
# apps/payroll/apps.py
class PayrollConfig(AppConfig):
    def ready(self):
        from apps.audit import api as audit
        from .models import Payslip, PayrollPeriod, WorkspaceStatutorySettings, PayeTaxBand, PAYEReturn, ComplianceDocument
        audit.track(Payslip, category='payroll', workspace=lambda p: p.employee.workspace_id)
        audit.track(PayrollPeriod, category='payroll', workspace=lambda p: p.workspace_id)
        audit.track(WorkspaceStatutorySettings, category='payroll', workspace=lambda s: s.workspace_id)
        audit.track(PayeTaxBand, category='payroll', workspace=lambda b: b.workspace_id)
        audit.track(PAYEReturn, category='payroll', workspace=lambda r: r.workspace_id)
        audit.track(ComplianceDocument, category='general', workspace=lambda d: d.workspace_id)
```

Initial tracked set:

| App | Models | Category |
|---|---|---|
| core | `Workspace`, `WorkspaceMembership`, `WorkspaceModule` | general (membership role changes: security) |
| hcm | `Employee` (mask NRC, bank account), `Contract`, `Department` | personal |
| payroll | as above | payroll |
| finance | every model in `apps/finance/models/` | finance (`BankAccount.account_number` masked) |
| leave, recruitment, etc. | added later, one line each | personal |

### 7.2 Handlers
```python
# apps/audit/tracking.py
def _pre_save(sender, instance, raw=False, **kwargs):
    if raw or _suppressed():                    # fixtures load with raw=True
        return
    if instance._state.adding or instance.pk is None:
        instance._audit_before = None
        return
    fields = _tracked_attnames(sender)
    instance._audit_before = sender._base_manager.filter(pk=instance.pk).values(*fields).first()

def _post_save(sender, instance, created, raw=False, **kwargs):
    if raw or _suppressed():
        return
    spec = _REGISTRY[sender]
    before = getattr(instance, '_audit_before', None)
    instance._audit_before = None               # stored on the instance, not a global dict: nothing leaks
    after = snapshot(instance, spec)            # serialized, NOT yet redacted (§8)

    if created:
        changes = {k: [None, v] for k, v in after.items()}
        event_type = 'record.created'
    else:
        before = serialize_row(sender, before or {}, spec)
        changes = {k: [before.get(k), v] for k, v in after.items() if before.get(k) != v}
        if not changes:
            return                               # no-op save: no event
        event_type = 'record.updated'

    _write(event_type, sender, instance, spec, protect_changes(changes, spec))   # redact after diffing

def _post_delete(sender, instance, **kwargs):
    if _suppressed():
        return
    spec = _REGISTRY[sender]
    changes = {k: [v, None] for k, v in snapshot(instance, spec).items()}
    _write('record.deleted', sender, instance, spec, protect_changes(changes, spec))
```
- Old values are read with one `values()` query per tracked update. Untracked models pay nothing, because handlers are connected per sender, not globally.
- Comparison uses the serialized form, so `Decimal('10.0')` and `Decimal('10.00')` aren't reported as changes.
- Cascade deletes **are** captured. Django's collector can't fast-delete models with `post_delete` receivers, so each cascaded tracked row fires `_post_delete`.

### 7.3 Workspace resolution
1. `spec.workspace(instance)`: the record's own workspace (authoritative).
2. Otherwise the request context's `workspace_id`.
3. Otherwise `NULL` (system-level).

If (1) and the request workspace differ, the event uses (1) and stores `metadata['request_workspace_id']`. That case usually means a consultant acting in a client workspace, or a bug worth noticing.

### 7.4 Bulk operations
`bulk_create`, `bulk_update`, `QuerySet.update()` and `QuerySet.delete()` don't fire `save` signals. Tracked models get them covered by `AuditedQuerySet`:

```python
class AuditedQuerySet(models.QuerySet):
    def update(self, **kwargs):
        if _suppressed():
            return super().update(**kwargs)
        ids = list(self.values_list('pk', flat=True)[:1001])
        n = super().update(**kwargs)
        _write_bulk('record.bulk_updated', self.model, ids, n, fields=kwargs)
        return n

    def bulk_update(self, objs, fields, **kw):  ...  # one event: model, ids, field names, new values
    def bulk_create(self, objs, **kw):          ...  # one event: model, ids (if returned), count
    def delete(self):                           ...  # falls back to per-row signals via the collector
```
Each tracked model's default manager is switched to `AuditedQuerySet.as_manager()` (or the existing custom manager mixes it in). A test enforces that every model in the registry uses it. Bulk events record ids and new values, but not per-row old values, because fetching those defeats the point of a bulk operation. Where old values matter, the service wraps the work in `audit.bulk(...)` with a meaningful summary instead.

---

## 8. Serialization and redaction

`changes` format (schema_version 1): `{"<field name>": [old, new], ...}`. Values are JSON-safe primitives.

```python
# apps/audit/serialization.py
ALWAYS_REDACT = {'password', 'token', 'secret', 'api_key', 'otp', 'pin_code'}
MAX_STR = 2000

def serialize_value(field, value):
    """Total function: never raises. Unknown types fall back to a truncated repr."""
    if value is None:
        return None
    if isinstance(field, models.BinaryField):
        return f'<binary {len(value)} bytes>'
    if isinstance(field, models.FileField):
        return getattr(value, 'name', None) or None
    if isinstance(value, Decimal):
        return format(value, 'f')                  # exact, no float conversion
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, (uuid.UUID,)):
        return str(value)
    if isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= MAX_STR else value[:MAX_STR] + '…[truncated]'
    try:
        json.dumps(value, cls=DjangoJSONEncoder)   # JSONField contents
        return value
    except Exception:
        return repr(value)[:MAX_STR]

def snapshot(instance, spec):
    """Serialized field values, unredacted: used only for diffing, never stored as-is."""
    out = {}
    for f in instance._meta.concrete_fields:
        if f.name in spec.exclude or f.primary_key:
            continue
        raw = getattr(instance, f.attname)          # FK → id; never triggers a query
        out[f.name] = serialize_value(f, raw)
    return out

def protect_changes(changes, spec):
    return {name: [protect(name, old, spec), protect(name, new, spec)] for name, (old, new) in changes.items()}

def protect(name, value, spec):
    if value is None:
        return None
    if name in spec.redact or name in ALWAYS_REDACT:
        return '[REDACTED]'
    if name in spec.mask:
        s = str(value)
        return '••••' + s[-4:] if len(s) > 4 else '••••'
    return value
```
- Redacted fields still show **that** they changed (`["[REDACTED]", "[REDACTED]"]`), just not the values. To detect the change, the handler diffs the unredacted serialized values and applies `protect_changes()` only to what it stores. Raw values never reach the database.
- Salaries and amounts are **not** redacted. An audit trail without amounts is useless for payroll and finance. Access is restricted by `category` instead (§13.2).

---

## 9. Transactions and failure behaviour

- Events are written **in the same database transaction** as the change. If the business change rolls back, its event disappears with it. If the event can't be written, the change fails. For financial records, a change without an audit entry is worse than a failed save.
- That's safe only because event writing is predictable. Serialization is total (§8), and workspace resolution never raises (it returns `None`). A registry test checks every `record()` call site's `event_type`, so an unknown type fails in CI, not in production.
- There are **no bare `except` blocks**. An unexpected error in tracking is a bug, and it surfaces as an error report.
- Async writing was rejected for v1: it can lose events and complicates ordering. §14 explains why the synchronous cost is acceptable.

---

## 10. Immutability and retention

### 10.1 Guards (all four apply)
1. `AuditEvent.save()` refuses updates; `delete()` refuses.
2. `AuditEventManager`'s queryset `update()`/`delete()` raise.
3. Django admin is read-only (no add/change/delete permissions, even for superusers).
4. Postgres trigger (migration `0002`, skipped on SQLite):
```sql
CREATE FUNCTION audit_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_auditevent is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON audit_auditevent
FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();
```
Optional ops hardening: the application DB role gets only `INSERT, SELECT` on `audit_auditevent`.

### 10.2 Retention
Keep everything by default. The retention period is a pending decision (ERP plan §11) to settle with the client's accountant. When it's decided, old events are archived (exported to cold storage, then purged by a privileged command, §10.3). The schema doesn't change.

### 10.3 Purging (exceptional)
Workspace offboarding or retention purges use `manage.py audit_purge --workspace … --before …`:
- It requires superuser and a typed confirmation.
- It exports first.
- It disables the trigger only inside its own transaction.
- It writes a `system.audit_purged` event (with the workspace NULL, so the record of the purge survives).

---

## 11. Event catalogue

`registry.EVENT_TYPES` maps each type to its category. `record()` rejects unknown types.

| Event type | Category | Recorded by |
|---|---|---|
| `record.created` / `record.updated` / `record.deleted` | from spec | tracker (§7) |
| `record.bulk_updated` / `record.bulk_created` | from spec | `AuditedQuerySet` |
| `auth.login` / `auth.login_failed` / `auth.password_changed` | security | core auth views |
| `membership.role_changed` / `membership.removed` | security | core services |
| `module.enabled` / `module.disabled` | general | core services |
| `payroll.payslips.generated` | payroll | payroll generation (`audit.bulk`) |
| `payroll.payslip.calculated` | payroll | payslip calculation |
| `payroll.period.status_changed` | payroll | payroll services |
| `payroll.period.posted_to_gl` | finance | `finance.integrations.payroll` |
| `journal.posted` / `journal.reversed` | finance | `finance.services.journals` |
| `invoice.issued` / `invoice.voided` / `credit_note.issued` | finance | `finance.services.sales` |
| `bill.posted` / `payment.posted` / `payment.voided` | finance | finance services |
| `expense.submitted` / `expense.approved` / `expense.rejected` | finance | finance services |
| `period.closed` / `period.reopened` / `period.locked` / `fiscal_year.closed` | finance | finance services |
| `bank.reconciliation_completed` | finance | finance services |
| `audit.exported` | security | export task (the export is itself audited) |
| `system.data_migration` / `system.audit_purged` | general | migrations / purge command |

New event type = one registry line. No migration.

---

## 12. Migrating `PayslipAuditLog`

`apps/payroll/models.py:676` already logs payslip actions (CREATED, CALCULATED, UPDATED, DELETED) with a `changes` JSON.

1. **Phase 1 release**: data migration `0003_backfill_payslip_audit_log` copies each row to `AuditEvent`:

   | Legacy | New |
   |---|---|
   | `CREATED` / `UPDATED` / `DELETED` | `record.created` / `record.updated` / `record.deleted` |
   | `CALCULATED` | `payroll.payslip.calculated` |
   | `user`, `timestamp` | `actor`, `occurred_at`, `actor_type='user'` (or `'system'` if null) |
   | `payslip` | `target_*`; `workspace` = `payslip.employee.workspace_id` |
   | `changes` | `metadata['legacy_changes']` (format differs; not forced into `changes`) |
   | `id` | `metadata['legacy']` = `{'source': 'payroll.PayslipAuditLog', 'id': …}` |

   The migration is idempotent: it skips rows whose legacy id already exists.
2. **Same release**: replace every `PayslipAuditLog.objects.create(...)` in payroll code with `audit.record(...)` or rely on the tracker. The model stays in place, read-only.
3. **Next release**: drop `PayslipAuditLog` (contract step).

Note: the legacy FK is `on_delete=CASCADE`, so logs of payslips that were already deleted are gone and can't be recovered. The new design prevents this.

---

## 13. API, access and export

### 13.1 Endpoints (`/api/v1/audit/`)
```
GET  events/                         cursor-paginated (table is large; no offset pagination)
       ?event_type=&category=&actor=&target=<app_label.model>&target_id=
       &date_from=&date_to=&request_id=
GET  events/{id}/
GET  history/<app_label>.<model>/<id>/     full timeline of one record
GET  requests/{request_id}/                everything one request changed
POST events/{id}/reviews/                  {outcome, notes}
GET  events/{id}/reviews/
POST exports/                              {filters, format: 'csv'} → 202 + export id (Celery)
GET  exports/{id}/                         status + download link (expires)
GET  reports/risk/                         read-time risk view (§13.3)
```
Always filtered by `request.workspace`. There's no cross-workspace endpoint; the consultant portfolio calls per workspace.

### 13.2 Access by category
| Category | Roles allowed |
|---|---|
| general | OWNER, ADMIN, AUDITOR |
| personal | OWNER, ADMIN, HR_MANAGER, AUDITOR |
| payroll | OWNER, ADMIN, HR_MANAGER, FINANCE_MANAGER, AUDITOR |
| finance | OWNER, ADMIN, FINANCE_MANAGER, ACCOUNTANT, AUDITOR |
| security | OWNER, ADMIN |

The queryset is filtered to the categories the caller's role allows. The map lives in code, so changing it doesn't touch the schema.

### 13.3 Risk view (computed)
`risk.py` holds rules evaluated at read time, e.g.:
- any `record.deleted` in finance or payroll;
- changes to `tpin`, bank account, tax codes or statutory settings;
- an amount change above a threshold from `FinanceSettings.settings`;
- `period.reopened`;
- actions outside working hours.

Rules change without touching stored data, and past events are re-scored automatically.

### 13.4 Export
A CSV export runs as a Celery task over a cursor (streamed, not loaded into memory). Columns: occurred_at, actor_label, actor_type, event_type, target, field, old, new, request_id, ip. There's one CSV row per changed field. Exports are subject to the same category filter and write an `audit.exported` event. A PDF "audit pack" for an external auditor belongs to the compliance app and reuses this export.

---

## 14. Performance

- Cost per tracked save: one `SELECT` by primary key (old values) + one `INSERT`. Untracked models: zero.
- Hot paths (payroll generation for hundreds of employees) use `audit.bulk(...)`. That turns N×2 queries into one insert, and the event is more useful besides.
- Indexes all start with `workspace` and end with `-occurred_at`, matching every list query.
- Growth: at about 50M rows, convert to monthly range partitions on `occurred_at` (Postgres declarative partitioning). The model and API don't change.

---

## 15. Testing

| Area | Test |
|---|---|
| Attribution | Update by user B of a record created by user A is attributed to **B** |
| Context isolation | Two sequential requests with different users; second never sees first's actor. A Celery task gets the originating user + request id |
| Serialization | Models with Decimal, date, UUID, FileField, BinaryField, JSONField, null FK all save without error and serialize correctly |
| No-op saves | `save()` with no changes writes no event |
| Redaction | Redacted fields show as changed but values are hidden; masked fields show last 4 |
| Bulk | `update()`, `bulk_create`, `bulk_update` on tracked models each write one bulk event; `audit.bulk` writes exactly one summary event and no per-row events |
| Cascade | Deleting a parent writes `record.deleted` for tracked children |
| Transactions | Rolled-back change leaves no event; failure to write event fails the change |
| Immutability | `save()` on existing event, `delete()`, queryset `update()/delete()` raise; on Postgres, raw `UPDATE` raises from the trigger |
| Tenancy | Workspace A's API never returns workspace B's events; category filtering per role |
| Registry | Every tracked model uses `AuditedQuerySet`; every `record()` call site uses a registered event type |
| Backfill | `PayslipAuditLog` migration is idempotent and maps every action |

---

## 16. Later

All additive:
- **Tamper evidence**: nullable `prev_hash`/`hash` columns forming a per-workspace hash chain, plus a verification command.
- **Real-time feed**: stream new events to the dashboard over WebSockets.
- **Anomaly alerts**: Celery task applying `risk.py` rules to new events and notifying OWNER/AUDITOR.
- **Cold archive**: monthly export of partitions older than the retention period to S3 (django-storages is already installed).
