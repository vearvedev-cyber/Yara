"""
Leave balances.

Every change to a balance is a LeaveLedgerEntry; the balance is their sum.

- Accrual is posted per completed calendar month (pro-rata in the month of hire and the
  month employment ends). It is caught up lazily by `ensure_accruals`, so it doesn't
  depend on a scheduled worker; `manage.py leave_accrue` does the same for cron users.
- The first time an employee's balance is needed, an OPENING entry is created covering
  hire date → end of last month, with the carry-forward cap applied at each past
  leave-year end. Approved requests are then recorded as TAKEN entries, so the opening
  plus those entries equals what the policy would have produced.
- Approving, rejecting, cancelling, editing or deleting a request calls
  `sync_leave_request`, which posts whatever difference is needed.
"""

from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone

from apps.core.holidays import count_working_days, holiday_dates
from apps.hcm.models import Employee

from .models import LeaveLedgerEntry, LeavePolicy, LeaveRequest

ZERO = Decimal('0')
ANNUAL = LeaveRequest.LeaveType.ANNUAL
Kind = LeaveLedgerEntry.Kind

# Applied when a workspace has no policy row for the leave type.
DEFAULT_POLICIES = {
    ANNUAL: dict(
        days_per_month=Decimal('2.00'),
        carry_forward_cap=Decimal('12.00'),
        leave_year_start_month=1,
        count_working_days=True,
        working_weekdays='0,1,2,3,4',
        allow_negative_balance=False,
    ),
}


class InsufficientLeaveBalance(Exception):
    def __init__(self, available: Decimal, requested: Decimal):
        self.available = available
        self.requested = requested
        super().__init__(
            f"Insufficient leave balance: {available} days available, {requested} requested"
        )


def _days(value) -> Decimal:
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _month_end(d: date) -> date:
    return d.replace(day=monthrange(d.year, d.month)[1])


def _next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


def _is_leave_year_end(d: date, policy: LeavePolicy) -> bool:
    """True when d is the last day of the month before the leave year starts."""
    return d == _month_end(d) and _next_month(d).month == policy.leave_year_start_month


# ---------------------------------------------------------------------------
# Policy and working days
# ---------------------------------------------------------------------------

def get_policy(workspace, leave_type) -> LeavePolicy | None:
    """The workspace's policy for this leave type, the built-in default, or None if the
    leave type has no balance."""
    if workspace is not None:
        policy = LeavePolicy.objects.filter(workspace=workspace, leave_type=leave_type).first()
        if policy is not None:
            return policy
    defaults = DEFAULT_POLICIES.get(leave_type)
    if defaults is None:
        return None
    return LeavePolicy(workspace=workspace, leave_type=leave_type, **defaults)


def working_days_for_request(leave: LeaveRequest) -> int | None:
    """Working days in the request, or None when its leave type counts calendar days."""
    if not leave.employee_id or not leave.start_date or not leave.end_date:
        return None
    workspace = leave.employee.workspace
    policy = get_policy(workspace, leave.leave_type)
    if policy is None or not policy.count_working_days:
        return None
    holidays = holiday_dates(workspace, leave.start_date, leave.end_date)
    return count_working_days(leave.start_date, leave.end_date, policy.weekday_set, holidays)


# ---------------------------------------------------------------------------
# Accrual
# ---------------------------------------------------------------------------

def employment_end(employee: Employee) -> date | None:
    termination = getattr(employee, 'termination', None)
    return termination.termination_date if termination else None


def accrual_for_period(employee: Employee, policy: LeavePolicy, first: date, last: date) -> Decimal:
    """Days earned between first and last (inside one calendar month), pro-rata by calendar days."""
    end = employment_end(employee)
    start = max(first, employee.hire_date)
    stop = min(last, end) if end else last
    if stop < start:
        return ZERO
    month_days = monthrange(first.year, first.month)[1]
    employed = (stop - start).days + 1
    if employed == month_days:
        return policy.days_per_month
    return _days(policy.days_per_month * employed / month_days)


def current_month_accrual(employee: Employee, policy: LeavePolicy, today: date) -> Decimal:
    """Days earned so far this month (not yet posted; posted once the month is complete)."""
    return accrual_for_period(employee, policy, _month_start(today), today)


