"""Leave management: leave requests and sick notes with basic calculations."""
from decimal import Decimal

from django.conf import settings
from django.db import models
from apps.hcm.models import Employee


class LeaveRequest(models.Model):
    class LeaveType(models.TextChoices):
        ANNUAL = "ANNUAL", "Annual"
        SICK = "SICK", "Sick"
        CASUAL = "CASUAL", "Casual"
        UNPAID = "UNPAID", "Unpaid"
        MATERNITY = "MATERNITY", "Maternity"
        PATERNITY = "PATERNITY", "Paternity"
        COMPASSIONATE = "COMPASSIONATE", "Compassionate"
        STUDY = "STUDY", "Study"
        BEREAVEMENT = "BEREAVEMENT", "Bereavement"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="leave_requests")
    leave_type = models.CharField(max_length=20, choices=LeaveType.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.PositiveIntegerField(default=1)
    reason = models.TextField(blank=True)
    doctor_note = models.FileField(upload_to="sick_notes/", null=True, blank=True)

    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="approved_leaves"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.employee.full_name} {self.leave_type} ({self.status})"

    def recalc_days(self):
        """Working days for leave types whose policy counts working days (annual leave by
        default); calendar days for the rest (sick, maternity…)."""
        if not (self.start_date and self.end_date):
            return
        from .balances import working_days_for_request

        days = working_days_for_request(self)
        if days is None:
            days = max((self.end_date - self.start_date).days + 1, 1)
        self.days = days

    def save(self, *args, **kwargs):  # pragma: no cover - logic is simple
        self.recalc_days()
        super().save(*args, **kwargs)


class SickNote(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="sick_notes")
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="issued_sick_notes",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.PositiveIntegerField(default=1)
    diagnosis = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    document = models.FileField(upload_to="sick_notes/", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.employee.full_name} sick note ({self.status})"

    def recalc_days(self):
        if self.start_date and self.end_date:
            delta = (self.end_date - self.start_date).days + 1
            self.days = max(delta, 1)

    def save(self, *args, **kwargs):  # pragma: no cover - logic is simple
        self.recalc_days()
        super().save(*args, **kwargs)


class Absenteeism(models.Model):
    """Track employee absenteeism reports - unauthorized or unplanned absences"""
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        JUSTIFIED = "JUSTIFIED", "Justified"
        UNJUSTIFIED = "UNJUSTIFIED", "Unjustified"
        UNDER_REVIEW = "UNDER_REVIEW", "Under Review"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="absenteeism_reports")
    date = models.DateField(help_text="Date of absence")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reason_provided = models.TextField(blank=True, help_text="Reason provided by employee")
    supervisor_notes = models.TextField(blank=True, help_text="Supervisor/HR notes")
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reported_absences",
    )
    supporting_document = models.FileField(upload_to="absenteeism/", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]
        verbose_name_plural = "Absenteeism Reports"

    def __str__(self) -> str:
        return f"{self.employee.full_name} - {self.date} ({self.status})"


class DoubleTicketRequest(models.Model):
    """
    Double Ticket: Sunday/Public Holiday Work
    Under Zambian Employment Code Act, working on rest days requires double pay.
    Payment = (Basic Salary ÷ 208) × 2 × Hours Worked
    """
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        PAID = "PAID", "Paid"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="double_tickets")
    work_date = models.DateField(help_text="Sunday or public holiday worked")
    hours_worked = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=Decimal("8.00"),
        help_text="Hours worked (default 8 for full shift)"
    )
    reason = models.TextField(help_text="Reason for Sunday/holiday work")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_double_tickets"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    
    # Calculated payment amount (stored for audit)
    calculated_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Calculated double ticket payment"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-work_date", "-created_at"]
        verbose_name = "Double Ticket Request"
        verbose_name_plural = "Double Ticket Requests"

    def __str__(self) -> str:
        return f"{self.employee.full_name} - {self.work_date} ({self.hours_worked}h, {self.status})"

    def calculate_payment(self):
        """
        Calculate double ticket payment based on Zambian law:
        Hourly Rate = Basic Salary ÷ 208
        Double Ticket = (Hourly Rate × 2) × Hours Worked
        """
        try:
            # Get employee's basic salary from most recent payslip or payroll entry.
            # Use getattr() to avoid false-positive static analysis warnings for dynamic
            # reverse relations on the Employee model.
            basic_salary = None
            source = None

            payslips = getattr(self.employee, 'payslips', None)
            if payslips is not None:
                payslip = payslips.filter(basic_salary__gt=0).order_by('-created_at').first()
                if payslip:
                    basic_salary = payslip.basic_salary
                    source = f"payslip {payslip.id}"

            if not basic_salary:
                payroll_entries = getattr(self.employee, 'payroll_entries', None)
                if payroll_entries is not None:
                    entry = payroll_entries.filter(basic__gt=0).order_by('-updated_at', '-created_at').first()
                    if entry:
                        basic_salary = entry.basic
                        source = f"payroll entry {entry.id}"

            if not basic_salary:
                engagement = getattr(self.employee, 'engagement', None)
                if engagement and getattr(engagement, 'contract_type', None):
                    contracts = getattr(self.employee, 'contracts', None)
                    if contracts is not None:
                        contract = contracts.filter(status='ACTIVE').first()
                        if contract and hasattr(contract, 'basic_salary'):
                            basic_salary = contract.basic_salary
                            source = f"contract {contract.id}"

            if basic_salary and basic_salary > 0:
                basic_float = float(basic_salary)
                hours_float = float(self.hours_worked)
                hourly_rate = basic_float / 208  # Monthly basic ÷ 208 hours
                double_ticket_amount = (hourly_rate * 2) * hours_float
                result = round(double_ticket_amount, 2)
                print(f"[Double Ticket] Employee {self.employee.employee_id}: Basic={basic_float} (from {source}), Hours={hours_float}, Payment={result}")
                return result
            else:
                print(f"[Double Ticket] Employee {self.employee.employee_id}: No basic salary found - cannot calculate payment")

            return 0
        except Exception as e:
            print(f"Error calculating double ticket payment for {self.employee.employee_id}: {e}")
            import traceback
            traceback.print_exc()
            return 0


