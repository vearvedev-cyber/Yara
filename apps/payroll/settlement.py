"""
Final settlements: what an employee is owed (or owes) when they leave, or the gratuity
payout when a fixed-duration contract ends and is renewed.

calculate_settlement() rebuilds the automatic lines of a DRAFT settlement and keeps the
manual ones; approve_settlement() locks it and records leave paid out; mark_settlement_paid()
records the gratuity payments. All money is Decimal.

Lines and how they are worked out (EXIT):
- final_salary   pro-rata monthly pay for the final month, less unpaid leave (gross ÷ 26 per
                 day, as payroll does). Skipped if a payslip already covers that month.
- leave_pay      annual leave balance at the last working day × basic ÷ divisor (26).
                 A negative balance becomes a `leave_advance` deduction.
- gratuity /     outstanding on every fixed-duration contract, including the final
  short_term_severance   partial month's basic pay (never forfeited; s51(1), s73(2), s54).
- redundancy_severance   basic × months per year served (policy, default 2) for redundancy.
- paye/napsa/nhima       on the earning lines flagged for each, combined with any payslip
                 already paid for the final month (and less what it already deducted).
                 For employer-borne employees they are employer costs, not deductions.

Tax streams (ZRA / statutory contributions):
- Gratuity and short-term severance up to the statutory 25%: no PAYE, NAPSA or NHIMA.
  Any contractual part above 25% is a separate `*_excess` line taxed with PAYE only.
- Redundancy pay: no NAPSA or NHIMA; free of PAYE up to the lifetime limit
  (SettlementPolicy.redundancy_tax_free_limit, K2,000,000), counting redundancy already
  paid to the employee in earlier settlements. The excess is a separate PAYE-only line.
- Final salary, leave pay, notice pay: normal emoluments (PAYE, NAPSA, NHIMA).
"""

from calendar import monthrange
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.hcm.models import Contract

from .gratuity import (
    GRATUITY, LEGAL_BASIS, SHORT_TERM_SEVERANCE, _unpaid_leave_days, calculate_contract_gratuity,
    get_gratuity_policy, record_gratuity_payment,
)
from .models import FinalSettlement, Payslip, SettlementLine, SettlementPolicy
from .utils import get_paye_tax_bands, get_statutory_settings

ZERO = Decimal('0')
CENT = Decimal('0.01')
Line = SettlementLine.Category

DEFAULT_SETTLEMENT_POLICY = dict(
    leave_pay_divisor=Decimal('26'),
    redundancy_months_per_year=Decimal('2.00'),
    redundancy_tax_free_limit=Decimal('2000000.00'),
    tax_treatment={},
)
STATUTORY_GRATUITY_RATE = Decimal('25')

# kind → (PAYE, NAPSA, NHIMA). Overridable per workspace (SettlementPolicy.tax_treatment).
DEFAULT_TAX_TREATMENT = {
    'final_salary': (True, True, True),
    'leave_pay': (True, True, True),
    'notice_pay': (True, True, True),
    'other_earning': (True, True, True),
    'gratuity': (False, False, False),                 # statutory 25%: exempt
    'gratuity_excess': (True, False, False),           # contractual part above 25%
    'short_term_severance': (False, False, False),
    'short_term_severance_excess': (True, False, False),
    'redundancy_severance': (False, False, False),     # within the lifetime tax-free limit
    'redundancy_severance_taxable': (True, False, False),
}
GRATUITY_KINDS = ('gratuity', 'gratuity_excess', 'short_term_severance', 'short_term_severance_excess')

EARNING_KINDS = {
    'final_salary': 'Salary for final month',
    'leave_pay': 'Leave days paid out',
    'gratuity': 'Gratuity',
    'gratuity_excess': 'Gratuity above the statutory 25%',
    'short_term_severance': 'Short-term contract severance pay',
    'short_term_severance_excess': 'Short-term severance above the statutory 25%',
    'redundancy_severance': 'Redundancy pay (tax-free portion)',
    'redundancy_severance_taxable': 'Redundancy pay above the tax-free limit',
    'notice_pay': 'Pay in lieu of notice',
    'other_earning': 'Other earning',
}
DEDUCTION_KINDS = {
    'paye': 'PAYE',
    'napsa': 'NAPSA (employee)',
    'nhima': 'NHIMA (employee)',
    'leave_advance': 'Leave taken in advance',
    'loan_recovery': 'Loan balance recovered',
    'advance_recovery': 'Salary advance recovered',
    'unreturned_property': 'Unreturned company property',
    'notice_shortfall': 'Notice not served',
    'other_deduction': 'Other deduction',
}
MANUAL_EARNING_KINDS = {'notice_pay', 'other_earning'}
MANUAL_DEDUCTION_KINDS = {'loan_recovery', 'advance_recovery', 'unreturned_property', 'notice_shortfall', 'other_deduction'}