def _create_opening(employee, leave_type, policy, cutoff: date, actor=None) -> LeaveLedgerEntry:
    """Opening entry for hire month → cutoff (a month end), simulating past leave years
    so the carry-forward cap is respected. Approved requests are posted separately as
    TAKEN entries by the caller, so the opening holds accrued days less forfeitures."""
    end = employment_end(employee)
    taken_by_month: dict[date, Decimal] = defaultdict(lambda: ZERO)
    for leave in LeaveRequest.objects.filter(
        employee=employee, leave_type=leave_type,
        status=LeaveRequest.Status.APPROVED, start_date__lte=cutoff,
    ):
        taken_by_month[_month_start(leave.start_date)] += Decimal(leave.days)

    accrued = forfeited = balance = ZERO
    month = _month_start(employee.hire_date)
    while _month_end(month) <= cutoff and not (end and month > end):
        earned = accrual_for_period(employee, policy, month, _month_end(month))
        accrued += earned
        balance += earned - taken_by_month[month]
        if (policy.carry_forward_cap is not None and _is_leave_year_end(_month_end(month), policy)
                and balance > policy.carry_forward_cap):
            forfeited += balance - policy.carry_forward_cap
            balance = policy.carry_forward_cap
        month = _next_month(month)

    note = f"Accrued {accrued} days from {employee.hire_date} to {cutoff}"
    if forfeited:
        note += f", less {forfeited} days over the carry-forward cap"
    return LeaveLedgerEntry.objects.create(
        workspace=employee.workspace, employee=employee, leave_type=leave_type,
        kind=Kind.OPENING, date=cutoff, days=accrued - forfeited, note=note, created_by=actor,
    )


@transaction.atomic
def ensure_accruals(employee: Employee, leave_type=ANNUAL, today: date | None = None, actor=None):
    """Post every accrual and carry-forward expiry due up to the end of last month.
    Idempotent; safe to call on every balance read."""
    policy = get_policy(employee.workspace, leave_type)
    if policy is None or employee.hire_date is None:
        return
    # Serialize concurrent catch-ups for the same employee (no-op on SQLite).
    Employee.objects.select_for_update().filter(pk=employee.pk).first()

    today = today or timezone.localdate()
    last_completed = _month_start(today) - timedelta(days=1)
    end = employment_end(employee)

    entries = LeaveLedgerEntry.objects.filter(employee=employee, leave_type=leave_type)
    opening = entries.filter(kind=Kind.OPENING).first()
    if opening is None:
        opening = _create_opening(employee, leave_type, policy, last_completed, actor)
        for leave in LeaveRequest.objects.filter(
            employee=employee, leave_type=leave_type, status=LeaveRequest.Status.APPROVED
        ):
            sync_leave_request(leave, actor=actor)

    accrued_months = set(entries.filter(kind=Kind.ACCRUAL).values_list('period', flat=True))
    expired_years = set(entries.filter(kind=Kind.EXPIRY).values_list('period', flat=True))

    month = _next_month(_month_start(opening.date))
    while _month_end(month) <= last_completed and not (end and month > end):
        month_end = _month_end(month)
        if month not in accrued_months:
            earned = accrual_for_period(employee, policy, month, month_end)
            if earned:
                LeaveLedgerEntry.objects.create(
                    workspace=employee.workspace, employee=employee, leave_type=leave_type,
                    kind=Kind.ACCRUAL, date=month_end, period=month, days=earned,
                    note=f"{month:%B %Y}", created_by=actor,
                )
        if (policy.carry_forward_cap is not None and _is_leave_year_end(month_end, policy)
                and month_end not in expired_years):
            balance = entries.filter(date__lte=month_end).aggregate(t=Sum('days'))['t'] or ZERO
            excess = balance - policy.carry_forward_cap
            if excess > 0:
                LeaveLedgerEntry.objects.create(
                    workspace=employee.workspace, employee=employee, leave_type=leave_type,
                    kind=Kind.EXPIRY, date=month_end, period=month_end, days=-excess,
                    note=f"Above the {policy.carry_forward_cap}-day carry-forward cap", created_by=actor,
                )
        month = _next_month(month)


def ensure_workspace_accruals(workspace, leave_type=ANNUAL, today: date | None = None):
    """Catch up only the employees that are behind (one query to find them)."""
    today = today or timezone.localdate()
    last_completed_month = _month_start(_month_start(today) - timedelta(days=1))
    employees = Employee.objects.filter(workspace=workspace, hire_date__isnull=False)
    with_opening = set(
        LeaveLedgerEntry.objects.filter(
            workspace=workspace, leave_type=leave_type, kind=Kind.OPENING
        ).values_list('employee_id', flat=True)
    )
    latest = dict(
        LeaveLedgerEntry.objects.filter(workspace=workspace, leave_type=leave_type)
        .filter(kind__in=[Kind.OPENING, Kind.ACCRUAL])
        .values('employee_id').annotate(last=Max('date')).values_list('employee_id', 'last')
    )
    for employee in employees.select_related('termination', 'workspace'):
        last = latest.get(employee.pk)
        end = employment_end(employee)
        up_to_date = last is not None and (
            last >= _month_end(last_completed_month) or (end is not None and last >= _month_end(end))
        )
        if employee.pk not in with_opening or not up_to_date:
            ensure_accruals(employee, leave_type, today)


