from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Workspace, WorkspaceMembership
from apps.hcm.models import Contract, ContractType, Employee, EmploymentType, Termination, TerminationReason
from apps.leave.models import LeaveRequest
from apps.payroll.gratuity import (
    ACCRUING, DUE, GRATUITY, NOT_ELIGIBLE, PAID, SHORT_TERM_SEVERANCE, calculate_contract_gratuity,
    record_gratuity_payment,
)
from apps.payroll.models import GratuityPolicy, PayrollPeriod, Payslip

D = Decimal


def make_employee(workspace, code, hire_date=date(2025, 1, 1)):
    employment_type, _ = EmploymentType.objects.get_or_create(name='DIRECT')
    return Employee.objects.create(
        workspace=workspace, employee_id=code, first_name='Test', last_name=code, nrc=f'NRC-{code}',
        date_of_birth=date(1990, 1, 1), gender='F', phone='0970000000', house_address='Kitwe',
        employment_type=employment_type, job_title='Fitter', hire_date=hire_date,
    )


def make_contract(employee, start, end, basic='10000.00', type_name='FIXED_TERM', number=None):
    contract_type, _ = ContractType.objects.get_or_create(name=type_name)
    return Contract.objects.create(
        employee=employee, contract_type=contract_type, contract_number=number or f'C-{employee.employee_id}-{start}',
        start_date=start, end_date=end, basic_salary=D(basic) if basic else None,
    )


def make_payslip(employee, year, month, basic, version=1, active=True, unpaid_days='0'):
    period, _ = PayrollPeriod.objects.get_or_create(year=year, month=month)
    return Payslip.objects.create(
        employee=employee, period=period, basic_salary=D(basic), gross_salary=D(basic),
        total_deductions=D('0'), net_salary=D(basic), version=version, is_active=active,
        unpaid_leave_days=D(unpaid_days),
    )


def terminate(employee, on, reason):
    reason_obj, _ = TerminationReason.objects.get_or_create(name=reason)
    Termination.objects.create(employee=employee, termination_date=on, termination_reason=reason_obj)
    employee.refresh_from_db()


class GratuityCalculationTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')

    def test_twenty_five_percent_of_basic_from_payslips(self):
        emp = make_employee(self.ws, 'G1')
        contract = make_contract(emp, date(2025, 1, 1), date(2026, 12, 31))
        for month in range(1, 13):
            make_payslip(emp, 2025, month, '10000.00')
        result = calculate_contract_gratuity(contract, as_of=date(2026, 1, 15))
        # Only 2025 months are complete; January 2026 has no payslip yet and isn't finished
        self.assertEqual((result.status, result.benefit), (ACCRUING, GRATUITY))
        self.assertEqual(result.basic_earned, D('120000.00'))
        self.assertEqual(result.gratuity_earned, D('30000.00'))
        self.assertEqual(result.estimated_months, 0)

    def test_regenerated_payslip_uses_active_version(self):
        emp = make_employee(self.ws, 'G2')
        contract = make_contract(emp, date(2025, 1, 1), date(2025, 12, 31))
        make_payslip(emp, 2025, 1, '8000.00', version=1, active=False)
        make_payslip(emp, 2025, 1, '9000.00', version=2, active=True)
        result = calculate_contract_gratuity(contract, as_of=date(2025, 2, 10))
        self.assertEqual(result.months[0].basic_salary, D('9000.00'))

    def test_partial_months_are_apportioned_and_missing_months_estimated(self):
        emp = make_employee(self.ws, 'G3')
        # 16 Jan 2025 → 15 Jan 2026
        contract = make_contract(emp, date(2025, 1, 16), date(2026, 1, 15), basic='9300.00')
        make_payslip(emp, 2025, 1, '9300.00')        # 16 of 31 days → 4800.00
        result = calculate_contract_gratuity(contract, as_of=date(2026, 3, 1))
        self.assertEqual(result.months[0].basic_earned, D('4800.00'))
        self.assertEqual(result.estimated_months, 12)  # Feb 2025 – Jan 2026 from contract basic
        jan_2026 = result.months[-1]
        self.assertEqual((jan_2026.days_covered, jan_2026.basic_earned), (15, D('4500.00')))
        self.assertEqual(result.status, DUE)
        self.assertEqual(result.benefit, SHORT_TERM_SEVERANCE)       # exactly 12 months is not "more than 12"
        # 4800 + 11 × 9300 + 4500 = 111,600 → 25% = 27,900
        self.assertEqual(result.gratuity_earned, D('27900.00'))

    def test_short_contracts_get_severance_open_ended_and_permanent_get_nothing(self):
        emp = make_employee(self.ws, 'G4')
        short = make_contract(emp, date(2025, 1, 1), date(2025, 6, 30), number='SHORT')
        short_type = make_contract(emp, date(2025, 7, 1), date(2025, 9, 30), type_name='SHORT_TERM', number='ST')
        long = make_contract(emp, date(2025, 1, 1), date(2026, 1, 31), number='LONG')     # 13 months
        open_ended = make_contract(emp, date(2025, 7, 1), None, number='OPEN')
        permanent = make_contract(emp, date(2025, 1, 1), date(2027, 1, 1), type_name='PERMANENT', number='PERM')
        self.assertEqual(calculate_contract_gratuity(short).benefit, SHORT_TERM_SEVERANCE)
        self.assertEqual(calculate_contract_gratuity(short_type).benefit, SHORT_TERM_SEVERANCE)
        self.assertEqual(calculate_contract_gratuity(long).benefit, GRATUITY)
        for contract in (open_ended, permanent):
            self.assertEqual(calculate_contract_gratuity(contract).status, NOT_ELIGIBLE)

    def test_early_exit_always_pays_pro_rata_even_on_dismissal(self):
        resigned = make_employee(self.ws, 'G5')
        c1 = make_contract(resigned, date(2025, 1, 1), date(2026, 12, 31))
        terminate(resigned, date(2025, 6, 30), 'RESIGNATION')
        r1 = calculate_contract_gratuity(c1, as_of=date(2025, 8, 1))
        self.assertEqual(r1.status, DUE)
        self.assertEqual(r1.gratuity_earned, D('15000.00'))   # 6 estimated months × 10,000 × 25%

        dismissed = make_employee(self.ws, 'G6')
        c2 = make_contract(dismissed, date(2025, 1, 1), date(2026, 12, 31))
        terminate(dismissed, date(2025, 6, 30), 'TERMINATED')
        r2 = calculate_contract_gratuity(c2, as_of=date(2025, 8, 1))
        # Employment Code Act s51(1), s73(2): accrued gratuity is paid on dismissal too
        self.assertEqual((r2.status, r2.outstanding, r2.ended_early), (DUE, D('15000.00'), True))

    def test_payments_reduce_outstanding(self):
        emp = make_employee(self.ws, 'G7')
        contract = make_contract(emp, date(2024, 1, 1), date(2024, 12, 31))
        result = calculate_contract_gratuity(contract, as_of=date(2025, 3, 1))
        self.assertEqual(result.outstanding, D('30000.00'))
        payment = record_gratuity_payment(contract, D('30000'), date(2025, 1, 31), date(2024, 12, 31))
        self.assertEqual(calculate_contract_gratuity(contract, as_of=date(2025, 3, 1)).status, PAID)
        with self.assertRaises(ValueError):
            payment.delete()

    def test_policy_rate_and_long_term_threshold(self):
        GratuityPolicy.objects.create(workspace=self.ws, rate_percent=D('30'), long_term_months=6)
        emp = make_employee(self.ws, 'G8')
        six = make_contract(emp, date(2025, 1, 1), date(2025, 6, 30), number='SIX')
        seven = make_contract(emp, date(2025, 1, 1), date(2025, 7, 31), number='SEVEN')
        result = calculate_contract_gratuity(six, as_of=date(2025, 8, 1))
        self.assertEqual(result.gratuity_earned, D('18000.00'))  # 60,000 × 30%
        self.assertEqual(result.benefit, SHORT_TERM_SEVERANCE)
        self.assertEqual(calculate_contract_gratuity(seven, as_of=date(2025, 8, 1)).benefit, GRATUITY)

    def test_unpaid_leave_reduces_basic_pay_earned(self):
        emp = make_employee(self.ws, 'G9')
        contract = make_contract(emp, date(2025, 1, 1), date(2026, 6, 30), basic='10400.00')
        make_payslip(emp, 2025, 1, '10400.00', unpaid_days='2')          # 10,400 / 26 x 2 = 800
        LeaveRequest.objects.create(employee=emp, leave_type='UNPAID', status='APPROVED',
                                    start_date=date(2025, 2, 10), end_date=date(2025, 2, 12))   # 3 days, no payslip
        result = calculate_contract_gratuity(contract, as_of=date(2025, 3, 1))
        jan, feb = result.months
        self.assertEqual((jan.unpaid_leave_reduction, jan.basic_earned), (D('800.00'), D('9600.00')))
        self.assertEqual((feb.source, feb.unpaid_leave_days, feb.basic_earned), ('estimate', D('3'), D('9200.00')))
        self.assertEqual(result.gratuity_earned, D('4700.00'))           # (9,600 + 9,200) x 25%


class GratuityApiTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(username='hr', password='x', is_staff=True)
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')
        other = Workspace.objects.create(name='Other', code='OTH')
        WorkspaceMembership.objects.create(user=user, workspace=self.ws, role='ADMIN', is_default=True)
        self.contract = make_contract(make_employee(self.ws, 'A1'), date(2024, 1, 1), date(2024, 12, 31))
        self.foreign = make_contract(make_employee(other, 'B1'), date(2024, 1, 1), date(2024, 12, 31))
        self.client = APIClient()
        self.client.force_login(user)
        self.client.force_authenticate(user)
        self.h = {'HTTP_X_WORKSPACE_ID': str(self.ws.pk)}

    def test_list_detail_and_scope(self):
        res = self.client.get('/api/v1/payroll/gratuity/', **self.h)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([r['contract_number'] for r in res.json()['results']], [self.contract.contract_number])
        self.assertEqual(res.json()['results'][0]['outstanding'], '30000.00')
        res = self.client.get(f'/api/v1/payroll/gratuity/{self.contract.pk}/', **self.h)
        self.assertEqual(len(res.json()['months']), 12)
        res = self.client.get(f'/api/v1/payroll/gratuity/{self.foreign.pk}/', **self.h)
        self.assertEqual(res.status_code, 404)

    def test_policy_cannot_go_below_statutory_minimum(self):
        res = self.client.put('/api/v1/payroll/gratuity/policy/', {'rate_percent': '20'}, format='json', **self.h)
        self.assertEqual(res.status_code, 400)
        res = self.client.put('/api/v1/payroll/gratuity/policy/', {'eligible_contract_types': 'FIXED_TERM,NOPE'},
                              format='json', **self.h)
        self.assertEqual(res.status_code, 400)
        res = self.client.put('/api/v1/payroll/gratuity/policy/',
                              {'rate_percent': '30', 'eligible_contract_types': 'FIXED_TERM,SHORT_TERM,SEASONAL'},
                              format='json', **self.h)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['rate_percent'], '30.00')
        self.assertFalse(res.json()['is_default'])
