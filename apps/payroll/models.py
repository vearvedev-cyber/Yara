"""
Payroll Models
Reflects Human Management Payroll sheet: components and per-employee entries.
"""

import logging

from django.db import models
from apps.hcm.models import Employee
from decimal import Decimal, ROUND_HALF_UP

logger = logging.getLogger(__name__)


class PayrollComponent(models.Model):
    """Payroll component defaults per position/grade for analytics and templating."""
    position = models.CharField(max_length=200, db_index=True)
    currency = models.CharField(max_length=3, default='ZMW')
    basic = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    housing = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    transportation = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    lunch = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    # Derived
    gross = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    net = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [['position', 'currency']]
        ordering = ['position']

    def __str__(self):
        return f"{self.position} ({self.currency})"


class SalaryRange(models.Model):
    """Aggregate bucket of employees by gross salary range (for dashboards)."""

    label = models.CharField(max_length=50, unique=True)  # e.g., "3k < 4k"
    currency = models.CharField(max_length=3, default='ZMW')
    min_gross = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    max_gross = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    employee_count = models.PositiveIntegerField(default=0)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['label']

    def __str__(self):
        return f"{self.label} ({self.employee_count})"


class PayrollEntry(models.Model):
    """Employee payroll snapshot entry (row-based, matches sheet)."""
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='payroll_entries')
    date_of_hire = models.DateField(null=True, blank=True)
    department = models.CharField(max_length=200, blank=True, default='')
    resident = models.CharField(max_length=200, blank=True, default='')

    currency = models.CharField(max_length=3, default='ZMW')
    basic = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    housing = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    transportation = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    lunch = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    gross = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    net = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    employer_borne_deductions = models.BooleanField(
        default=False,
        help_text="If True, employer absorbs statutory deductions — employee takes home the full gross"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['employee__employee_id']

    def __str__(self):
        return f"Payroll {self.employee.full_name} {self.currency} {self.net}"


class TitleBreakdown(models.Model):
    """Breakdown of pay by job title/position for reporting (sheet: TITLE BREAKDOWN)."""

    position = models.CharField(max_length=200, db_index=True)
    currency = models.CharField(max_length=3, default='ZMW')
    basic = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    housing = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    transportation = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    lunch = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    gross = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    net = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [['position', 'currency']]
        ordering = ['position']

    def __str__(self):
        return f"{self.position} ({self.currency})"


class PayrollPeriod(models.Model):
    """
    Represents a payroll period (monthly)
    """
    year = models.IntegerField()
    month = models.IntegerField(choices=[
        (1, 'January'), (2, 'February'), (3, 'March'), (4, 'April'),
        (5, 'May'), (6, 'June'), (7, 'July'), (8, 'August'),
        (9, 'September'), (10, 'October'), (11, 'November'), (12, 'December')
    ])
    status = models.CharField(max_length=20, choices=[
        ('DRAFT', 'Draft'),
        ('PROCESSING', 'Processing'),
        ('COMPLETED', 'Completed'),
        ('PAID', 'Paid'),
    ], default='DRAFT')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        unique_together = [['year', 'month']]
        ordering = ['-year', '-month']
    
    def __str__(self):
        return f"{self.get_month_display()} {self.year}"


class Payslip(models.Model):
    """
    Individual employee payslip for a specific period
    Automatically calculates Zambian statutory deductions (NAPSA, PAYE, NHIMA)
    Per ZRA Zambia: Overtime and Bonuses are fully taxable emoluments
    """
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='payslips')
    period = models.ForeignKey('PayrollPeriod', on_delete=models.CASCADE, related_name='payslips')
    
    # Basic salary components
    basic_salary = models.DecimalField(max_digits=15, decimal_places=2)
    housing_allowance = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    transportation_allowance = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    lunch_allowance = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    other_allowances = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    
    # Taxable additions per ZRA (fully included in gross pay and tax calculations)
    # These may push employee into higher tax bracket for the month
    overtime_payment = models.DecimalField(
        max_digits=15, 
        decimal_places=2, 
        default=0, 
        help_text="Overtime pay - fully taxable emolument, included in gross earnings"
    )
    bonus = models.DecimalField(
        max_digits=15, 
        decimal_places=2, 
        default=0, 
        help_text="Bonus payment - fully taxable emolument, included in gross earnings"
    )
    double_ticket_payment = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=0,
        help_text="Double ticket payment for Sunday/Holiday work - fully taxable emolument"
    )
    
    # Leave/Absenteeism tracking
    unpaid_leave_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, help_text="Days of unpaid leave")
    unpaid_leave_deduction = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    absenteeism_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, help_text="Days absent")
    absenteeism_deduction = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    
    # Calculated fields
    gross_salary = models.DecimalField(max_digits=15, decimal_places=2)
    
    # Statutory deductions (auto-calculated)
    napsa_employee = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    napsa_employer = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    paye_tax = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    nhima_employee = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    nhima_employer = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    
    # Other deductions
    total_custom_deductions = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    
    # Final amounts
    total_deductions = models.DecimalField(max_digits=15, decimal_places=2)
    net_salary = models.DecimalField(max_digits=15, decimal_places=2)

    employer_borne_deductions = models.BooleanField(
        default=False,
        help_text="If True, employer absorbs statutory deductions — employee takes home the full gross"
    )

    # Versioning
    version = models.PositiveIntegerField(default=1, help_text="Incremented when payslip is recalculated")
    is_active = models.BooleanField(default=True, help_text="Only the latest version is active")
    original_payslip = models.ForeignKey(
        'self', 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True, 
        related_name='versions',
        help_text="Links to the first version of this payslip"
    )
    
    # Metadata
    is_processed = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = [['employee', 'period', 'version']]
        ordering = ['-period__year', '-period__month', 'employee__employee_id', '-version']
    
    def __str__(self):
        return f"{self.employee.full_name} - {self.period}"
    
    def auto_fetch_unpaid_leave_days(self):
        """
        Auto-fetch unpaid leave days from leave requests for this payslip's period
        Returns total days of APPROVED unpaid leave in the period's month
        """
        from apps.leave.models import LeaveRequest
        from datetime import date
        
        # Get the period's month and year
        period_year = self.period.year
        period_month = self.period.month
        
        # Get first and last day of the month
        from calendar import monthrange
        first_day = date(period_year, period_month, 1)
        last_day = date(period_year, period_month, monthrange(period_year, period_month)[1])
        
        # Query approved unpaid leave requests that overlap with this month
        unpaid_leaves = LeaveRequest.objects.filter(
            employee=self.employee,
            leave_type='UNPAID',
            status='APPROVED',
            start_date__lte=last_day,
            end_date__gte=first_day
        )
        
        total_days = 0
        for leave in unpaid_leaves:
            # Calculate overlap days
            overlap_start = max(leave.start_date, first_day)
            overlap_end = min(leave.end_date, last_day)
            overlap_days = (overlap_end - overlap_start).days + 1
            total_days += max(overlap_days, 0)
        
        return total_days
    
    def auto_fetch_absenteeism_days(self):
        """
        Auto-fetch absenteeism days from absenteeism reports for this payslip's period
        Returns count of UNJUSTIFIED absenteeism in the period's month
        """
        from apps.leave.models import Absenteeism
        from datetime import date
        
        # Get the period's month and year
        period_year = self.period.year
        period_month = self.period.month
        
        # Get first and last day of the month
        from calendar import monthrange
        first_day = date(period_year, period_month, 1)
        last_day = date(period_year, period_month, monthrange(period_year, period_month)[1])
        
        # Query unjustified absenteeism in this month
        absenteeism_records = Absenteeism.objects.filter(
            employee=self.employee,
            status='UNJUSTIFIED',
            date__gte=first_day,
            date__lte=last_day
        )
        
        absenteeism_count = absenteeism_records.count()
        logger.debug(
            "Absenteeism for %s: %d UNJUSTIFIED in %s–%s",
            self.employee.employee_id, absenteeism_count, first_day, last_day,
        )
        return absenteeism_count
    
    
    def auto_fetch_double_ticket_payment(self):
        """
        Auto-fetch approved double ticket payments for this payslip's period
        Returns total calculated amount from approved double ticket requests
        """
        from apps.leave.models import DoubleTicketRequest
        from datetime import date
        
        # Get the period's month and year
        period_year = self.period.year
        period_month = self.period.month
        
        # Get first and last day of the month
        from calendar import monthrange
        first_day = date(period_year, period_month, 1)
        last_day = date(period_year, period_month, monthrange(period_year, period_month)[1])
        
        # Query approved double ticket requests in this month
        double_tickets = DoubleTicketRequest.objects.filter(
            employee=self.employee,
            status__in=['APPROVED', 'PAID'],
            work_date__gte=first_day,
            work_date__lte=last_day
        )
        
        total_amount = Decimal('0.00')
        for ticket in double_tickets:
            if ticket.calculated_amount:
                total_amount += ticket.calculated_amount
            else:
                # Calculate it if not already calculated
                payment = ticket.calculate_payment()
                if payment:
                    payment_decimal = Decimal(str(payment))
                    total_amount += payment_decimal
                    ticket.calculated_amount = payment_decimal
                    ticket.save(update_fields=['calculated_amount', 'updated_at'])
        
        return total_amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    
    def calculate(self):
        """
        Calculate all payroll amounts using Zambian formulas
        Includes overtime and bonuses as fully taxable emoluments
        Auto-fetches unpaid leave, absenteeism, and double ticket data
        """
        from .utils import calculate_zambian_payroll, calculate_unpaid_leave_deduction

        def as_decimal(value):
            if isinstance(value, Decimal):
                return value
            if value is None:
                return Decimal('0')
            return Decimal(str(value))
        
        # Auto-fetch unpaid leave days if not manually set
        if self.unpaid_leave_days == 0:
            auto_unpaid_days = self.auto_fetch_unpaid_leave_days()
            if auto_unpaid_days > 0:
                self.unpaid_leave_days = auto_unpaid_days
        
        # Auto-fetch absenteeism days if not manually set
        if self.absenteeism_days == 0:
            auto_absenteeism_days = self.auto_fetch_absenteeism_days()
            if auto_absenteeism_days > 0:
                self.absenteeism_days = auto_absenteeism_days
        
        # Auto-fetch double ticket payment if not manually set
        if self.double_ticket_payment == 0:
            auto_double_ticket = self.auto_fetch_double_ticket_payment()
            if auto_double_ticket > 0:
                self.double_ticket_payment = auto_double_ticket

        basic_salary = as_decimal(self.basic_salary)
        housing_allowance = as_decimal(self.housing_allowance)
        transportation_allowance = as_decimal(self.transportation_allowance)
        lunch_allowance = as_decimal(self.lunch_allowance)
        other_allowances = as_decimal(self.other_allowances)
        overtime_payment = as_decimal(self.overtime_payment)
        bonus = as_decimal(self.bonus)
        double_ticket_payment = as_decimal(self.double_ticket_payment)

        unpaid_leave_days = as_decimal(self.unpaid_leave_days)
        unpaid_leave_deduction = as_decimal(self.unpaid_leave_deduction)
        absenteeism_days = as_decimal(self.absenteeism_days)
        absenteeism_deduction = as_decimal(self.absenteeism_deduction)

        self.basic_salary = basic_salary
        self.housing_allowance = housing_allowance
        self.transportation_allowance = transportation_allowance
        self.lunch_allowance = lunch_allowance
        self.other_allowances = other_allowances
        self.overtime_payment = overtime_payment
        self.bonus = bonus
        self.double_ticket_payment = double_ticket_payment
        self.unpaid_leave_days = unpaid_leave_days
        self.unpaid_leave_deduction = unpaid_leave_deduction
        self.absenteeism_days = absenteeism_days
        self.absenteeism_deduction = absenteeism_deduction
        
        # Calculate gross - includes ALL taxable components
        # Per ZRA: overtime, bonuses, and double tickets are emoluments and must be included
        self.gross_salary = (
            basic_salary +
            housing_allowance +
            transportation_allowance +
            lunch_allowance +
            other_allowances +
            overtime_payment +  # Fully taxable
            bonus +  # Fully taxable
            double_ticket_payment  # Fully taxable - Sunday/Holiday work
        )
        
        # Calculate unpaid leave deduction if not manually set
        if unpaid_leave_days > 0 and unpaid_leave_deduction == 0:
            self.unpaid_leave_deduction = calculate_unpaid_leave_deduction(
                self.gross_salary, 
                unpaid_leave_days
            )
        
        # Calculate absenteeism deduction if not manually set
        if absenteeism_days > 0 and absenteeism_deduction == 0:
            self.absenteeism_deduction = Decimal(str(
                calculate_unpaid_leave_deduction(float(self.gross_salary), float(absenteeism_days))
            )).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        
        # Collect all custom deductions
        custom_deductions = {}
        if self.absenteeism_deduction > 0:
            custom_deductions['Absenteeism'] = float(self.absenteeism_deduction)
        
        # Add deductions from PayslipDeduction model
        for deduction in self.custom_deductions.all():
            custom_deductions[deduction.description] = float(deduction.amount)
        
        # Calculate using Zambian payroll formulas with workspace-specific settings
        # Get workspace from employee's workspace field
        workspace = self.employee.workspace
        result = calculate_zambian_payroll(
            float(self.gross_salary),
            float(self.unpaid_leave_deduction),
            custom_deductions,
            workspace=workspace
        )
        
        # Update fields
        self.napsa_employee = result['deductions']['napsa_employee']
        self.napsa_employer = result['deductions']['napsa_employer']
        self.paye_tax = result['deductions']['paye']
        self.nhima_employee = result['deductions']['nhima_employee']
        self.nhima_employer = result['deductions']['nhima_employer']
        self.total_custom_deductions = result['deductions']['total_custom']

        if self.employer_borne_deductions:
            # Employer absorbs statutory deductions — employee receives full gross
            # Deductions are still recorded for ZRA remittance but don't reduce take-home
            self.total_deductions = result['deductions']['total_custom'] + float(self.unpaid_leave_deduction)
            self.net_salary = float(self.gross_salary) - self.total_deductions
        else:
            self.total_deductions = result['deductions']['total']
            self.net_salary = result['net_pay']

        self.is_processed = True


