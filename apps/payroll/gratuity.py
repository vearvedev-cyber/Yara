"""
Gratuity and short-term severance on fixed-duration contracts
(Employment Code Act No. 3 of 2019).

- Long-term contract (more than 12 months): gratuity of at least 25% of the basic pay
  earned during the contract (s73).
- Shorter fixed-duration contract: severance pay of at least 25% of basic pay (s54).
- Ended early, including by dismissal: paid pro rata to the period actually worked
  (s51(1), s73(2)). Accrued gratuity is never forfeited.

"Basic pay earned" for a month is the basic salary less unpaid leave (basic ÷ 26 per
unpaid day, the divisor payroll uses), apportioned by calendar days to the part of the
month the contract covers, so a contract starting on the 16th, or a renewal mid-month,
counts only its own days.

Nothing is stored per month: the figure is calculated from the payslips (the facts),
so regenerating a payslip changes it automatically. Only payments are recorded
(GratuityPayment). Months with no payslip in the system (e.g. before payroll moved
here) use the contract's basic salary, less approved unpaid leave, marked "estimate".
"""

from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.hcm.models import Contract

from .models import GratuityPayment, GratuityPolicy, Payslip

ZERO = Decimal('0')
CENT = Decimal('0.01')
WORKING_DAYS_PER_MONTH = Decimal('26')   # same divisor payroll uses for unpaid leave

DEFAULT_POLICY = dict(
    rate_percent=Decimal('25.00'),
    eligible_contract_types='FIXED_TERM,SHORT_TERM',
    long_term_months=12,
    estimate_missing_months=True,
)

# Which statutory benefit applies
GRATUITY = 'GRATUITY'                      # long-term contract, s73
SHORT_TERM_SEVERANCE = 'SHORT_TERM_SEVERANCE'  # fixed-duration contract of 12 months or less, s54
LEGAL_BASIS = {
    GRATUITY: 'Gratuity on a long-term contract (Employment Code Act s73)',
    SHORT_TERM_SEVERANCE: 'Severance pay on a short-term fixed-duration contract (Employment Code Act s54)',
}

# Status of a contract's benefit
NOT_ELIGIBLE = 'NOT_ELIGIBLE'
ACCRUING = 'ACCRUING'        # contract running
DUE = 'DUE'                  # service ended, outstanding > 0
PAID = 'PAID'                # service ended, nothing outstanding