class LeavePolicy(models.Model):
    """
    Entitlement rules per workspace and leave type. Only leave types with a policy
    accrue and have a balance. When a workspace has no ANNUAL policy row, the
    defaults below apply (see balances.get_policy).
    """
    workspace = models.ForeignKey(
        'core.Workspace', on_delete=models.CASCADE, related_name='leave_policies'
    )
    leave_type = models.CharField(max_length=20, choices=LeaveRequest.LeaveType.choices)
    days_per_month = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('2.00'),
        help_text="Days accrued per full month of service (2 = 24 days a year)"
    )
    carry_forward_cap = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True, default=Decimal('12.00'),
        help_text="Maximum days kept at the end of a leave year; empty = no limit"
    )
    leave_year_start_month = models.PositiveSmallIntegerField(
        default=1, help_text="Month the leave year starts (1 = January)"
    )
    count_working_days = models.BooleanField(
        default=True, help_text="Count requests in working days (excluding rest days and public holidays)"
    )
    working_weekdays = models.CharField(
        max_length=20, default='0,1,2,3,4',
        help_text="Working weekdays, Monday=0 … Sunday=6 (default Monday–Friday)"
    )
    allow_negative_balance = models.BooleanField(
        default=False, help_text="Allow approving leave beyond the available balance"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'leave_type'], name='uniq_leave_policy_type'),
        ]
        verbose_name_plural = "Leave Policies"

    def __str__(self):
        return f"{self.workspace} - {self.leave_type} ({self.days_per_month}/month)"

    @property
    def weekday_set(self) -> set[int]:
        return {int(d) for d in self.working_weekdays.split(',') if d.strip().isdigit()}


class LeaveLedgerEntry(models.Model):
    """
    Append-only record of every change to an employee's leave balance.
    Balance = sum of `days`. Entries are never edited or deleted; corrections are new entries.
    """
    class Kind(models.TextChoices):
        OPENING = 'OPENING', 'Opening balance'
        ACCRUAL = 'ACCRUAL', 'Monthly accrual'
        TAKEN = 'TAKEN', 'Leave taken'
        ADJUSTMENT = 'ADJUSTMENT', 'Manual adjustment'
        EXPIRY = 'EXPIRY', 'Carry-forward expiry'
        PAID_OUT = 'PAID_OUT', 'Paid out'

    workspace = models.ForeignKey(
        'core.Workspace', on_delete=models.CASCADE, null=True, blank=True, related_name='+'
    )
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='leave_ledger')
    leave_type = models.CharField(max_length=20, choices=LeaveRequest.LeaveType.choices)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    date = models.DateField(help_text="Date the change takes effect")
    period = models.DateField(
        null=True, blank=True,
        help_text="Month accrued (first day) for ACCRUAL; leave-year end for EXPIRY"
    )
    days = models.DecimalField(max_digits=7, decimal_places=2, help_text="Signed: + adds, - uses")
    source_type = models.CharField(max_length=40, blank=True)   # 'leave_request', 'final_settlement'…
    source_id = models.CharField(max_length=64, blank=True)
    note = models.CharField(max_length=255, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'leave_type', 'period'], condition=models.Q(kind='ACCRUAL'),
                name='uniq_leave_accrual_month'
            ),
            models.UniqueConstraint(
                fields=['employee', 'leave_type', 'period'], condition=models.Q(kind='EXPIRY'),
                name='uniq_leave_expiry_year'
            ),
            models.UniqueConstraint(
                fields=['employee', 'leave_type'], condition=models.Q(kind='OPENING'),
                name='uniq_leave_opening'
            ),
        ]
        indexes = [
            models.Index(fields=['employee', 'leave_type', 'date']),
            models.Index(fields=['workspace', 'leave_type']),
            models.Index(fields=['source_type', 'source_id']),
        ]
        verbose_name_plural = "Leave Ledger Entries"

    def __str__(self):
        return f"{self.employee} {self.leave_type} {self.kind} {self.days:+} on {self.date}"

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise ValueError("Leave ledger entries can't be changed; add a correcting entry instead")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Leave ledger entries can't be deleted; add a correcting entry instead")
