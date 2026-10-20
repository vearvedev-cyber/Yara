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
