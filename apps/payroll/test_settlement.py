from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Workspace, WorkspaceMembership
from apps.hcm.models import Contract, Termination
from apps.leave.models import LeaveLedgerEntry
from apps.payroll.gratuity import PAID, calculate_contract_gratuity
from apps.payroll.models import FinalSettlement, GratuityPayment, GratuityPolicy, PayrollEntry, SettlementPolicy
from apps.payroll.settlement import (
    SettlementError, add_manual_line, approve_settlement, calculate_settlement, mark_settlement_paid,
)
from apps.payroll.test_gratuity import make_contract, make_employee, make_payslip, terminate

D = Decimal


def lines_by_kind(settlement):
    return {l.kind: l for l in settlement.lines.all()}


class SettlementCalculationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.preparer = User.objects.create_user(username='prep', password='x', is_staff=True)
        self.approver = User.objects.create_user(username='appr', password='x', is_staff=True)
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')
        self.emp = make_employee(self.ws, 'S1', hire_date=date(2025, 1, 1))
        PayrollEntry.objects.create(employee=self.emp, basic=D('10400'), gross=D('20800'))
        self.contract = make_contract(self.emp, date(2025, 1, 1), date(2026, 12, 31), basic='10400.00')

    def exit_settlement(self, on=date(2025, 6, 15), reason='RESIGNATION'):
        terminate(self.emp, on, reason)
        settlement = FinalSettlement.objects.create(
            workspace=self.ws, employee=self.emp, kind=FinalSettlement.Kind.EXIT,
            termination=self.emp.termination, last_working_day=on, prepared_by=self.preparer,
        )
        return calculate_settlement(settlement)

    def test_mid_month_resignation(self):
        s = self.exit_settlement()
        lines = lines_by_kind(s)
        # 15/30 of K20,800 gross
        self.assertEqual(lines['final_salary'].amount, D('10400.00'))
        # Jan–May 2 days each + 15/30 of June's 2 days = 11 days × (10,400 ÷ 26 = 400)
        self.assertEqual(lines['leave_pay'].amount, D('4400.00'))
        # Jan–May estimated 5 × 10,400 = 52,000, plus June's 15/30 × 10,400 = 5,200 → 57,200 × 25%
        self.assertEqual(lines['gratuity'].amount, D('14300.00'))
        # Statutory gratuity is free of PAYE, NAPSA and NHIMA
        self.assertEqual((lines['gratuity'].paye, lines['gratuity'].napsa, lines['gratuity'].nhima), (False, False, False))
        # Salary + leave pay = 14,800. NAPSA 740, NHIMA 148.
        # PAYE on 14,800 − 740 = 14,060: 400 + 630 + 4,860 × 37% (1,798.20) = 2,828.20
        self.assertEqual(lines['napsa'].amount, D('740.00'))
        self.assertEqual(lines['nhima'].amount, D('148.00'))
        self.assertEqual(lines['paye'].amount, D('2828.20'))
        self.assertEqual(lines['napsa_employer'].category, 'EMPLOYER')
        self.assertEqual((s.total_earnings, s.total_deductions, s.net_payable),
                         (D('29100.00'), D('3716.20'), D('25383.80')))

    def test_dismissal_still_pays_gratuity_pro_rata(self):
        s = self.exit_settlement(reason='TERMINATED')
        self.assertEqual(lines_by_kind(s)['gratuity'].amount, D('14300.00'))

    def test_manual_lines_survive_recalculation_and_need_a_reason(self):
        s = self.exit_settlement()
        with self.assertRaises(SettlementError):
            add_manual_line(s, 'loan_recovery', D('2500'), '  ')
        add_manual_line(s, 'loan_recovery', D('2500'), 'Staff loan balance, Aug 2024')
        s = calculate_settlement(s)
        loan = lines_by_kind(s)['loan_recovery']
        self.assertTrue(loan.is_manual)
        self.assertEqual(s.net_payable, D('22883.80'))
        add_manual_line(s, 'notice_pay', D('1000'), 'One week in lieu of notice')
        s.refresh_from_db()
        self.assertGreater(lines_by_kind(s)['paye'].amount, D('2828.20'))   # notice pay is taxable

    def test_approval_locks_and_records_leave_and_gratuity_on_payment(self):
        s = self.exit_settlement()
        with self.assertRaises(SettlementError):
            approve_settlement(s, self.preparer)                # preparer can't approve
        s = approve_settlement(s, self.approver)
        self.assertEqual(s.status, FinalSettlement.Status.APPROVED)
        paid_out = LeaveLedgerEntry.objects.get(employee=self.emp, kind=LeaveLedgerEntry.Kind.PAID_OUT)
        self.assertEqual(paid_out.days, D('-11.00'))
        self.assertTrue(Termination.objects.get(employee=self.emp).payroll_final)
        self.assertEqual(Contract.objects.get(pk=self.contract.pk).status, 'TERMINATED')
        with self.assertRaises(SettlementError):
            calculate_settlement(s)
        mark_settlement_paid(s, self.approver, reference='EFT 123')
        self.assertEqual(GratuityPayment.objects.get(contract=self.contract).amount, D('14300.00'))
        self.assertEqual(calculate_contract_gratuity(self.contract, as_of=date(2025, 7, 1)).status, PAID)

    def test_existing_final_month_payslip_is_not_paid_twice(self):
        make_payslip(self.emp, 2025, 6, '10400.00')
        s = self.exit_settlement()
        lines = lines_by_kind(s)
        self.assertNotIn('final_salary', lines)
        self.assertTrue(any('already covers' in n for n in s.calculation_notes))

    def test_redundancy_severance(self):
        emp = make_employee(self.ws, 'S2', hire_date=date(2023, 1, 1))
        PayrollEntry.objects.create(employee=emp, basic=D('10000'), gross=D('15000'))
        terminate(emp, date(2025, 12, 31), 'REDUNDANCY')
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, termination=emp.termination,
                                           last_working_day=date(2025, 12, 31))
        s = calculate_settlement(s)
        # 2 months × 10,000 × 3.00 years, all within the K2,000,000 tax-free limit
        lines = lines_by_kind(s)
        self.assertEqual(lines['redundancy_severance'].amount, D('60000.00'))
        self.assertFalse(lines['redundancy_severance'].paye or lines['redundancy_severance'].napsa)
        self.assertNotIn('redundancy_severance_taxable', lines)

    def test_redundancy_above_lifetime_tax_free_limit_is_taxed(self):
        SettlementPolicy.objects.create(workspace=self.ws, redundancy_tax_free_limit=D('100000'))
        emp = make_employee(self.ws, 'S5', hire_date=date(2023, 1, 1))
        PayrollEntry.objects.create(employee=emp, basic=D('25000'), gross=D('25000'))
        terminate(emp, date(2025, 12, 31), 'REDUNDANCY')
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, termination=emp.termination,
                                           last_working_day=date(2025, 12, 31))
        lines = lines_by_kind(calculate_settlement(s))
        # 2 × 25,000 × 3.00 = 150,000: 100,000 tax-free, 50,000 taxed (PAYE only)
        self.assertEqual(lines['redundancy_severance'].amount, D('100000.00'))
        taxable = lines['redundancy_severance_taxable']
        self.assertEqual(taxable.amount, D('50000.00'))
        self.assertEqual((taxable.paye, taxable.napsa, taxable.nhima), (True, False, False))

    def test_gratuity_above_statutory_25_percent_is_taxed(self):
        GratuityPolicy.objects.create(workspace=self.ws, rate_percent=D('30'))
        lines = lines_by_kind(self.exit_settlement())
        # 57,200 basic earned: 25% (14,300) tax-free, 5% (2,860) taxed with PAYE only
        self.assertEqual(lines['gratuity'].amount, D('14300.00'))
        excess = lines['gratuity_excess']
        self.assertEqual(excess.amount, D('2860.00'))
        self.assertEqual((excess.paye, excess.napsa, excess.nhima), (True, False, False))

    def test_contract_end_payout_on_renewal(self):
        emp = make_employee(self.ws, 'S3', hire_date=date(2024, 1, 1))
        old = make_contract(emp, date(2024, 1, 1), date(2024, 12, 31), basic='10000.00', number='OLD')
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, kind=FinalSettlement.Kind.CONTRACT_END,
                                           contract=old, last_working_day=old.end_date)
        s = calculate_settlement(s)
        lines = lines_by_kind(s)
        self.assertEqual(lines['short_term_severance'].amount, D('30000.00'))   # 12 months → s54
        self.assertNotIn('leave_pay', lines)
        self.assertNotIn('final_salary', lines)

    def test_contract_paid_by_contract_end_payout_is_not_paid_again_at_exit(self):
        emp = make_employee(self.ws, 'S4', hire_date=date(2024, 1, 1))
        PayrollEntry.objects.create(employee=emp, basic=D('10000'), gross=D('10000'))
        old = make_contract(emp, date(2024, 1, 1), date(2024, 12, 31), basic='10000.00', number='OLD4')
        FinalSettlement.objects.create(workspace=self.ws, employee=emp, kind=FinalSettlement.Kind.CONTRACT_END,
                                       contract=old, last_working_day=old.end_date)
        make_contract(emp, date(2025, 1, 1), date(2026, 12, 31), basic='10000.00', number='NEW4')
        terminate(emp, date(2025, 3, 31), 'RESIGNATION')
        s = FinalSettlement.objects.create(workspace=self.ws, employee=emp, termination=emp.termination,
                                           last_working_day=date(2025, 3, 31))
        s = calculate_settlement(s)
        descriptions = [l.description for l in s.lines.filter(kind__in=('gratuity', 'short_term_severance'))]
        self.assertEqual(len(descriptions), 1)
        self.assertIn('NEW4', descriptions[0])


class SettlementApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.hr = User.objects.create_user(username='hr', password='x', is_staff=True)
        self.boss = User.objects.create_user(username='boss', password='x', is_staff=True)
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')
        for user in (self.hr, self.boss):
            WorkspaceMembership.objects.create(user=user, workspace=self.ws, role='ADMIN', is_default=True)
        self.emp = make_employee(self.ws, 'A1', hire_date=date(2025, 1, 1))
        PayrollEntry.objects.create(employee=self.emp, basic=D('10400'), gross=D('20800'))
        make_contract(self.emp, date(2025, 1, 1), date(2026, 12, 31), basic='10400.00')
        self.h = {'HTTP_X_WORKSPACE_ID': str(self.ws.pk)}

    def client_for(self, user):
        client = APIClient()
        client.force_login(user)
        client.force_authenticate(user)
        return client

    def test_full_flow(self):
        hr = self.client_for(self.hr)
        res = hr.post('/api/v1/payroll/settlements/', {'employee': self.emp.pk}, format='json', **self.h)
        self.assertEqual(res.status_code, 400)                    # termination not recorded yet
        terminate(self.emp, date(2025, 6, 15), 'RESIGNATION')
        res = hr.post('/api/v1/payroll/settlements/', {'employee': self.emp.pk}, format='json', **self.h)
        self.assertEqual(res.status_code, 201, res.content)
        sid = res.json()['id']
        self.assertEqual(res.json()['net_payable'], '25383.80')
        res = hr.post('/api/v1/payroll/settlements/', {'employee': self.emp.pk}, format='json', **self.h)
        self.assertEqual(res.status_code, 400)                    # only one open exit settlement

        res = hr.post(f'/api/v1/payroll/settlements/{sid}/lines/',
                      {'kind': 'advance_recovery', 'amount': '1000', 'reason': 'Advance May 2025'},
                      format='json', **self.h)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['net_payable'], '24383.80')

        res = hr.post(f'/api/v1/payroll/settlements/{sid}/approve/', **self.h)
        self.assertEqual(res.status_code, 400)                    # preparer
        boss = self.client_for(self.boss)
        res = boss.post(f'/api/v1/payroll/settlements/{sid}/approve/', **self.h)
        self.assertEqual(res.json()['status'], 'APPROVED')
        res = hr.patch(f'/api/v1/payroll/settlements/{sid}/', {'notes': 'late edit'}, format='json', **self.h)
        self.assertEqual(res.status_code, 400)
        res = boss.get(f'/api/v1/payroll/settlements/{sid}/pdf/', **self.h)
        self.assertEqual(res['Content-Type'], 'application/pdf')
        self.assertTrue(res.content.startswith(b'%PDF'))
        res = boss.post(f'/api/v1/payroll/settlements/{sid}/mark-paid/', {'reference': 'EFT 77'}, format='json', **self.h)
        self.assertEqual(res.json()['status'], 'PAID')

    def test_bulk_payroll_skips_leavers(self):
        stayer = make_employee(self.ws, 'A2')
        PayrollEntry.objects.create(employee=stayer, basic=D('5000'), gross=D('8000'))
        terminate(self.emp, date(2025, 6, 15), 'RESIGNATION')
        res = self.client_for(self.hr).post('/api/v1/payroll/payslips/bulk_create/', {'year': 2025, 'month': 6},
                                            format='json', **self.h)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['summary']['skipped_terminated'], 1)
        self.assertEqual(res.json()['created'], 1)