def _money(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def get_gratuity_policy(workspace) -> GratuityPolicy:
    if workspace is not None:
        policy = GratuityPolicy.objects.filter(workspace=workspace).first()
        if policy is not None:
            return policy
    return GratuityPolicy(workspace=workspace, **DEFAULT_POLICY)


def _add_months(d: date, months: int) -> date:
    year, month = divmod(d.month - 1 + months, 12)
    year, month = d.year + year, month + 1
    return date(year, month, min(d.day, monthrange(year, month)[1]))


def contract_months(contract: Contract) -> Decimal | None:
    """Length of the contract in calendar months (1 Jan – 31 Dec is exactly 12), plus any
    leftover days as a fraction of a month."""
    if not contract.end_date:
        return None
    start, end_exclusive = contract.start_date, contract.end_date + timedelta(days=1)
    months = (end_exclusive.year - start.year) * 12 + (end_exclusive.month - start.month)
    if _add_months(start, months) > end_exclusive:
        months -= 1
    anchor = _add_months(start, months)
    leftover = (end_exclusive - anchor).days
    return _money(Decimal(months) + Decimal(leftover) / monthrange(anchor.year, anchor.month)[1])


def benefit_for(contract: Contract, policy: GratuityPolicy) -> tuple[str | None, str]:
    """(benefit, reason). benefit is None when the contract doesn't earn one."""
    type_name = getattr(contract.contract_type, 'name', '')
    if type_name not in policy.contract_type_names:
        return None, f"{contract.contract_type} contracts aren't fixed-duration contracts under the policy"
    months = contract_months(contract)
    if months is None:
        return None, "The contract has no end date, so it isn't a fixed-duration contract"
    if months > policy.long_term_months:
        return GRATUITY, ''
    return SHORT_TERM_SEVERANCE, ''


def _unpaid_leave_days(employee, first: date, last: date) -> int:
    """Calendar days of approved unpaid leave between first and last (as payroll counts them)."""
    from apps.leave.models import LeaveRequest

    days = 0
    for leave in LeaveRequest.objects.filter(
        employee=employee, leave_type='UNPAID', status='APPROVED', start_date__lte=last, end_date__gte=first,
    ):
        days += (min(leave.end_date, last) - max(leave.start_date, first)).days + 1
    return days


@dataclass
class GratuityMonth:
    year: int
    month: int
    days_covered: int
    days_in_month: int
    basic_salary: Decimal           # full monthly basic used
    unpaid_leave_days: Decimal
    unpaid_leave_reduction: Decimal  # basic ÷ 26 × unpaid days
    basic_earned: Decimal           # apportioned to the days covered, less unpaid leave
    source: str                     # 'payslip' | 'estimate' | 'missing'
    payslip_id: int | None = None


@dataclass
class ContractGratuity:
    contract: Contract
    benefit: str | None
    reason: str
    rate_percent: Decimal
    service_end: date | None
    months: list[GratuityMonth] = field(default_factory=list)
    basic_earned: Decimal = ZERO
    gratuity_earned: Decimal = ZERO
    paid: Decimal = ZERO
    outstanding: Decimal = ZERO
    status: str = NOT_ELIGIBLE
    ended_early: bool = False
    estimated_months: int = 0
    missing_months: int = 0

    @property
    def eligible(self) -> bool:
        return self.benefit is not None

    def as_dict(self) -> dict:
        c = self.contract
        return {
            'contract': c.pk,
            'contract_number': c.contract_number,
            'employee': c.employee_id,
            'employee_name': c.employee.full_name,
            'employee_code': c.employee.employee_id,
            'contract_type': getattr(c.contract_type, 'name', ''),
            'start_date': c.start_date,
            'end_date': c.end_date,
            'contract_months': contract_months(c),
            'service_end': self.service_end,
            'eligible': self.eligible,
            'benefit': self.benefit,
            'legal_basis': LEGAL_BASIS.get(self.benefit, ''),
            'reason': self.reason,
            'rate_percent': self.rate_percent,
            'basic_earned': self.basic_earned,
            'gratuity_earned': self.gratuity_earned,
            'paid': self.paid,
            'outstanding': self.outstanding,
            'status': self.status,
            'ended_early': self.ended_early,
            'employee_has_left': getattr(c.employee, 'termination', None) is not None,
            'estimated_months': self.estimated_months,
            'missing_months': self.missing_months,
        }


def _months_between(start: date, end: date):
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def calculate_contract_gratuity(contract: Contract, as_of: date | None = None,
                                policy: GratuityPolicy | None = None) -> ContractGratuity:
    """Gratuity (or short-term severance) earned on a contract up to as_of (default
    today), the earlier of the contract end and the employee's termination."""
    employee = contract.employee
    policy = policy or get_gratuity_policy(employee.workspace)
    as_of = as_of or timezone.localdate()
    benefit, reason = benefit_for(contract, policy)
    result = ContractGratuity(contract=contract, benefit=benefit, reason=reason,
                              rate_percent=policy.rate_percent, service_end=None)
    if benefit is None:
        return result

    termination = getattr(employee, 'termination', None)
    ends = [d for d in (contract.end_date, termination.termination_date if termination else None) if d]
    service_end = min(ends)
    result.service_end = service_end
    result.ended_early = service_end < contract.end_date
    last_day = min(service_end, as_of)
    if last_day < contract.start_date:
        result.status = ACCRUING
        return result

    # Latest active payslip per (year, month) for this employee
    payslips = {}
    for slip in (Payslip.objects.filter(employee=employee, is_active=True)
                 .select_related('period').order_by('version', 'id')):
        payslips[(slip.period.year, slip.period.month)] = slip

    for year, month in _months_between(contract.start_date, last_day):
        days_in_month = monthrange(year, month)[1]
        first, final = date(year, month, 1), date(year, month, days_in_month)
        window_start, window_end = max(first, contract.start_date), min(final, last_day)
        covered = (window_end - window_start).days + 1
        slip = payslips.get((year, month))
        month_finished = final <= as_of
        if slip is not None:
            basic, source, slip_id = Decimal(slip.basic_salary), 'payslip', slip.pk
            unpaid_days = Decimal(slip.unpaid_leave_days or 0)
        elif policy.estimate_missing_months and contract.basic_salary and month_finished:
            basic, source, slip_id = Decimal(contract.basic_salary), 'estimate', None
            unpaid_days = Decimal(_unpaid_leave_days(employee, window_start, window_end))
        elif month_finished or (termination and termination.termination_date <= final):
            basic, source, slip_id, unpaid_days = ZERO, 'missing', None, ZERO
        else:
            continue  # current month, payroll not run yet

        apportioned = basic * covered / days_in_month
        reduction = min(_money(basic / WORKING_DAYS_PER_MONTH * unpaid_days), _money(apportioned))
        earned = _money(apportioned - reduction)
        result.months.append(GratuityMonth(
            year, month, covered, days_in_month, basic, unpaid_days, reduction, earned, source, slip_id,
        ))

    result.basic_earned = sum((m.basic_earned for m in result.months), ZERO)
    result.gratuity_earned = _money(result.basic_earned * policy.rate_percent / 100)
    result.estimated_months = sum(1 for m in result.months if m.source == 'estimate')
    result.missing_months = sum(1 for m in result.months if m.source == 'missing')
    result.paid = GratuityPayment.objects.filter(contract=contract).aggregate(t=Sum('amount'))['t'] or ZERO
    result.outstanding = max(result.gratuity_earned - result.paid, ZERO)
    if service_end > as_of:
        result.status = ACCRUING
    else:
        result.status = DUE if result.outstanding > 0 else PAID
    return result


def record_gratuity_payment(contract: Contract, amount: Decimal, paid_on: date, covers_to: date,
                            actor=None, source_type: str = '', source_id: str = '',
                            note: str = '') -> GratuityPayment:
    if amount <= 0:
        raise ValueError("Gratuity payment must be more than zero")
    return GratuityPayment.objects.create(
        workspace=contract.employee.workspace, contract=contract, employee=contract.employee,
        amount=_money(amount), paid_on=paid_on, covers_to=covers_to,
        source_type=source_type, source_id=str(source_id), note=note[:255], created_by=actor,
    )
