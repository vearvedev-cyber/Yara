"""
Core Models: Workspace, WorkspaceMembership
Multi-tenant foundation for the HRMS.
"""

from django.db import models
from django.contrib.auth.models import User


class Workspace(models.Model):
    """
    Workspace/Organization/Tenant - the top-level container for data isolation.
    Examples: "Konkola Mines", "ABC Contractors Ltd", "HR Consulting Firm"
    """
    WORKSPACE_TYPE_CHOICES = [
        ('COMPANY', 'Company'),  # Main company managing own staff + contractors
        ('CONTRACTOR_FIRM', 'Contractor Firm'),  # Supplies contractors to other companies
        ('CONSULTANT', 'Consultant/Advisor'),  # Manages HR for multiple client companies
    ]
    
    name = models.CharField(max_length=200, unique=True, help_text="Organization name")
    code = models.CharField(max_length=50, unique=True, help_text="Short code/abbreviation")
    workspace_type = models.CharField(max_length=20, choices=WORKSPACE_TYPE_CHOICES, default='COMPANY')
    
    description = models.TextField(blank=True)
    industry = models.CharField(max_length=100, blank=True, help_text="e.g., Mining, Construction")
    
    # Contact info
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)

    # Branding
    logo = models.ImageField(upload_to='workspace_logos/', blank=True, null=True)
    logo_data = models.BinaryField(blank=True, null=True, editable=False)
    logo_content_type = models.CharField(max_length=100, blank=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='workspaces_created')
    
    class Meta:
        verbose_name_plural = "Workspaces"
        ordering = ['name']
    
    def __str__(self):
        return f"{self.code} - {self.name}"


class WorkspaceMembership(models.Model):
    """
    Links users to workspaces with roles.
    A user can belong to multiple workspaces (e.g., consultant managing multiple clients).
    """
    ROLE_CHOICES = [
        ('OWNER', 'Owner'),  # Full control
        ('ADMIN', 'Administrator'),  # Can manage users and settings
        ('HR_MANAGER', 'HR Manager'),  # Can manage employees and HR functions
        ('MANAGER', 'Manager'),  # Can view and manage assigned areas
        ('VIEWER', 'Viewer'),  # Read-only access
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_memberships')
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='members')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='VIEWER')
    
    is_default = models.BooleanField(
        default=False,
        help_text="Default workspace to load on login"
    )
    is_active = models.BooleanField(default=True)
    
    # Metadata
    joined_at = models.DateTimeField(auto_now_add=True)
    invited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='workspace_invites_sent')
    
    class Meta:
        verbose_name_plural = "Workspace Memberships"
        unique_together = [('user', 'workspace')]
        ordering = ['-is_default', 'workspace__name']
    
    def __str__(self):
        return f"{self.user.username} @ {self.workspace.name} ({self.role})"
    
    def save(self, *args, **kwargs):
        # Ensure only one default workspace per user
        if self.is_default:
            WorkspaceMembership.objects.filter(
                user=self.user,
                is_default=True
            ).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class UserProfile(models.Model):
    """
    Extended user profile with additional fields
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='userprofile')
    profile_picture = models.ImageField(upload_to='profile_pictures/', blank=True, null=True)
    job_title = models.CharField(max_length=200, blank=True)
    bio = models.TextField(max_length=500, blank=True, help_text="Brief description about yourself")
    personality_type = models.TextField(max_length=300, blank=True, help_text="What type of person are you?")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name_plural = "User Profiles"
    
    def __str__(self):
        return f"{self.user.username}'s profile"


class Conversation(models.Model):
    """Simple conversation for messaging (supports group and 1:1)."""
    name = models.CharField(max_length=200, blank=True)
    is_group = models.BooleanField(default=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.SET_NULL, null=True, blank=True, related_name='conversations')
    participants = models.ManyToManyField(User, related_name='conversations')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name or ("Group" if self.is_group else "Conversation")
    
    def unread_count_for_user(self, user):
        """Get count of unread messages for a specific user."""
        return self.messages.exclude(read_by=user).exclude(sender=user).count()


class Message(models.Model):
    """Messages within a conversation."""
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    body = models.TextField()
    read_by = models.ManyToManyField(User, related_name='read_messages', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.sender}: {self.body[:30]}"


# Import custom role models from custom_roles module
from .custom_roles import CustomRole, CustomRolePermission, UserCustomRole  # noqa: E402, F401


class WorkspaceAccessRequest(models.Model):
    """
    Tracks requests from users to join a workspace.
    Consultants/external users can browse workspaces and request access.
    Workspace admins can approve/deny with role assignment.
    """
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('DENIED', 'Denied'),
    ]
    
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='access_requests')
    requesting_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_access_requests')
    
    # Request details
    message = models.TextField(blank=True, help_text="Why the user wants access")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    
    # Processing details
    processed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='processed_access_requests')
    processed_at = models.DateTimeField(null=True, blank=True)
    admin_notes = models.TextField(blank=True, help_text="Internal notes from admin")
    
    # Assigned role (if approved)
    assigned_role = models.CharField(max_length=20, choices=WorkspaceMembership.ROLE_CHOICES, blank=True)
    assigned_custom_role = models.ForeignKey(CustomRole, on_delete=models.SET_NULL, null=True, blank=True, related_name='access_requests')
    
    # Metadata
    requested_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-requested_at']
        unique_together = [('workspace', 'requesting_user', 'status')]
        indexes = [
            models.Index(fields=['workspace', 'status']),
            models.Index(fields=['requesting_user', 'status']),
        ]
    
    def __str__(self):
        return f"{self.requesting_user.username} → {self.workspace.name} ({self.status})"


class PublicHoliday(models.Model):
    """
    Public holidays, used to count working days (leave, statutory due dates).
    workspace=NULL rows are national holidays shared by every workspace;
    workspace rows add company-specific days off.
    """
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, null=True, blank=True, related_name='public_holidays'
    )
    date = models.DateField(db_index=True)
    name = models.CharField(max_length=100)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date']
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'date'], name='uniq_public_holiday_workspace_date'),
            models.UniqueConstraint(
                fields=['date'], condition=models.Q(workspace__isnull=True), name='uniq_public_holiday_national_date'
            ),
        ]

    def __str__(self):
        return f"{self.date} - {self.name}"
