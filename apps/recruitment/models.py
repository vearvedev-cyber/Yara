"""
Recruitment Models
Includes ATR (Approval To Recruit), Candidate pipeline, and mapping to onboarding steps.
"""

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone
from apps.hcm.models import Department
from apps.core.models import Workspace


class ATR(models.Model):
    """
    Approval To Recruit form metadata captured digitally.
    
    Department managers use this to request approval for new positions.
    Captures position requirements including skills, experience, and qualifications needed.
    """
    reference_number = models.CharField(max_length=50, unique=True)
    department = models.ForeignKey(Department, on_delete=models.PROTECT)
    hiring_supervisor_name = models.CharField(max_length=200)

    # Position details
    position_title = models.CharField(max_length=200)
    roles_to_fill = models.IntegerField(default=1)
    due_date = models.DateField(null=True, blank=True)
    
    # Requirements (skills, experience, qualifications)
    required_skills = models.TextField(
        blank=True,
        help_text="Required technical skills and competencies"
    )
    required_experience = models.TextField(
        blank=True,
        help_text="Years and type of experience required"
    )
    required_qualifications = models.TextField(
        blank=True,
        help_text="Education level and certifications required"
    )
    skill_sets = models.TextField(
        blank=True,
        help_text="Specific skill sets needed for the role"
    )
    
    # Budget fields
    budgeted = models.BooleanField(default=False)
    budget_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    actual_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Headcount categories
    zambian_junior = models.IntegerField(default=0)
    zambian_senior = models.IntegerField(default=0)
    expatriate = models.IntegerField(default=0)

    # Strategy selections
    use_internal_db = models.BooleanField(default=False)
    internal_advertising = models.BooleanField(default=False)
    external_advertising = models.BooleanField(default=False)
    hr_db_search = models.BooleanField(default=False)
    recruitment_agencies = models.BooleanField(default=False)

    # Approvals
    hr_manager_name = models.CharField(max_length=200, blank=True)
    hr_manager_signed_at = models.DateField(null=True, blank=True)
    ops_manager_name = models.CharField(max_length=200, blank=True)
    ops_manager_signed_at = models.DateField(null=True, blank=True)
    director_name = models.CharField(max_length=200, blank=True)
    director_signed_at = models.DateField(null=True, blank=True)

    APPROVAL_STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    ]
    approval_status = models.CharField(max_length=20, choices=APPROVAL_STATUS_CHOICES, default='PENDING')

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"ATR {self.reference_number} - {self.position_title}"


class Candidate(models.Model):
    """Recruitment candidate record (as per spreadsheets)."""
    engaged_date = models.DateField()
    name = models.CharField(max_length=200)
    nrc = models.CharField(max_length=50, blank=True)
    phone_number = models.CharField(max_length=30, blank=True)

    position = models.CharField(max_length=200)
    agreed_net_pay = models.CharField(max_length=100, blank=True)  # keep string to match spreadsheet entries
    accommodation = models.CharField(max_length=200, blank=True)

    # Document submission flags
    docs_submitted = models.BooleanField(default=False)

    # Interview assessment
    interview_remarks = models.TextField(blank=True, help_text="Interview remarks or candidate assessment notes")
    knowledge_score = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        help_text="Candidate knowledge score out of 100%"
    )

    # Pipeline steps (as columns in sheet)
    recommendation_date = models.DateField(null=True, blank=True)
    interview_due_date = models.DateField(null=True, blank=True)
    silicosis_status = models.CharField(max_length=50, blank=True)  # e.g., Done/Pending
    medicals_status = models.CharField(max_length=50, blank=True)
    ibf_status = models.CharField(max_length=50, blank=True)
    initial_induction_status = models.CharField(max_length=50, blank=True)
    # Company induction status (generic)
    company_induction_status = models.CharField(max_length=50, blank=True)
    site_permit_status = models.CharField(max_length=50, blank=True)
    pit_permit_status = models.CharField(max_length=50, blank=True)
    pit_operation_permit_status = models.CharField(max_length=50, blank=True)
    ohs_status = models.CharField(max_length=50, blank=True)

    # Linkages
    atr = models.ForeignKey(ATR, on_delete=models.SET_NULL, null=True, blank=True, related_name='candidates')
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='candidates', null=True, blank=True)

    status = models.CharField(max_length=50, default='Pipeline')  # Pipeline/Onboarded/Rejected
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-engaged_date']

    def __str__(self):
        return self.name


class CandidateDocument(models.Model):
    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='documents')
    document = models.FileField(upload_to='recruitment/candidates/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f"Document for {self.candidate.name}"
