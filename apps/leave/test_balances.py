from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.holidays import count_working_days, easter_sunday, zambian_public_holidays
from apps.core.models import PublicHoliday, Workspace, WorkspaceMembership
from apps.hcm.models import Employee, EmploymentType, Termination, TerminationReason
from apps.leave.balances import (
    InsufficientLeaveBalance, adjust_balance, check_can_approve, ensure_accruals, get_balance,
    sync_leave_request,
)
from apps.leave.models import LeaveLedgerEntry, LeavePolicy, LeaveRequest

D = Decimal
Kind = LeaveLedgerEntry.Kind


def make_employee(workspace, code, hire_date, **extra):
    employment_type, _ = EmploymentType.objects.get_or_create(name='DIRECT')
    return Employee.objects.create(
        workspace=workspace, employee_id=code, first_name='Test', last_name=code, nrc=f'NRC-{code}',
        date_of_birth=date(1990, 1, 1), gender='M', phone='0970000000', house_address='Kitwe',
        employment_type=employment_type, job_title='Operator', hire_date=hire_date, **extra,
    )


def approved_leave(employee, start, end):
    leave = LeaveRequest.objects.create(
        employee=employee, leave_type='ANNUAL', start_date=start, end_date=end,
        status=LeaveRequest.Status.APPROVED,
    )
    return leave


class HolidayCalendarTests(TestCase):
    def test_easter_dates(self):
        self.assertEqual(easter_sunday(2026), date(2026, 4, 5))
        self.assertEqual(easter_sunday(2027), date(2027, 3, 28))

    def test_floating_and_observed_holidays(self):
        days = dict(zambian_public_holidays(2026))
        self.assertEqual(days[date(2026, 7, 6)], "Heroes' Day")         # first Monday of July
        self.assertEqual(days[date(2026, 7, 7)], 'Unity Day')
        self.assertEqual(days[date(2026, 8, 3)], "Farmers' Day")
        self.assertIn(date(2026, 10, 19), days)                         # 18 Oct 2026 is a Sunday → observed Monday
        # 1 Jan 2023 was a Sunday → observed Monday 2 Jan
        self.assertIn(date(2023, 1, 2), dict(zambian_public_holidays(2023)))

    def test_count_working_days_skips_weekends_and_holidays(self):
        # Thu 30 Apr 2026 → Tue 5 May 2026; Fri 1 May is Labour Day
        self.assertEqual(count_working_days(date(2026, 4, 30), date(2026, 5, 5), {0, 1, 2, 3, 4},
                                            {date(2026, 5, 1)}), 3)


class LeaveBalanceServiceTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')

    def test_new_hire_accrues_pro_rata_then_two_days_a_month(self):
        emp = make_employee(self.ws, 'E1', date(2026, 9, 16))
        # Opening created on first use, covering nothing yet (hired after cutoff)
        ensure_accruals(emp, today=date(2026, 9, 20))
        self.assertEqual(get_balance(emp, today=date(2026, 9, 20))['balance'], D('0'))
        # September: 15 of 30 days employed → 1.00; October full → 2.00
        summary = get_balance(emp, today=date(2026, 11, 3))
        self.assertEqual(summary['accrued'], D('3.00'))
        self.assertEqual(summary['balance'], D('3.00'))
        self.assertEqual(summary['accruing_this_month'], D('0.20'))   # 3 of 30 days of November

    def test_catch_up_is_idempotent(self):
        emp = make_employee(self.ws, 'E2', date(2026, 1, 1))
        ensure_accruals(emp, today=date(2026, 10, 15))
        ensure_accruals(emp, today=date(2026, 10, 15))
        self.assertEqual(LeaveLedgerEntry.objects.filter(employee=emp, kind=Kind.OPENING).count(), 1)
        self.assertEqual(get_balance(emp, today=date(2026, 10, 15))['balance'], D('18.00'))

    def test_opening_applies_carry_forward_cap_and_counts_recorded_leave(self):
        emp = make_employee(self.ws, 'E3', date(2023, 1, 1))
        # 5 working days taken in 2025 (Mon 3 – Fri 7 Mar 2025)
        approved_leave(emp, date(2025, 3, 3), date(2025, 3, 7))
        summary = get_balance(emp, today=date(2026, 10, 15))
        # 2023: 24 → cap 12. 2024: 12 + 24 = 36 → cap 12. 2025: 12 + 24 − 5 = 31 → cap 12.
        # 2026 Jan–Sep: 12 + 18 = 30.
        self.assertEqual(summary['balance'], D('30.00'))
        self.assertEqual(summary['taken'], D('5.00'))
        opening = LeaveLedgerEntry.objects.get(employee=emp, kind=Kind.OPENING)
        self.assertIn('carry-forward cap', opening.note)

    def test_year_end_expiry_after_go_live(self):
        emp = make_employee(self.ws, 'E4', date(2026, 1, 1))
        ensure_accruals(emp, today=date(2026, 6, 10))                 # go-live mid-year
        summary = get_balance(emp, today=date(2027, 1, 10))
        # 24 earned in 2026, 12 expire on 31 Dec
        self.assertEqual(summary['expired'], D('12.00'))
        self.assertEqual(summary['balance'], D('12.00'))

    def test_accrual_stops_at_termination(self):
        emp = make_employee(self.ws, 'E5', date(2026, 1, 1))
        reason, _ = TerminationReason.objects.get_or_create(name='RESIGNATION')
        Termination.objects.create(employee=emp, termination_date=date(2026, 3, 15), termination_reason=reason)
        emp.refresh_from_db()
        summary = get_balance(emp, today=date(2026, 8, 1))
        # Jan 2 + Feb 2 + 15/31 of March (0.97)
        self.assertEqual(summary['accrued'] + summary['opening'], D('4.97'))
        self.assertEqual(summary['accruing_this_month'], D('0'))

    def test_request_lifecycle_posts_and_reverses(self):
        emp = make_employee(self.ws, 'E6', date(2025, 1, 1))
        ensure_accruals(emp, today=date(2026, 10, 15))
        before = get_balance(emp, today=date(2026, 10, 15))['balance']
        leave = LeaveRequest.objects.create(employee=emp, leave_type='ANNUAL',
                                            start_date=date(2026, 11, 2), end_date=date(2026, 11, 6))
        self.assertEqual(leave.days, 5)
        leave.status = LeaveRequest.Status.APPROVED
        leave.save()
        sync_leave_request(leave)
        sync_leave_request(leave)                                       # idempotent
        self.assertEqual(get_balance(emp, today=date(2026, 10, 15))['balance'], before - 5)
        leave.status = LeaveRequest.Status.CANCELLED
        leave.save()
        sync_leave_request(leave)
        self.assertEqual(get_balance(emp, today=date(2026, 10, 15))['balance'], before)

    def test_working_days_exclude_public_holidays(self):
        PublicHoliday.objects.create(date=date(2026, 11, 13), name='Test holiday')
        emp = make_employee(self.ws, 'E7', date(2025, 1, 1))
        leave = LeaveRequest.objects.create(employee=emp, leave_type='ANNUAL',
                                            start_date=date(2026, 11, 9), end_date=date(2026, 11, 15))
        self.assertEqual(leave.days, 4)                                 # Mon–Fri minus Friday holiday
        sick = LeaveRequest.objects.create(employee=emp, leave_type='SICK',
                                           start_date=date(2026, 11, 9), end_date=date(2026, 11, 15))
        self.assertEqual(sick.days, 7)                                  # sick leave stays calendar days

    def test_cannot_approve_beyond_balance_unless_policy_allows(self):
        emp = make_employee(self.ws, 'E8', date(2026, 9, 1))
        leave = LeaveRequest.objects.create(employee=emp, leave_type='ANNUAL',
                                            start_date=date(2026, 10, 19), end_date=date(2026, 10, 30))
        with self.assertRaises(InsufficientLeaveBalance):
            check_can_approve(leave, today=date(2026, 10, 15))
        LeavePolicy.objects.create(workspace=self.ws, leave_type='ANNUAL', allow_negative_balance=True)
        check_can_approve(leave, today=date(2026, 10, 15))

    def test_ledger_entries_are_immutable(self):
        emp = make_employee(self.ws, 'E9', date(2026, 1, 1))
        entry = adjust_balance(emp, 'ANNUAL', D('2.5'), 'Opening balance from HR file')
        entry.days = D('10')
        with self.assertRaises(ValueError):
            entry.save()
        with self.assertRaises(ValueError):
            entry.delete()
        with self.assertRaises(ValueError):
            adjust_balance(emp, 'ANNUAL', D('1'), '   ')


class LeaveBalanceApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='hr', password='x', is_staff=True)
        self.ws = Workspace.objects.create(name='Mine Co', code='MINE')
        self.other_ws = Workspace.objects.create(name='Other Co', code='OTHR')
        WorkspaceMembership.objects.create(user=self.user, workspace=self.ws, role='ADMIN', is_default=True)
        self.emp = make_employee(self.ws, 'A1', date(2025, 1, 1))
        self.outsider = make_employee(self.other_ws, 'B1', date(2025, 1, 1))
        self.client = APIClient()
        self.client.force_login(self.user)          # middleware resolves the workspace
        self.client.force_authenticate(self.user)   # DRF authentication
        self.headers = {'HTTP_X_WORKSPACE_ID': str(self.ws.pk)}

    def test_list_is_workspace_scoped(self):
        res = self.client.get('/api/v1/leave/balances/', **self.headers)
        self.assertEqual(res.status_code, 200, res.content)
        codes = [r['employee_code'] for r in res.json()['results']]
        self.assertEqual(codes, ['A1'])
        self.assertEqual(res.json()['policy']['days_per_month'], '2.00')

    def test_detail_and_adjust(self):
        res = self.client.post(f'/api/v1/leave/balances/{self.emp.pk}/adjust/',
                               {'leave_type': 'ANNUAL', 'days': '3', 'note': 'Days owed from 2024'},
                               format='json', **self.headers)
        self.assertEqual(res.status_code, 201, res.content)
        res = self.client.get(f'/api/v1/leave/balances/{self.emp.pk}/', **self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['adjustments'], '3.00')
        self.assertTrue(any(e['kind'] == 'ADJUSTMENT' for e in res.json()['entries']))

    def test_other_workspace_employee_not_found(self):
        res = self.client.get(f'/api/v1/leave/balances/{self.outsider.pk}/', **self.headers)
        self.assertEqual(res.status_code, 404)

    def test_approve_endpoint_blocks_overdraw_and_status_is_read_only(self):
        new = make_employee(self.ws, 'A2', date(2026, 10, 1))
        leave = LeaveRequest.objects.create(employee=new, leave_type='ANNUAL',
                                            start_date=date(2026, 11, 2), end_date=date(2026, 11, 13))
        res = self.client.patch(f'/api/v1/leave/requests/{leave.pk}/', {'status': 'APPROVED'},
                                format='json', **self.headers)
        leave.refresh_from_db()
        self.assertEqual(leave.status, 'PENDING')
        res = self.client.post(f'/api/v1/leave/requests/{leave.pk}/approve/', **self.headers)
        self.assertEqual(res.status_code, 400)
        self.assertIn('Insufficient', res.json()['error'])

    def test_policy_effective_defaults_then_saved(self):
        res = self.client.get('/api/v1/leave/policies/effective/', **self.headers)
        self.assertTrue(res.json()['is_default'])
        res = self.client.post('/api/v1/leave/policies/', {'leave_type': 'ANNUAL', 'days_per_month': '2.50',
                                                           'working_weekdays': '0,1,2,3,4,5'},
                               format='json', **self.headers)
        self.assertEqual(res.status_code, 201, res.content)
        res = self.client.get('/api/v1/leave/policies/effective/', **self.headers)
        self.assertFalse(res.json()['is_default'])
        self.assertEqual(res.json()['days_per_month'], '2.50')

    def test_holiday_seed_and_list(self):
        res = self.client.post('/api/v1/core/public-holidays/seed/', {'year': 2027}, format='json', **self.headers)
        self.assertEqual(res.status_code, 201, res.content)
        res = self.client.get('/api/v1/core/public-holidays/?year=2027', **self.headers)
        names = [h['name'] for h in res.json()['results']] if isinstance(res.json(), dict) else [h['name'] for h in res.json()]
        self.assertIn('Independence Day', names)