class PayslipDeduction(models.Model):
    """
    Custom deductions that can be added to a payslip
    (e.g., loan repayment, advance deduction, disciplinary deduction)
    """
    payslip = models.ForeignKey(Payslip, on_delete=models.CASCADE, related_name='custom_deductions')
    description = models.CharField(max_length=200, help_text="e.g., 'Loan Repayment', 'Advance Recovery'")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['description']
    
    def __str__(self):
        return f"{self.description}: K{self.amount}"


class WorkspaceStatutorySettings(models.Model):
    """
    Workspace-specific statutory deduction rates and limits
    Allows different workspaces to have custom NAPSA, NHIMA rates and NAPSA ceiling
    """
    workspace = models.OneToOneField('core.Workspace', on_delete=models.CASCADE, related_name='statutory_settings')
    
    # NAPSA Settings
    napsa_rate = models.DecimalField(
        max_digits=5, 
        decimal_places=4, 
        default=0.05,
        help_text="NAPSA employee contribution rate (default 5%)"
    )
    napsa_ceiling_monthly = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=34164.00,
        help_text="Monthly NAPSA ceiling (default K34,164.00)"
    )
    
    # NHIMA Settings
    nhima_rate = models.DecimalField(
        max_digits=5,
        decimal_places=4,
        default=0.01,
        help_text="NHIMA employee contribution rate (default 1%)"
    )

    # Salary split ratios — used by calculate_gross_from_net()
    basic_ratio = models.DecimalField(
        max_digits=5, decimal_places=4, default=0.45,
        help_text="Fraction of gross allocated to basic salary (default 45%)"
    )
    housing_ratio = models.DecimalField(
        max_digits=5, decimal_places=4, default=0.25,
        help_text="Fraction of gross allocated to housing allowance (default 25%)"
    )
    transport_ratio = models.DecimalField(
        max_digits=5, decimal_places=4, default=0.15,
        help_text="Fraction of gross allocated to transportation allowance (default 15%)"
    )
    lunch_ratio = models.DecimalField(
        max_digits=5, decimal_places=4, default=0.15,
        help_text="Fraction of gross allocated to lunch allowance (default 15%)"
    )

    # Metadata
    effective_date = models.DateField(auto_now=True, help_text="Date these settings became effective")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name_plural = "Workspace Statutory Settings"
    
    def __str__(self):
        return f"Statutory Settings - {self.workspace.name}"