class SettlementError(Exception):
    pass


def _money(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def _k(value: Decimal) -> str:
    return f"K{value:,.2f}"


def get_settlement_policy(workspace) -> SettlementPolicy:
    if workspace is not None:
        policy = SettlementPolicy.objects.filter(workspace=workspace).first()
        if policy is not None:
            return policy
    return SettlementPolicy(workspace=workspace, **DEFAULT_SETTLEMENT_POLICY)


def tax_flags(kind: str, policy: SettlementPolicy) -> tuple[bool, bool, bool]:
    override = (policy.tax_treatment or {}).get(kind)
    if isinstance(override, dict):
        return bool(override.get('paye')), bool(override.get('napsa')), bool(override.get('nhima'))
    return DEFAULT_TAX_TREATMENT.get(kind, (False, False, False))


# ---------------------------------------------------------------------------
# Pay components
# ---------------------------------------------------------------------------

def monthly_pay(employee) -> dict:
    """Current monthly basic and gross: salary setup first, then latest payslip, then contract."""
    entry = employee.payroll_entries.order_by('-updated_at', '-created_at').first()
    if entry and entry.gross:
        return {'basic': Decimal(entry.basic), 'gross': Decimal(entry.gross), 'source': 'salary setup',
                'employer_borne': entry.employer_borne_deductions}
    slip = (Payslip.objects.filter(employee=employee, is_active=True)
            .select_related('period').order_by('-period__year', '-period__month', '-version').first())
    if slip:
        return {'basic': Decimal(slip.basic_salary), 'gross': Decimal(slip.gross_salary),
                'source': f'payslip {slip.period}', 'employer_borne': slip.employer_borne_deductions}
    contract = employee.contracts.exclude(basic_salary__isnull=True).order_by('-start_date').first()
    if contract:
        basic = Decimal(contract.basic_salary)
        return {'basic': basic, 'gross': basic, 'source': f'contract {contract.contract_number}',
                'employer_borne': False}
    return {'basic': ZERO, 'gross': ZERO, 'source': 'none', 'employer_borne': False}


def _paye(chargeable: Decimal, bands) -> Decimal:
    paye, previous_max = ZERO, ZERO
    for max_amount, rate in bands:
        if chargeable <= previous_max:
            break
        top = chargeable if max_amount == float('inf') else min(chargeable, Decimal(str(max_amount)))
        paye += (top - previous_max) * Decimal(str(rate))
        if max_amount == float('inf'):
            break
        previous_max = Decimal(str(max_amount))
    return paye


def statutory(workspace, paye_base: Decimal, napsa_base: Decimal, nhima_base: Decimal,
              gross_up: bool = False) -> dict:
    """PAYE, NAPSA and NHIMA (employee and employer) on the given monthly bases, using the
    workspace's statutory settings and PAYE bands (same rules as payroll, in Decimal).
    gross_up: the employer pays the PAYE (free-of-tax pay), so the tax paid is taxable too:
    PAYE = tax on (chargeable + PAYE), solved by iteration. Returned as 'paye_gross_up'."""
    rates = get_statutory_settings(workspace)
    napsa_rate = Decimal(str(rates['napsa_rate']))
    napsa_cap = Decimal(str(rates['napsa_ceiling'])) * napsa_rate
    nhima_rate = Decimal(str(rates['nhima_rate']))
    bands = get_paye_tax_bands(workspace)

    napsa = _money(min(max(napsa_base, ZERO) * napsa_rate, napsa_cap))
    nhima = _money(max(nhima_base, ZERO) * nhima_rate)
    chargeable = max(paye_base - napsa, ZERO)
    paye = _paye(chargeable, bands)
    gross_up_amount = ZERO
    if gross_up:
        for _ in range(100):
            next_paye = _paye(chargeable + paye, bands)
            if abs(next_paye - paye) < Decimal('0.001'):
                paye = next_paye
                break
            paye = next_paye
        gross_up_amount = _money(paye)
    return {'paye': _money(paye), 'napsa': napsa, 'nhima': nhima, 'napsa_employer': napsa,
            'nhima_employer': nhima, 'paye_gross_up': gross_up_amount}


def _leave_balance_at(employee, last_day: date) -> tuple[Decimal, list[str]] | None:
    """Annual leave days owed at the last working day, or None if annual leave has no balance."""
    from apps.leave.balances import accrual_for_period, ensure_accruals, get_policy
    from apps.leave.models import LeaveLedgerEntry

    policy = get_policy(employee.workspace, 'ANNUAL')
    if policy is None:
        return None
    ensure_accruals(employee, 'ANNUAL')
    notes = []
    entries = LeaveLedgerEntry.objects.filter(employee=employee, leave_type='ANNUAL')
    total = entries.aggregate(t=Sum('days'))['t'] or ZERO
    future = entries.filter(kind=LeaveLedgerEntry.Kind.TAKEN, date__gt=last_day).aggregate(t=Sum('days'))['t'] or ZERO
    if future:
        total -= future
        notes.append(f"{-future} days of approved leave after the last working day were ignored; cancel those requests.")
    month_start = last_day.replace(day=1)
    month_end = last_day.replace(day=monthrange(last_day.year, last_day.month)[1])
    accrued_final_month = (
        entries.filter(kind=LeaveLedgerEntry.Kind.ACCRUAL, period=month_start).exists()
        or entries.filter(kind=LeaveLedgerEntry.Kind.OPENING, date__gte=month_end).exists()
    )
    if not accrued_final_month:
        total += accrual_for_period(employee, policy, month_start, last_day)
    return total, notes


def _fixed_duration_contracts(employee, settlement: FinalSettlement) -> list[Contract]:
    if settlement.kind == FinalSettlement.Kind.CONTRACT_END:
        return [settlement.contract] if settlement.contract else []
    # Contracts already being paid through a contract-end payout aren't paid again here
    covered = FinalSettlement.objects.filter(
        employee=employee, kind=FinalSettlement.Kind.CONTRACT_END,
    ).exclude(status=FinalSettlement.Status.CANCELLED).values('contract_id')
    return list(employee.contracts.exclude(pk__in=covered).select_related('contract_type').order_by('start_date'))


# ---------------------------------------------------------------------------
# Calculation
# ---------------------------------------------------------------------------

@transaction.atomic
def calculate_settlement(settlement: FinalSettlement) -> FinalSettlement:
    settlement = FinalSettlement.objects.select_for_update().get(pk=settlement.pk)
    if settlement.status != FinalSettlement.Status.DRAFT:
        raise SettlementError('Only draft settlements can be recalculated')

    employee = settlement.employee
    workspace = employee.workspace
    last_day = settlement.last_working_day
    policy = get_settlement_policy(workspace)
    pay = monthly_pay(employee)
    notes: list[str] = []
    auto: list[dict] = []

    def earning(kind, amount, basis, description=None, data=None):
        paye, napsa, nhima = tax_flags(kind, policy)
        auto.append(dict(kind=kind, category=Line.EARNING, description=description or EARNING_KINDS[kind],
                         basis=basis, amount=_money(amount), paye=paye, napsa=napsa, nhima=nhima, data=data or {}))

    def deduction(kind, amount, basis, data=None):
        auto.append(dict(kind=kind, category=Line.DEDUCTION, description=DEDUCTION_KINDS[kind],
                         basis=basis, amount=_money(amount), data=data or {}))

    if pay['source'] == 'none':
        notes.append('No salary found (salary setup, payslip or contract); salary-based lines are zero.')

    final_month_slip = None
    final_basic_earned = ZERO
    month_start = last_day.replace(day=1)
    days_in_month = monthrange(last_day.year, last_day.month)[1]

    if settlement.kind == FinalSettlement.Kind.EXIT:
        # 1. Final month's salary
        final_month_slip = (Payslip.objects.filter(employee=employee, is_active=True,
                                                   period__year=last_day.year, period__month=last_day.month)
                            .order_by('-version').first())
        if final_month_slip:
            notes.append(f"A payslip already covers {last_day:%B %Y}, so the final month's salary isn't repeated here.")
        else:
            start = max(month_start, employee.hire_date)
            days = (last_day - start).days + 1 if last_day >= start else 0
            unpaid = _unpaid_leave_days(employee, start, last_day) if days else 0
            gross = pay['gross'] * days / days_in_month - pay['gross'] / 26 * unpaid
            final_basic_earned = max(_money(pay['basic'] * days / days_in_month - pay['basic'] / 26 * unpaid), ZERO)
            basis = f"{days}/{days_in_month} days × {_k(pay['gross'])}"
            if unpaid:
                basis += f", less {unpaid} unpaid leave day(s)"
            if days:
                earning('final_salary', max(gross, ZERO), basis,
                        data={'days': days, 'unpaid_days': unpaid, 'monthly_gross': str(pay['gross']),
                              'basic_earned': str(final_basic_earned), 'source': pay['source']})

        # 2. Leave payout
        balance = _leave_balance_at(employee, last_day)
        if balance is not None:
            days_owed, leave_notes = balance
            notes.extend(leave_notes)
            daily = _money(pay['basic'] / policy.leave_pay_divisor) if pay['basic'] else ZERO
            days_owed = days_owed.quantize(CENT)
            data = {'days': str(days_owed), 'daily_rate': str(daily), 'divisor': str(policy.leave_pay_divisor)}
            if days_owed > 0:
                earning('leave_pay', days_owed * daily, f"{days_owed} days × {_k(daily)} (basic ÷ {policy.leave_pay_divisor})", data=data)
            elif days_owed < 0:
                deduction('leave_advance', -days_owed * daily, f"{-days_owed} days × {_k(daily)}", data=data)

    # 3. Gratuity / short-term severance on fixed-duration contracts
    gratuity_policy = get_gratuity_policy(workspace)
    for contract in _fixed_duration_contracts(employee, settlement):
        as_of = last_day if settlement.kind == FinalSettlement.Kind.EXIT else (contract.end_date or last_day)
        result = calculate_contract_gratuity(contract, as_of=as_of, policy=gratuity_policy)
        if not result.eligible or contract.start_date > as_of:
            continue
        extra = ZERO
        final = next((m for m in result.months if (m.year, m.month) == (last_day.year, last_day.month)), None)
        if (settlement.kind == FinalSettlement.Kind.EXIT and final_basic_earned
                and (final is None or final.source == 'missing') and contract.start_date <= last_day):
            extra = _money(final_basic_earned * result.rate_percent / 100)
        amount = result.outstanding + extra
        if amount <= 0:
            continue
        kind = 'gratuity' if result.benefit == GRATUITY else 'short_term_severance'
        basic_total = result.basic_earned + final_basic_earned if extra else result.basic_earned
        rate = result.rate_percent
        data = {'contract': contract.pk, 'legal_basis': LEGAL_BASIS[result.benefit],
                'basic_earned': str(result.basic_earned), 'final_month_basic': str(final_basic_earned if extra else ZERO),
                'estimated_months': result.estimated_months, 'missing_months': result.missing_months}
        suffix = ''
        if result.paid:
            suffix += f", less {_k(result.paid)} already paid"
        if result.ended_early:
            suffix += f" (pro rata to {result.service_end})"
        # The statutory 25% is tax-free; a contractual rate above it is taxed (PAYE only)
        statutory_part = _money(amount * STATUTORY_GRATUITY_RATE / rate) if rate > STATUTORY_GRATUITY_RATE else amount
        excess_part = amount - statutory_part
        earning(kind, statutory_part,
                f"{min(rate, STATUTORY_GRATUITY_RATE)}% × {_k(basic_total)} basic earned{suffix} — tax-free",
                description=f"{EARNING_KINDS[kind]} — {contract.contract_number}", data=data)
        if excess_part > 0:
            earning(f'{kind}_excess', excess_part,
                    f"{rate - STATUTORY_GRATUITY_RATE}% × {_k(basic_total)} contractual top-up — taxed (PAYE)",
                    description=f"{EARNING_KINDS[kind + '_excess']} — {contract.contract_number}", data=data)
        if result.estimated_months:
            notes.append(f"{contract.contract_number}: {result.estimated_months} month(s) estimated from the contract's basic salary.")
        if result.missing_months:
            notes.append(f"{contract.contract_number}: {result.missing_months} month(s) have no payslip and no contract salary (counted as zero).")

    # 4. Redundancy severance
    termination = settlement.termination
    reason = getattr(getattr(termination, 'termination_reason', None), 'name', '')
    if settlement.kind == FinalSettlement.Kind.EXIT and reason == 'REDUNDANCY':
        years = (Decimal((last_day - employee.hire_date).days + 1) / Decimal('365.25')).quantize(CENT)
        amount = _money(pay['basic'] * policy.redundancy_months_per_year * years)
        basis = f"{policy.redundancy_months_per_year} months × {_k(pay['basic'])} × {years} years served"
        used_before = (SettlementLine.objects
                       .filter(settlement__employee=employee, kind='redundancy_severance',
                               settlement__status__in=[FinalSettlement.Status.APPROVED, FinalSettlement.Status.PAID])
                       .exclude(settlement=settlement)
                       .aggregate(t=Sum('amount'))['t'] or ZERO)
        # plus redundancy received before go-live or from other employers
        used_before += employee.prior_redundancy_payments.aggregate(t=Sum('amount'))['t'] or ZERO
        allowance = max(policy.redundancy_tax_free_limit - used_before, ZERO)
        tax_free, taxable = min(amount, allowance), max(amount - allowance, ZERO)
        data = {'years': str(years), 'total': str(amount), 'tax_free_limit': str(policy.redundancy_tax_free_limit),
                'limit_used_before': str(used_before)}
        if tax_free > 0:
            earning('redundancy_severance', tax_free, f"{basis} — tax-free", data=data)
        if taxable > 0:
            earning('redundancy_severance_taxable', taxable,
                    f"Above the {_k(policy.redundancy_tax_free_limit)} lifetime tax-free limit"
                    + (f" ({_k(used_before)} already used by earlier redundancy pay)" if used_before else ''),
                    data=data)
    if reason == 'DECEASED' and not settlement.payee_name:
        notes.append('The employee is deceased: enter the estate or beneficiary as payee.')

    # Replace automatic lines, keep manual ones
    settlement.lines.filter(is_manual=False).delete()
    manual = list(settlement.lines.filter(is_manual=True).order_by('line_no'))

    # 5. Statutory deductions on flagged earnings (+ payslip already paid for the final month)
    earnings = [l for l in auto if l['category'] == Line.EARNING] + [
        dict(paye=m.paye, napsa=m.napsa, nhima=m.nhima, amount=m.amount) for m in manual if m.category == Line.EARNING
    ]
    paye_base = sum((l['amount'] for l in earnings if l['paye']), ZERO)
    napsa_base = sum((l['amount'] for l in earnings if l['napsa']), ZERO)
    nhima_base = sum((l['amount'] for l in earnings if l['nhima']), ZERO)
    already = {'paye': ZERO, 'napsa': ZERO, 'nhima': ZERO, 'napsa_employer': ZERO, 'nhima_employer': ZERO}
    if final_month_slip and (paye_base or napsa_base or nhima_base):
        slip_gross = Decimal(final_month_slip.gross_salary) - Decimal(final_month_slip.unpaid_leave_deduction or 0)
        paye_base += slip_gross
        napsa_base += slip_gross
        nhima_base += slip_gross
        already = {'paye': Decimal(final_month_slip.paye_tax), 'napsa': Decimal(final_month_slip.napsa_employee),
                   'nhima': Decimal(final_month_slip.nhima_employee),
                   'napsa_employer': Decimal(final_month_slip.napsa_employer),
                   'nhima_employer': Decimal(final_month_slip.nhima_employer)}
        notes.append(f"Statutory deductions are worked out on the whole of {last_day:%B %Y} (payslip + settlement), less what the payslip already deducted.")
    if paye_base or napsa_base or nhima_base:
        employer_borne = pay['employer_borne']
        stat = statutory(workspace, paye_base, napsa_base, nhima_base, gross_up=employer_borne)
        if stat['paye_gross_up']:
            notes.append(f"Free-of-tax pay: PAYE paid by the employer ({_k(stat['paye_gross_up'])}) is itself taxable "
                         "and has been grossed up.")
        for kind, base in (('paye', paye_base), ('napsa', napsa_base), ('nhima', nhima_base)):
            amount = max(stat[kind] - already[kind], ZERO)
            if not amount:
                continue
            row = dict(kind=kind, description=DEDUCTION_KINDS[kind], basis=f"on {_k(base)}", amount=amount, data={})
            if employer_borne:
                row.update(category=Line.EMPLOYER, description=f"{DEDUCTION_KINDS[kind]} — paid by employer")
            else:
                row.update(category=Line.DEDUCTION)
            auto.append(row)
        for kind, label in (('napsa_employer', 'NAPSA (employer)'), ('nhima_employer', 'NHIMA (employer)')):
            amount = max(stat[kind] - already[kind], ZERO)
            if amount:
                auto.append(dict(kind=kind, category=Line.EMPLOYER, description=label, basis='', amount=amount, data={}))

    # Write lines: earnings, deductions, employer; manual lines after the automatic ones in their group
    order = {Line.EARNING: 0, Line.DEDUCTION: 1, Line.EMPLOYER: 2}
    rows = [(order[r['category']], 0, r) for r in auto] + [(order[m.category], 1, m) for m in manual]
    rows.sort(key=lambda t: (t[0], t[1]))
    for m in manual:                          # free up line numbers before renumbering
        m.line_no = 1000 + m.line_no
        m.save(update_fields=['line_no'])
    for number, (_, is_manual, row) in enumerate(rows, start=1):
        if is_manual:
            row.line_no = number
            row.save(update_fields=['line_no'])
        else:
            SettlementLine.objects.create(settlement=settlement, line_no=number, is_manual=False,
                                          paye=row.get('paye', False), napsa=row.get('napsa', False),
                                          nhima=row.get('nhima', False), basis=row.get('basis', ''),
                                          **{k: row[k] for k in ('kind', 'category', 'description', 'amount', 'data')})

    totals = settlement.lines.values('category').annotate(t=Sum('amount'))
    by_category = {t['category']: t['t'] or ZERO for t in totals}
    settlement.total_earnings = by_category.get(Line.EARNING, ZERO)
    settlement.total_deductions = by_category.get(Line.DEDUCTION, ZERO)
    settlement.net_payable = settlement.total_earnings - settlement.total_deductions
    if settlement.net_payable < 0:
        notes.append(f"The employee owes {_k(-settlement.net_payable)}.")
    settlement.calculation_notes = notes
    settlement.calculated_at = timezone.now()
    settlement.save()
    return settlement


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def add_manual_line(settlement: FinalSettlement, kind: str, amount: Decimal, reason: str,
                    description: str = '', tax: tuple[bool, bool, bool] | None = None) -> SettlementLine:
    if settlement.status != FinalSettlement.Status.DRAFT:
        raise SettlementError('Only draft settlements can be changed')
    if not reason or not reason.strip():
        raise SettlementError('A reason is required for a manual line')
    if amount <= 0:
        raise SettlementError('Amount must be more than zero')
    if kind in MANUAL_EARNING_KINDS:
        category, label = Line.EARNING, EARNING_KINDS[kind]
        paye, napsa, nhima = tax if tax is not None else tax_flags(kind, get_settlement_policy(settlement.employee.workspace))
    elif kind in MANUAL_DEDUCTION_KINDS:
        category, label = Line.DEDUCTION, DEDUCTION_KINDS[kind]
        paye = napsa = nhima = False
    else:
        raise SettlementError(f'Unknown line type: {kind}')
    last = settlement.lines.order_by('-line_no').values_list('line_no', flat=True).first() or 0
    line = SettlementLine.objects.create(
        settlement=settlement, line_no=last + 1, kind=kind, category=category,
        description=(description or label)[:255], amount=_money(amount), is_manual=True,
        reason=reason.strip()[:255], paye=paye, napsa=napsa, nhima=nhima,
    )
    calculate_settlement(settlement)
    return line


def remove_manual_line(settlement: FinalSettlement, line: SettlementLine):
    if settlement.status != FinalSettlement.Status.DRAFT:
        raise SettlementError('Only draft settlements can be changed')
    if not line.is_manual or line.settlement_id != settlement.pk:
        raise SettlementError('Only manual lines can be removed; recalculate to refresh automatic lines')
    line.delete()
    calculate_settlement(settlement)


def set_line_tax(settlement: FinalSettlement, line: SettlementLine, paye: bool, napsa: bool, nhima: bool):
    """Change which statutory deductions an earning line counts towards (draft only).
    Automatic lines get the policy default back on recalculation, so this is for manual lines."""
    if settlement.status != FinalSettlement.Status.DRAFT or line.category != Line.EARNING or not line.is_manual:
        raise SettlementError('Tax treatment can be changed on manual earning lines of a draft')
    line.paye, line.napsa, line.nhima = paye, napsa, nhima
    line.save(update_fields=['paye', 'napsa', 'nhima'])
    calculate_settlement(settlement)


@transaction.atomic
def approve_settlement(settlement: FinalSettlement, actor) -> FinalSettlement:
    from apps.leave.models import LeaveLedgerEntry

    settlement = calculate_settlement(settlement)       # approve exactly what the figures are now
    if settlement.prepared_by_id and actor and settlement.prepared_by_id == actor.pk and not actor.is_superuser:
        raise SettlementError('The person who prepared the settlement cannot approve it')

    employee = settlement.employee
    for line in settlement.lines.filter(kind__in=('leave_pay', 'leave_advance')):
        days = Decimal(line.data.get('days', '0'))
        if days:
            LeaveLedgerEntry.objects.create(
                workspace=employee.workspace, employee=employee, leave_type='ANNUAL',
                kind=LeaveLedgerEntry.Kind.PAID_OUT, date=settlement.last_working_day, days=-days,
                source_type='final_settlement', source_id=str(settlement.pk),
                note='Paid out in final settlement' if days > 0 else 'Leave taken in advance recovered',
                created_by=actor,
            )

    if settlement.kind == FinalSettlement.Kind.EXIT:
        if settlement.termination_id:
            settlement.termination.payroll_final = True
            settlement.termination.save(update_fields=['payroll_final', 'updated_at'])
        for contract in employee.contracts.filter(status__in=['ACTIVE', 'PENDING_RENEWAL']):
            ended_early = contract.end_date is None or settlement.last_working_day < contract.end_date
            contract.status = 'TERMINATED' if ended_early else 'EXPIRED'
            contract.save(update_fields=['status', 'updated_at'])

    settlement.status = FinalSettlement.Status.APPROVED
    settlement.approved_by = actor
    settlement.approved_at = timezone.now()
    settlement.save(update_fields=['status', 'approved_by', 'approved_at', 'updated_at'])
    return settlement


@transaction.atomic
def mark_settlement_paid(settlement: FinalSettlement, actor, reference: str = '', paid_on: date | None = None):
    settlement = FinalSettlement.objects.select_for_update().get(pk=settlement.pk)
    if settlement.status != FinalSettlement.Status.APPROVED:
        raise SettlementError('Only approved settlements can be marked as paid')
    paid_on = paid_on or timezone.localdate()
    for line in settlement.lines.filter(kind__in=GRATUITY_KINDS):
        contract = Contract.objects.get(pk=line.data['contract'])
        record_gratuity_payment(
            contract, line.amount, paid_on=paid_on,
            covers_to=min(settlement.last_working_day, contract.end_date or settlement.last_working_day),
            actor=actor, source_type='final_settlement', source_id=str(settlement.pk),
            note=f"{line.description} ({reference})" if reference else line.description,
        )
    settlement.status = FinalSettlement.Status.PAID
    settlement.paid_by = actor
    settlement.paid_at = timezone.now()
    settlement.payment_reference = reference[:100]
    settlement.save(update_fields=['status', 'paid_by', 'paid_at', 'payment_reference', 'updated_at'])
    return settlement


def cancel_settlement(settlement: FinalSettlement) -> FinalSettlement:
    if settlement.status != FinalSettlement.Status.DRAFT:
        raise SettlementError('Only draft settlements can be cancelled')
    settlement.status = FinalSettlement.Status.CANCELLED
    settlement.save(update_fields=['status', 'updated_at'])
    return settlement