# ---------------------------------------------------------------------------
# Requests and balances
# ---------------------------------------------------------------------------

def sync_leave_request(leave: LeaveRequest, actor=None, deleted: bool = False):
    """Post the difference between what the request should have deducted and what the
    ledger already shows for it. Handles approve, reject/cancel after approval, date
    changes and deletion."""
    policy = get_policy(leave.employee.workspace, leave.leave_type)
    if policy is None or leave.pk is None:
        return None
    should_be = (
        -Decimal(leave.days)
        if leave.status == LeaveRequest.Status.APPROVED and not deleted
        else ZERO
    )
    already = LeaveLedgerEntry.objects.filter(
        source_type='leave_request', source_id=str(leave.pk)
    ).aggregate(t=Sum('days'))['t'] or ZERO
    delta = should_be - already
    if delta == 0:
        return None
    if already == 0:
        note = f"Leave {leave.start_date} to {leave.end_date}"
    elif should_be == 0:
        note = f"Reversal: leave {'deleted' if deleted else leave.status.lower()}"
    else:
        note = f"Leave changed to {leave.start_date} to {leave.end_date}"
    return LeaveLedgerEntry.objects.create(
        workspace=leave.employee.workspace, employee=leave.employee, leave_type=leave.leave_type,
        kind=Kind.TAKEN, date=leave.start_date, days=delta,
        source_type='leave_request', source_id=str(leave.pk), note=note, created_by=actor,
    )


def get_balance(employee: Employee, leave_type=ANNUAL, today: date | None = None) -> dict | None:
    policy = get_policy(employee.workspace, leave_type)
    if policy is None:
        return None
    today = today or timezone.localdate()
    ensure_accruals(employee, leave_type, today)
    totals = dict(
        LeaveLedgerEntry.objects.filter(employee=employee, leave_type=leave_type)
        .values('kind').annotate(t=Sum('days')).values_list('kind', 't')
    )
    balance = sum(totals.values(), ZERO)
    this_month = current_month_accrual(employee, policy, today)
    return {
        'employee': employee.pk,
        'leave_type': leave_type,
        'opening': totals.get(Kind.OPENING, ZERO),
        'accrued': totals.get(Kind.ACCRUAL, ZERO),
        'taken': -totals.get(Kind.TAKEN, ZERO),
        'adjustments': totals.get(Kind.ADJUSTMENT, ZERO),
        'expired': -totals.get(Kind.EXPIRY, ZERO),
        'paid_out': -totals.get(Kind.PAID_OUT, ZERO),
        'balance': balance,
        'accruing_this_month': this_month,
        'available': balance + this_month,
        'days_per_month': policy.days_per_month,
        'carry_forward_cap': policy.carry_forward_cap,
    }


def check_can_approve(leave: LeaveRequest, today: date | None = None):
    """Raise InsufficientLeaveBalance if approving would overdraw the balance."""
    policy = get_policy(leave.employee.workspace, leave.leave_type)
    if policy is None or policy.allow_negative_balance:
        return
    leave.recalc_days()
    summary = get_balance(leave.employee, leave.leave_type, today)
    already = -(LeaveLedgerEntry.objects.filter(
        source_type='leave_request', source_id=str(leave.pk)
    ).aggregate(t=Sum('days'))['t'] or ZERO)
    available = summary['available'] + already  # re-approving doesn't count its own days twice
    if Decimal(leave.days) > available:
        raise InsufficientLeaveBalance(available, Decimal(leave.days))


def adjust_balance(employee: Employee, leave_type, days: Decimal, note: str, actor=None,
                   on: date | None = None) -> LeaveLedgerEntry:
    if not note or not note.strip():
        raise ValueError("A reason is required for a manual adjustment")
    if get_policy(employee.workspace, leave_type) is None:
        raise ValueError(f"{leave_type} leave has no balance to adjust")
    ensure_accruals(employee, leave_type)
    return LeaveLedgerEntry.objects.create(
        workspace=employee.workspace, employee=employee, leave_type=leave_type,
        kind=Kind.ADJUSTMENT, date=on or timezone.localdate(), days=_days(days),
        note=note.strip()[:255], created_by=actor,
    )