class PayeTaxBand(models.Model):
    """
    Configurable PAYE tax bands per workspace
    Replaces hardcoded tax bands to allow customization per region/jurisdiction
    """
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='paye_tax_bands')
    
    min_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Minimum chargeable income for this band"
    )
    max_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Maximum chargeable income for this band (use high number for open-ended)"
    )
    rate = models.DecimalField(
        max_digits=5,
        decimal_places=4,
        help_text="Tax rate for this band (e.g., 0.20 for 20%)"
    )
    order = models.PositiveIntegerField(
        default=0,
        help_text="Order in which bands are applied (0=first)"
    )
    effective_date = models.DateField(auto_now=True, help_text="Date this band became effective")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['workspace', 'order', 'min_amount']
        unique_together = [['workspace', 'min_amount', 'max_amount']]
        verbose_name_plural = "PAYE Tax Bands"
    
    def __str__(self):
        return f"{self.workspace.name} - K{self.min_amount} to K{self.max_amount} @ {self.rate*100}%"


class ComplianceDocument(models.Model):
    """
    Tracks statutory compliance documents required by Zambian law.
    Covers NAPSA, NHIMA, ZRA, WCFCB, PACRA, Ministry of Labour and OHS certificates.
    """

    class DocumentType(models.TextChoices):
        NAPSA = 'NAPSA', 'NAPSA Compliance Certificate'
        NHIMA = 'NHIMA', 'NHIMA Registration Certificate'
        ZRA_TPIN = 'ZRA_TPIN', 'ZRA TPIN Certificate'
        ZRA_TCC = 'ZRA_TCC', 'Tax Clearance Certificate (TCC)'
        WCFCB = 'WCFCB', 'Workers Compensation Certificate (WCFCB)'
        PACRA = 'PACRA', 'PACRA Certificate / Annual Returns'
        MOL = 'MOL', 'Ministry of Labour Registration'
        OHS = 'OHS', 'OHS Compliance Record'
        SDL = 'SDL', 'Skills Development Levy (SDL)'
        OTHER = 'OTHER', 'Other'

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        EXPIRING_SOON = 'EXPIRING_SOON', 'Expiring Soon'
        EXPIRED = 'EXPIRED', 'Expired'
        PERMANENT = 'PERMANENT', 'Permanent (No Expiry)'

    workspace = models.ForeignKey(
        'core.Workspace', on_delete=models.CASCADE, related_name='compliance_documents'
    )
    document_type = models.CharField(max_length=20, choices=DocumentType.choices)
    document_name = models.CharField(
        max_length=200, blank=True,
        help_text="Custom display name (leave blank to use document type label)"
    )
    reference_number = models.CharField(max_length=100, blank=True, help_text="Certificate/reference number")
    issued_by = models.CharField(max_length=200, blank=True, help_text="Issuing authority name")
    issue_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True, help_text="Leave blank for permanent documents")
    is_permanent = models.BooleanField(
        default=False, help_text="Tick for once-off documents with no expiry (TPIN, MOL registration)"
    )
    document_file = models.FileField(
        upload_to='compliance_docs/%Y/', null=True, blank=True, help_text="Attach scanned certificate"
    )
    notes = models.TextField(blank=True)
    reminder_days = models.PositiveIntegerField(
        default=30, help_text="Alert X days before expiry"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['document_type', '-issue_date']
        verbose_name = "Compliance Document"
        verbose_name_plural = "Compliance Documents"

    def __str__(self):
        return f"{self.workspace.name} — {self.get_document_type_display()}"

    @property
    def computed_status(self) -> str:
        from datetime import date
        if self.is_permanent or not self.expiry_date:
            return 'Permanent'
        today = date.today()
        delta = (self.expiry_date - today).days
        if delta < 0:
            return 'Expired'
        if delta <= self.reminder_days:
            return 'Expiring Soon'
        return 'Active'

    @property
    def days_until_expiry(self):
        from datetime import date
        if not self.expiry_date or self.is_permanent:
            return None
        return (self.expiry_date - date.today()).days


class PayslipAuditLog(models.Model):
    """
    Audit trail for payslip changes
    Tracks who created, updated, calculated, or deleted payslips and what changed
    """
    ACTION_CHOICES = [
        ('CREATED', 'Created'),
        ('CALCULATED', 'Calculated'),
        ('UPDATED', 'Updated'),
        ('DELETED', 'Deleted'),
    ]
    
    payslip = models.ForeignKey(Payslip, on_delete=models.CASCADE, related_name='audit_logs')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    user = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    changes = models.JSONField(
        default=dict, 
        blank=True,
        help_text="Delta changes for UPDATED actions or calculation details"
    )
    
    class Meta:
        ordering = ['-timestamp']
        verbose_name_plural = "Payslip Audit Logs"
    
    def __str__(self):
        return f"{self.payslip} - {self.action} by {self.user or 'System'} on {self.timestamp}"


class PAYEReturn(models.Model):
    """
    PAYE (Pay As You Earn) statutory return for a specific period and workspace.
    Aggregates employee tax data for submission to tax authority.
    
    Columns:
    - TPIN: Employee's Tax PIN
    - Full Name: Employee full name
    - Employee Nature: Contract type (PERMANENT, CONTRACT, CONTRACTOR, etc.)
    - Gross Pay: Total taxable income
    - Chargeable Amount: Gross Pay minus tax-exempt deductions (e.g., NAPSA)
    - Tax Credit: Personal relief allowances
    - Tax Payable: Calculated PAYE tax liability
    """
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='paye_returns')
    period = models.ForeignKey(PayrollPeriod, on_delete=models.CASCADE, related_name='paye_returns')
    
    # Summary
    total_employees = models.PositiveIntegerField(default=0)
    total_gross_pay = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_chargeable_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_tax_credit = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_tax_payable = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    
    # Status
    status = models.CharField(
        max_length=20,
        choices=[
            ('DRAFT', 'Draft'),
            ('SUBMITTED', 'Submitted'),
            ('ACCEPTED', 'Accepted'),
            ('REJECTED', 'Rejected'),
        ],
        default='DRAFT',
        help_text="Return submission status"
    )
    
    submitted_at = models.DateTimeField(null=True, blank=True)
    submission_notes = models.TextField(blank=True, help_text="Notes about submission or rejection")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True)
    
    class Meta:
        unique_together = [['workspace', 'period']]
        ordering = ['-period__year', '-period__month']
        verbose_name_plural = "PAYE Returns"
    
    def __str__(self):
        return f"PAYE Return - {self.workspace.name} {self.period}"
    
    def calculate(self):
        """
        Calculate the PAYE return by aggregating payslip data for the period.
        Updates the summary fields.
        """
        from django.db.models import Sum, Q
        
        # Get all active payslips for this workspace and period
        payslips = Payslip.objects.filter(
            period=self.period,
            employee__workspace=self.workspace,
            is_active=True,
            is_processed=True
        )
        
        self.total_employees = payslips.count()
        
        # Aggregate amounts
        aggregates = payslips.aggregate(
            gross_sum=Sum('gross_salary'),
            paye_sum=Sum('paye_tax'),
            napsa_sum=Sum('napsa_employee'),
        )
        
        self.total_gross_pay = aggregates['gross_sum'] or Decimal('0')
        self.total_tax_payable = aggregates['paye_sum'] or Decimal('0')
        
        # Chargeable amount = Gross - NAPSA employee contribution (tax-exempt)
        napsa_total = aggregates['napsa_sum'] or Decimal('0')
        self.total_chargeable_amount = self.total_gross_pay - napsa_total
        
        # Tax credit (basic personal relief) - standard K30,600 per month in Zambia
        # This can be workspace-configured, but we use a fixed amount for now
        tax_credit_per_employee = Decimal('30600')
        self.total_tax_credit = tax_credit_per_employee * self.total_employees
        
        self.save(update_fields=[
            'total_employees',
            'total_gross_pay',
            'total_chargeable_amount',
            'total_tax_credit',
            'total_tax_payable',
        ])
    
    def generate_detailed_rows(self):
        """
        Generate detailed PAYE return rows (one per employee).
        Returns list of dicts with TPIN, Full Name, Employee Nature, Gross Pay, etc.
        """
        payslips = Payslip.objects.filter(
            period=self.period,
            employee__workspace=self.workspace,
            is_active=True,
            is_processed=True
        ).select_related('employee', 'employee__engagement', 'employee__engagement__contract_type')

        rows = []
        for payslip in payslips:
            employee = payslip.employee

            # Chargeable amount = Gross - NAPSA
            chargeable = payslip.gross_salary - payslip.napsa_employee

            # Tax credit (basic personal relief)
            tax_credit = Decimal('30600')

            # Tax payable is already calculated in the payslip
            tax_payable = payslip.paye_tax

            # Use engagement contract type (set by HR); fall back to employee classifier
            engagement = getattr(employee, 'engagement', None)
            engagement_contract = engagement and engagement.contract_type
            if engagement_contract:
                employee_nature = engagement_contract.get_name_display()
                contractor_type = engagement_contract.name
            else:
                employee_nature = employee.get_contractor_type_display()
                contractor_type = employee.contractor_type

            row = {
                'tpin': employee.tpin or '',
                'full_name': employee.full_name,
                'employee_nature': employee_nature,
                'contractor_type': contractor_type,
                'gross_pay': payslip.gross_salary,
                'chargeable_amount': chargeable,
                'tax_credit': tax_credit,
                'tax_payable': tax_payable,
                'employee_id': employee.employee_id,
            }
            rows.append(row)
        
        # Sort by TPIN or employee name
        rows.sort(key=lambda x: x['tpin'] or x['full_name'])
        
        return rows
