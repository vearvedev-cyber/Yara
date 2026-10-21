"""F1 (workspace guard), F5 (absenteeism before tax), F6 (free-of-tax PAYE gross-up) and
prior redundancy payments counting against the lifetime tax-free limit."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Workspace, WorkspaceMembership
from apps.payroll.models import (
    FinalSettlement, PAYEReturn, PayrollEntry, PayrollPeriod, Payslip, PriorRedundancyPayment,
)
from apps.payroll.settlement import calculate_settlement
from apps.payroll.test_gratuity import make_employee, terminate

D = Decimal


def calculated_payslip(employee, gross='20000', employer_borne=False, unpaid_days='0', absent_days='0'):
    period, _ = PayrollPeriod.objects.get_or_create(year=2026, month=3)
    slip = Payslip(employee=employee, period=period, basic_salary=D(gross), gross_salary=D('0'),
                   total_deductions=D('0'), net_salary=D('0'), employer_borne_deductions=employer_borne,
                   unpaid_leave_days=D(unpaid_days), absenteeism_days=D(absent_days))
    slip.save()            # as the payroll views do: create, then calculate
    slip.calculate()
    slip.save()
    slip.refresh_from_db()
    return slip


class AbsenteeismAndGrossUpTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')

    def test_absenteeism_is_taxed_like_unpaid_leave(self):
        absent = calculated_payslip(make_employee(self.ws, 'T1'), gross='10400', absent_days='2')
        unpaid = calculated_payslip(make_employee(self.ws, 'T2'), gross='10400', unpaid_days='2')
        self.assertEqual(absent.absenteeism_deduction, D('800.00'))      # 10,400 / 26 x 2
        self.assertEqual(absent.paye_tax, unpaid.paye_tax)                 # tax on 9,600, not 10,400
        self.assertEqual(absent.napsa_employee, unpaid.napsa_employee)
        self.assertEqual(absent.net_salary, unpaid.net_salary)
        self.assertEqual(absent.total_custom_deductions, D('0'))           # no longer an after-tax deduction
        self.assertEqual(absent.taxable_pay, D('9600.00'))

    def test_employer_borne_paye_is_grossed_up(self):
        normal = calculated_payslip(make_employee(self.ws, 'T3'), gross='20000')
        borne = calculated_payslip(make_employee(self.ws, 'T4'), gross='20000', employer_borne=True)
        # Chargeable 20,000 - NAPSA 1,000 = 19,000 -> PAYE 4,656.00 without gross-up
        self.assertEqual(normal.paye_tax, D('4656.00'))
        self.assertEqual(normal.paye_gross_up, D('0'))
        # Gross-up: G = tax on (19,000 + G) -> G = 4,656 / 0.63 = 7,390.48
        self.assertEqual(borne.paye_tax, D('7390.48'))
        self.assertEqual(borne.paye_gross_up, D('7390.48'))
        self.assertEqual(borne.net_salary, D('20000.00'))                  # take-home unchanged
        self.assertEqual(borne.taxable_pay, D('27390.48'))

    def test_paye_return_uses_taxable_pay(self):
        calculated_payslip(make_employee(self.ws, 'T5'), gross='20000', employer_borne=True)
        calculated_payslip(make_employee(self.ws, 'T6'), gross='10400', absent_days='2')
        period = PayrollPeriod.objects.get(year=2026, month=3)
        paye_return = PAYEReturn.objects.create(workspace=self.ws, period=period)
        paye_return.calculate()
        self.assertEqual(paye_return.total_gross_pay, D('27390.48') + D('9600.00'))
        rows = {r['full_name']: r for r in paye_return.generate_detailed_rows()}
        self.assertEqual(rows['Test T5']['gross_pay'], D('27390.48'))


class PriorRedundancyTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(username='hr', password='x', is_staff=True)
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')
        WorkspaceMembership.objects.create(user=user, workspace=self.ws, role='ADMIN', is_default=True)
        self.client = APIClient()
        self.client.force_login(user)
        self.client.force_authenticate(user)
        self.h = {'HTTP_X_WORKSPACE_ID': str(self.ws.pk)}

    def test_prior_payments_reduce_the_lifetime_tax_free_allowance(self):
        emp = make_employee(self.ws, 'R1', hire_date=date(2023, 1, 1))
        PayrollEntry.objects.create(employee=emp, basic=D('10000'), gross=D('10000'))
        res = self.client.post('/api/v1/payroll/prior-redundancy/', {
            'employee': emp.pk, 'amount': '1950000', 'paid_on': '2019-06-30', 'employer_name': 'Old Mine Ltd',
        }, format='json', **self.h)
        self.assertEqual(res.status_code, 201, res.content)
        terminate(emp, date(2025, 12, 31), 'REDUNDANCY')
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, termination=emp.termination,
                                           last_working_day=date(2025, 12, 31))
        lines = {l.kind: l for l in calculate_settlement(s).lines.all()}
        # 60,000 package; only 50,000 of the K2,000,000 lifetime allowance is left
        self.assertEqual(lines['redundancy_severance'].amount, D('50000.00'))
        self.assertEqual(lines['redundancy_severance_taxable'].amount, D('10000.00'))
        self.assertIn('already used', lines['redundancy_severance_taxable'].basis)
        res = self.client.get(f'/api/v1/payroll/prior-redundancy/?employee={emp.pk}', **self.h)
        results = res.json()['results'] if isinstance(res.json(), dict) else res.json()
        self.assertEqual(len(results), 1)
        self.assertEqual(PriorRedundancyPayment.objects.count(), 1)


class WorkspaceGuardTests(TestCase):
    def test_bulk_set_employer_borne_refuses_without_workspace(self):
        user = get_user_model().objects.create_user(username='nows', password='x', is_staff=True)
        client = APIClient()
        client.force_login(user)
        client.force_authenticate(user)
        res = client.post('/api/v1/payroll/payslips/bulk_set_employer_borne/',
                          {'year': 2026, 'month': 3, 'employer_borne_deductions': True}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('workspace', res.json()['error'].lower())


class SettlementStatutoryReportingTests(TestCase):
    """Settlement PAYE/NAPSA/NHIMA must reach the month's PAYE return, remittance report
    and NAPSA/NHIMA returns; contract-end payouts are taxed with that month's payslip."""

    def setUp(self):
        User = get_user_model()
        self.preparer = User.objects.create_user(username='prep', password='x', is_staff=True)
        self.approver = User.objects.create_user(username='appr', password='x', is_staff=True)
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')
        WorkspaceMembership.objects.create(user=self.approver, workspace=self.ws, role='ADMIN', is_default=True)

    def approved_exit(self):
        from apps.payroll.settlement import approve_settlement
        from apps.payroll.test_gratuity import make_contract
        emp = make_employee(self.ws, 'X1', hire_date=date(2025, 1, 1))
        PayrollEntry.objects.create(employee=emp, basic=D('10400'), gross=D('20800'))
        make_contract(emp, date(2025, 1, 1), date(2026, 12, 31), basic='10400.00')
        terminate(emp, date(2025, 6, 15), 'RESIGNATION')
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, termination=emp.termination,
                                           last_working_day=date(2025, 6, 15), prepared_by=self.preparer)
        calculate_settlement(s)
        return approve_settlement(s, self.approver)

    def test_paye_return_includes_settlement(self):
        self.approved_exit()
        period, _ = PayrollPeriod.objects.get_or_create(year=2025, month=6)
        paye_return = PAYEReturn.objects.create(workspace=self.ws, period=period)
        paye_return.calculate()
        # Salary 10,400 + leave pay 4,400 are taxable; the statutory gratuity isn't
        self.assertEqual(paye_return.total_gross_pay, D('14800.00'))
        self.assertEqual(paye_return.total_tax_payable, D('2828.20'))
        self.assertEqual(paye_return.total_employees, 1)
        rows = paye_return.generate_detailed_rows()
        self.assertEqual((rows[0]['gross_pay'], rows[0]['tax_payable']), (D('14800.00'), D('2828.20')))

    def test_remittance_and_napsa_return_include_settlement(self):
        from io import BytesIO
        from openpyxl import load_workbook
        self.approved_exit()
        client = APIClient()
        client.force_login(self.approver)
        client.force_authenticate(self.approver)
        h = {'HTTP_X_WORKSPACE_ID': str(self.ws.pk)}
        res = client.get('/api/v1/payroll/payslips/remittance_report/?year=2025&month=6', **h)
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertEqual(data['zra']['paye_total'], 2828.2)
        self.assertEqual(data['napsa']['combined_total'], 1480.0)
        self.assertEqual(data['nhima']['combined_total'], 296.0)
        self.assertEqual(data['summary']['final_settlements'], 1)
        res = client.get('/api/v1/payroll/payslips/napsa_return/?year=2025&month=6', **h)
        sheet = load_workbook(BytesIO(res.content)).active
        row = [c.value for c in sheet[2]]
        self.assertEqual(row[-2:], [740.0, 740.0])

    def test_draft_settlements_are_not_reported(self):
        from apps.payroll.test_gratuity import make_contract
        emp = make_employee(self.ws, 'X2', hire_date=date(2025, 1, 1))
        PayrollEntry.objects.create(employee=emp, basic=D('10400'), gross=D('20800'))
        make_contract(emp, date(2025, 1, 1), date(2026, 12, 31), basic='10400.00')
        terminate(emp, date(2025, 6, 15), 'RESIGNATION')
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, termination=emp.termination,
                                           last_working_day=date(2025, 6, 15))
        calculate_settlement(s)
        period, _ = PayrollPeriod.objects.get_or_create(year=2025, month=6)
        paye_return = PAYEReturn.objects.create(workspace=self.ws, period=period)
        paye_return.calculate()
        self.assertEqual(paye_return.total_tax_payable, D('0'))

    def test_contract_end_top_up_taxed_with_the_months_payslip(self):
        from apps.payroll.models import GratuityPolicy
        from apps.payroll.test_gratuity import make_contract
        GratuityPolicy.objects.create(workspace=self.ws, rate_percent=D('30'))
        emp = make_employee(self.ws, 'X3', hire_date=date(2024, 1, 1))
        old = make_contract(emp, date(2024, 1, 1), date(2024, 12, 31), basic='10000.00', number='OLD')
        period, _ = PayrollPeriod.objects.get_or_create(year=2024, month=12)
        slip = Payslip(employee=emp, period=period, basic_salary=D('10000'), gross_salary=D('0'),
                       total_deductions=D('0'), net_salary=D('0'))
        slip.save()
        slip.calculate()
        slip.save()
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, kind=FinalSettlement.Kind.CONTRACT_END,
                                           contract=old, last_working_day=old.end_date)
        lines = {l.kind: l for l in calculate_settlement(s).lines.all()}
        # 5% top-up on 120,000 = 6,000, taxed in December's top band on top of the payslip:
        # 6,000 x 37% = 2,220 (taxed alone it would have fallen in the 0-30% bands)
        self.assertEqual(lines['short_term_severance_excess'].amount, D('6000.00'))
        self.assertEqual(lines['paye'].amount, D('2220.00'))
        self.assertNotIn('napsa', lines)                  # top-up attracts no NAPSA
