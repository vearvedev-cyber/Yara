"""
Core API ViewSets for assignments: Sites, Projects, Clients, Assignments.
Workspace management endpoints.
"""

from typing import Any, Optional
from rest_framework import viewsets, filters, status, mixins
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from django.db.models import Count, Q
from django.http import FileResponse, HttpResponse
from django_filters.rest_framework import DjangoFilterBackend
from django.contrib.auth import get_user_model

User = get_user_model()

from .assignments import Site, Project, Client, Assignment
from .assignment_serializers import (
    SiteSerializer,
    ProjectSerializer,
    ClientSerializer,
    AssignmentSerializer,
)
from .models import Workspace, WorkspaceMembership, WorkspaceAccessRequest, CustomRole
from .serializers import (
    WorkspaceSerializer,
    WorkspaceMembershipSerializer,
    WorkspaceSwitchSerializer,
    UserBasicSerializer,
    WorkspaceUserCreateSerializer,
    WorkspaceAccessRequestSerializer,
    WorkspaceAccessRequestCreateSerializer,
    WorkspaceAccessRequestProcessSerializer,
)
from .permissions import HasWorkspaceRole, check_permission
from apps.hcm.models import Employee, ContractorCompliance
from apps.activities.models import CaseStudy


class WorkspacePermissionMixin:
    """
    Mixin for ViewSets to enforce workspace-level permissions.
    Checks user's role and allows/denies operations accordingly.
    """
    permission_required = None  # Set to permission key string in subclass, e.g., 'can_manage_employees'
    request: Request  # type: ignore[assignment]
    
    def check_workspace_permission(self, permission_key: Optional[str] = None):
        """Verify user has required permission in workspace"""
        workspace = getattr(self.request, 'workspace', None)  # type: ignore[attr-defined]
        if not workspace:
            raise PermissionDenied('Workspace context required')
        
        perm = permission_key or self.permission_required
        if perm and not check_permission(self.request.user, workspace, perm):
            raise PermissionDenied(f'You do not have permission: {perm}')
    
    def filter_queryset(self, queryset):
        """Filter by workspace"""
        workspace = getattr(self.request, 'workspace', None)  # type: ignore[attr-defined]
        if workspace:
            if hasattr(queryset.model, 'workspace'):
                queryset = queryset.filter(workspace=workspace)
        super_filter = getattr(super(), 'filter_queryset', None)
        if callable(super_filter):
            return super_filter(queryset)
        return queryset


class WorkspaceViewSet(viewsets.ModelViewSet):
    """Workspace management"""
    serializer_class = WorkspaceSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'industry']
    filterset_fields = ['workspace_type', 'is_active']
    ordering = ['name']

    def _check_update_permission(self, workspace):
        if self.request.user.is_superuser:
            return
        if not check_permission(self.request.user, workspace, 'can_manage_settings'):
            raise PermissionDenied('You do not have permission to manage workspace settings')
    
    def get_queryset(self):
        # Users can only see workspaces they're members of
        if self.request.user.is_superuser:
            return Workspace.objects.all()
        return Workspace.objects.filter(
            members__user=self.request.user,
            members__is_active=True
        ).distinct()

    def perform_create(self, serializer):
        workspace = serializer.save(created_by=self.request.user)

        # Ensure creator is a member of the new workspace
        if not WorkspaceMembership.objects.filter(user=self.request.user, workspace=workspace).exists():
            has_default = WorkspaceMembership.objects.filter(
                user=self.request.user,
                is_default=True,
                is_active=True
            ).exists()
            WorkspaceMembership.objects.create(
                user=self.request.user,
                workspace=workspace,
                role='OWNER',
                is_default=not has_default,
                invited_by=self.request.user,
                is_active=True,
            )

    def update(self, request, *args, **kwargs):
        workspace = self.get_object()
        self._check_update_permission(workspace)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        workspace = self.get_object()
        self._check_update_permission(workspace)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=['get'])
    def logo(self, request, pk=None):
        workspace = self.get_object()
        if workspace.logo_data:
            response = HttpResponse(
                workspace.logo_data,
                content_type=workspace.logo_content_type or 'image/png'
            )
            response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            return response

        if not workspace.logo:
            return Response({'detail': 'No logo uploaded'}, status=status.HTTP_404_NOT_FOUND)

        try:
            response = FileResponse(workspace.logo.open('rb'))
            response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            return response
        except FileNotFoundError:
            return Response({'detail': 'Logo file not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'], url_path='upload_logo', parser_classes=[MultiPartParser, FormParser])
    def upload_logo(self, request, pk=None):
        """Upload workspace logo — stores as binary in DB, no filesystem required."""
        workspace = self.get_object()
        self._check_update_permission(workspace)
        logo_file = request.FILES.get('logo')
        if not logo_file:
            return Response({'detail': 'No logo file provided'}, status=status.HTTP_400_BAD_REQUEST)
        logo_file.seek(0)
        workspace.logo_data = logo_file.read()
        workspace.logo_content_type = logo_file.content_type or 'image/png'
        workspace.save(update_fields=['logo_data', 'logo_content_type'])
        return Response({'detail': 'Logo uploaded successfully'})
    
    @action(detail=False, methods=['get'])
    def my_workspaces(self, request):
        """Get all workspaces the current user has access to"""
        memberships = WorkspaceMembership.objects.filter(
            user=request.user,
            is_active=True
        ).select_related('workspace')
        
        data = [{
            'workspace': WorkspaceSerializer(m.workspace).data,
            'role': m.role,
            'is_default': m.is_default
        } for m in memberships]
        
        return Response(data)
    
    @action(detail=False, methods=['get'])
    def current_workspace_debug(self, request):
        """DEBUG: Show current workspace context from middleware"""
        workspace_header = request.META.get('HTTP_X_WORKSPACE_ID', 'NOT SENT')
        current_workspace = getattr(request, 'workspace', None)  # type: ignore[attr-defined]
        current_workspace_id = getattr(request, 'workspace_id', None)  # type: ignore[attr-defined]
        
        return Response({
            'user': request.user.username,
            'header_sent': workspace_header,
            'backend_workspace_id': current_workspace_id,
            'backend_workspace_name': current_workspace.name if current_workspace else 'NONE',
            'all_user_workspaces': [{
                'id': m.workspace_id,  # type: ignore[attr-defined]
                'name': m.workspace.name,
                'is_default': m.is_default
            } for m in WorkspaceMembership.objects.filter(user=request.user, is_active=True).select_related('workspace')]
        })
    
    
    @action(detail=False, methods=['post'])
    def switch(self, request):
        """Switch to a different workspace"""
        serializer = WorkspaceSwitchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        workspace_id = serializer.validated_data.get('workspace_id')  # type: ignore[union-attr]
        
        try:
            membership = WorkspaceMembership.objects.select_related('workspace').get(
                user=request.user,
                workspace_id=workspace_id,
                is_active=True
            )
            
            return Response({
                'workspace': WorkspaceSerializer(membership.workspace).data,
                'role': membership.role,
                'message': f'Switched to {membership.workspace.name}'
            })
        except WorkspaceMembership.DoesNotExist:
            return Response(
                {'error': 'You do not have access to this workspace'},
                status=status.HTTP_403_FORBIDDEN
            )
    
    @action(detail=False, methods=['get'])
    def portfolio_stats(self, request):
        """Get portfolio overview stats for all client workspaces"""
        from apps.hcm.models import Employee

        memberships = WorkspaceMembership.objects.filter(
            user=request.user,
            is_active=True
        ).select_related('workspace')

        # Superusers with no memberships yet: auto-join all active workspaces
        if not memberships.exists() and request.user.is_superuser:
            for i, ws in enumerate(Workspace.objects.filter(is_active=True)):
                WorkspaceMembership.objects.get_or_create(
                    user=request.user,
                    workspace=ws,
                    defaults={'role': 'OWNER', 'is_default': i == 0, 'is_active': True},
                )
            memberships = WorkspaceMembership.objects.filter(
                user=request.user,
                is_active=True,
            ).select_related('workspace')

        clients_data = []
        total_active_employees = 0
        total_active_projects = 0
        total_contractors = 0
        total_cases = 0
        total_open_roles = 0

        for membership in memberships:
            ws = membership.workspace

            # Get stats for this workspace
            employees = Employee.objects.filter(workspace=ws)
            total_employees = employees.count()
            active_employees = employees.filter(employment_status='ACTIVE').count()
            contractors = employees.filter(contractor_type='CONTRACTOR').count()

            # Projects are linked via assignments (Project has no workspace field)
            try:
                assignment_project_ids = (
                    Assignment.objects.filter(employee__workspace=ws)
                    .exclude(project=None)
                    .values_list('project_id', flat=True)
                    .distinct()
                )
                total_projects = Project.objects.filter(id__in=assignment_project_ids).count()
                active_projects = Project.objects.filter(id__in=assignment_project_ids, status='ACTIVE').count()
            except Exception:
                total_projects = 0
                active_projects = 0

            try:
                sites = Site.objects.filter(workspace=ws).count()
            except Exception:
                sites = 0
                
            try:
                case_count = CaseStudy.objects.filter(
                    related_employee__workspace=ws
                ).exclude(status='CLOSED').count()
            except Exception:
                case_count = 0

            # Active ATRs (count of approved ATRs for departments in this workspace)
            try:
                from apps.recruitment.models import ATR
                department_ids = employees.exclude(department=None).values_list('department_id', flat=True).distinct()
                open_roles_needed = ATR.objects.filter(
                    approval_status='APPROVED',
                    department_id__in=department_ids
                ).count()
            except Exception:
                open_roles_needed = 0

            # Compliance based on contractor compliance records
            compliance_qs = ContractorCompliance.objects.filter(client_workspace=ws)
            compliant = compliance_qs.filter(compliance_status='COMPLIANT').count()
            total_compliance = compliance_qs.count()
            compliance_percent = round((compliant / total_compliance) * 100, 2) if total_compliance else None
            if total_compliance == 0:
                compliance_level = 'Unknown'
            elif compliance_percent is not None and compliance_percent >= 95:
                compliance_level = 'Good'
            elif compliance_percent is not None and compliance_percent >= 80:
                compliance_level = 'Medium'
            else:
                compliance_level = 'Poor'

            utilization_rate = None
            attrition_rate = None
            satisfaction = None
            pending_invoices = 0

            # Compliance documents (payroll app) — the source of truth for statutory docs
            try:
                from apps.payroll.models import ComplianceDocument
                comp_docs = list(ComplianceDocument.objects.filter(workspace=ws))
                doc_active = sum(1 for d in comp_docs if d.computed_status == 'Active')
                doc_permanent = sum(1 for d in comp_docs if d.computed_status == 'Permanent')
                doc_expiring = sum(1 for d in comp_docs if d.computed_status == 'Expiring Soon')
                doc_expired = sum(1 for d in comp_docs if d.computed_status == 'Expired')
                doc_total = len(comp_docs)
                doc_valid = doc_active + doc_permanent
                doc_compliance_pct = round((doc_valid / doc_total) * 100) if doc_total > 0 else 0
            except Exception:
                doc_active = doc_permanent = doc_expiring = doc_expired = doc_total = 0
                doc_compliance_pct = 0

            clients_data.append({
                'workspace': WorkspaceSerializer(ws).data,
                'stats': {
                    'total_employees': active_employees,
                    'active_employees': active_employees,
                    'total_projects': total_projects,
                    'active_projects': active_projects,
                    'total_sites': sites,
                    'contractors_count': contractors,
                    'case_count': case_count,
                    'active_atrs': open_roles_needed,
                    'utilization_rate': utilization_rate,
                    'attrition_rate': attrition_rate,
                    'satisfaction': satisfaction,
                    'pending_invoices': pending_invoices,
                    'compliance_level': compliance_level,
                    'compliance_percent': compliance_percent,
                    'doc_compliance': {
                        'total': doc_total,
                        'active': doc_active,
                        'permanent': doc_permanent,
                        'expiring_soon': doc_expiring,
                        'expired': doc_expired,
                        'compliance_pct': doc_compliance_pct,
                    },
                },
                'role': membership.role,
            })

            total_active_employees += active_employees
            total_active_projects += active_projects
            total_contractors += contractors
            total_cases += case_count
            total_open_roles += open_roles_needed

        return Response({
            'total_clients': len(clients_data),
            'total_employees_across_all': total_active_employees,
            'total_active_projects': total_active_projects,
            'total_contractors': total_contractors,
            'total_cases': total_cases,
            'total_open_roles': total_open_roles,
            'clients': clients_data,
        })


class WorkspaceMembershipViewSet(viewsets.ModelViewSet):
    """Workspace membership management - only OWNER/ADMIN can modify"""
    serializer_class = WorkspaceMembershipSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['workspace', 'user', 'role', 'is_active']
    ordering = ['-joined_at']
    
    def get_queryset(self):
        # Users can only see memberships for workspaces they're in
        if self.request.user.is_superuser:
            return WorkspaceMembership.objects.all()
        
        user_workspaces = Workspace.objects.filter(
            members__user=self.request.user,
            members__is_active=True
        )
        
        return WorkspaceMembership.objects.filter(
            workspace__in=user_workspaces
        )
    
    def check_manage_members_permission(self):
        """Ensure user is OWNER or ADMIN in the workspace"""
        workspace = getattr(self.request, 'workspace', None)
        if not workspace:
            raise PermissionDenied('Workspace context required')
        
        if not check_permission(self.request.user, workspace, 'can_manage_members'):
            raise PermissionDenied('Only Owner/Admin can manage workspace members')
    
    def perform_create(self, serializer):
        self.check_manage_members_permission()
        serializer.save()
    
    def perform_update(self, serializer):
        self.check_manage_members_permission()
        serializer.save()
    
    def perform_destroy(self, instance):
        self.check_manage_members_permission()
        instance.delete()

    


class SiteViewSet(WorkspacePermissionMixin, viewsets.ModelViewSet):
    queryset = Site.objects.all()
    serializer_class = SiteSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "code", "location"]
    filterset_fields = ["is_active"]
    ordering_fields = ["created_at", "updated_at", "name", "code"]
    ordering = ["name"]
    permission_required = 'can_manage_sites'
    
    def get_queryset(self):
        queryset = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            queryset = queryset.filter(workspace=self.request.workspace)
        return queryset
    
    def perform_create(self, serializer):
        self.check_workspace_permission('can_manage_sites')
        if hasattr(self.request, 'workspace') and self.request.workspace:
            serializer.save(workspace=self.request.workspace)
        else:
            serializer.save()
    
    def perform_update(self, serializer):
        self.check_workspace_permission('can_manage_sites')
        serializer.save()
    
    def perform_destroy(self, instance):
        self.check_workspace_permission('can_manage_sites')
        instance.delete()


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "description"]
    filterset_fields = ["status", "start_date", "end_date"]
    ordering_fields = ["created_at", "updated_at", "start_date", "end_date", "name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        # Filter by workspace (Project has direct workspace FK)
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(workspace=self.request.workspace)
        return qs

    def perform_create(self, serializer):
        if hasattr(self.request, 'workspace') and getattr(self.request, 'workspace', None):  # type: ignore[attr-defined]
            serializer.save(workspace=getattr(self.request, 'workspace'))  # type: ignore[attr-defined]
        else:
            serializer.save()

    def perform_update(self, serializer):
        serializer.save()

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """Return counts of projects by status for dashboard charts."""
        projects_qs = Project.objects.all()
        if hasattr(request, 'workspace') and request.workspace:
            projects_qs = projects_qs.filter(workspace=request.workspace)
        
        counts = (
            projects_qs.values("status")
            .annotate(count=Count("id"))
            .order_by()
        )
        by_status = {item["status"]: item["count"] for item in counts}
        # Ensure all statuses appear even when zero
        all_statuses = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"]
        data = {s: by_status.get(s, 0) for s in all_statuses}
        return Response({"results": data})


class ClientViewSet(WorkspacePermissionMixin, viewsets.ModelViewSet):
    queryset = Client.objects.all()
    serializer_class = ClientSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "code", "industry", "contact_person", "email", "phone"]
    filterset_fields = ["is_active", "industry"]
    ordering_fields = ["created_at", "updated_at", "name", "code"]
    ordering = ["name"]
    permission_required = 'can_manage_clients'

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(workspace=self.request.workspace)
        return qs

    def perform_create(self, serializer):
        self.check_workspace_permission('can_manage_clients')
        if hasattr(self.request, 'workspace') and self.request.workspace:
            serializer.save(workspace=self.request.workspace)
        else:
            serializer.save()
    
    def perform_update(self, serializer):
        self.check_workspace_permission('can_manage_clients')
        serializer.save()
    
    def perform_destroy(self, instance):
        self.check_workspace_permission('can_manage_clients')
        instance.delete()


class AssignmentViewSet(WorkspacePermissionMixin, viewsets.ModelViewSet):
    queryset = (
        Assignment.objects.select_related("employee", "site", "project", "client").all()
    )
    serializer_class = AssignmentSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "employee__first_name",
        "employee__last_name",
        "site__name",
        "project__name",
        "client__name",
        "role_at_site",
        "shift",
    ]
    filterset_fields = [
        "employee",
        "site",
        "project",
        "client",
        "status",
        "assignment_start_date",
        "assignment_end_date",
    ]
    ordering_fields = ["assignment_start_date", "assignment_end_date", "created_at", "updated_at"]
    ordering = ["-assignment_start_date"]
    permission_required = 'can_manage_assignments'

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            # Filter by related workspace on site/project/client
            qs = qs.filter(
                Q(site__workspace=self.request.workspace)
                | Q(project__workspace=self.request.workspace)
                | Q(client__workspace=self.request.workspace)
            )
        return qs
    
    def perform_create(self, serializer):
        self.check_workspace_permission('can_manage_assignments')
        serializer.save()
    
    def perform_update(self, serializer):
        self.check_workspace_permission('can_manage_assignments')
        serializer.save()
    
    def perform_destroy(self, instance):
        self.check_workspace_permission('can_manage_assignments')
        instance.delete()


class UserViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """List workspace users and allow privileged members to create accounts + memberships"""
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        workspace = getattr(self.request, 'workspace', None)  # type: ignore[attr-defined]
        current_user = self.request.user
        user_email = getattr(current_user, 'email', 'anonymous') if current_user.is_authenticated else 'anonymous'
        print(f"[UserViewSet] workspace={workspace}, user={user_email}")
        
        if workspace:
            # Return users from the current workspace AND users from other workspaces where current user also exists
            # This allows consultants and company users to message each other across workspaces
            user_workspaces = Workspace.objects.filter(
                members__user=current_user,
                members__is_active=True
            )
            print(f"[UserViewSet] User's workspaces: {[w.id for w in user_workspaces]}")  # type: ignore[attr-defined]
            
            # Get all users from any workspace the current user belongs to
            qs = User.objects.filter(
                workspace_memberships__workspace__in=user_workspaces,
                workspace_memberships__is_active=True
            ).distinct()
            print(f"[UserViewSet] With workspace: {qs.count()} users available for messaging")
            return qs
        else:
            # If no workspace specified, return users from ALL workspaces the current user belongs to
            user_workspaces = Workspace.objects.filter(
                members__user=current_user,
                members__is_active=True
            )
            print(f"[UserViewSet] No workspace specified, user's workspaces: {[w.id for w in user_workspaces]}")  # type: ignore[attr-defined]
            qs = User.objects.filter(
                workspace_memberships__workspace__in=user_workspaces,
                workspace_memberships__is_active=True
            ).distinct()
            print(f"[UserViewSet] Without workspace: {qs.count()} users - {[u.email for u in qs]}")
            return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return WorkspaceUserCreateSerializer
        return UserBasicSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['workspace'] = getattr(self.request, 'workspace', None)
        return context

    def create(self, request, *args, **kwargs):
        workspace = getattr(request, 'workspace', None)
        if not workspace:
            return Response({'detail': 'Workspace context required.'}, status=status.HTTP_400_BAD_REQUEST)

        allowed_roles = ['OWNER', 'ADMIN']
        has_access = request.user.is_superuser or WorkspaceMembership.objects.filter(
            user=request.user,
            workspace=workspace,
            role__in=allowed_roles,
            is_active=True,
        ).exists()
        if not has_access:
            return Response({'detail': 'You do not have permission to add members.'}, status=status.HTTP_403_FORBIDDEN)

        return super().create(request, *args, **kwargs)


class WorkspaceAccessRequestViewSet(viewsets.ModelViewSet):
    """
    ViewSet for workspace access requests.
    
    - Consultants/users can list available workspaces and create requests
    - Workspace admins can view pending requests and approve/deny them
    """
    permission_classes = [IsAuthenticated]
    serializer_class = WorkspaceAccessRequestSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['requesting_user__username', 'requesting_user__first_name', 'requesting_user__last_name', 'message']
    ordering_fields = ['requested_at', 'status']
    ordering = ['-requested_at']
    
    def get_queryset(self):
        user = self.request.user
        workspace = getattr(self.request, 'workspace', None)
        
        # Superusers see all
        if user.is_superuser:
            return WorkspaceAccessRequest.objects.all()
        
        # If in workspace context, show requests for that workspace (admins)
        if workspace:
            # Check if user is admin in this workspace
            is_admin = WorkspaceMembership.objects.filter(
                user=user,
                workspace=workspace,
                role__in=['OWNER', 'ADMIN'],
                is_active=True
            ).exists()
            
            if is_admin:
                return WorkspaceAccessRequest.objects.filter(workspace=workspace)
        
        # Otherwise, show user's own requests
        return WorkspaceAccessRequest.objects.filter(requesting_user=user)
    
    def get_serializer_class(self):
        if self.action == 'create':
            return WorkspaceAccessRequestCreateSerializer
        elif self.action in ['approve', 'deny']:
            return WorkspaceAccessRequestProcessSerializer
        return WorkspaceAccessRequestSerializer
    
    @action(detail=False, methods=['get'])
    def my_requests(self, request):
        """List current user's access requests"""
        requests = WorkspaceAccessRequest.objects.filter(requesting_user=request.user)
        serializer = self.get_serializer(requests, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def pending(self, request):
        """List pending requests for workspaces where user is admin"""
        workspace = getattr(request, 'workspace', None)
        if not workspace:
            return Response({'detail': 'Workspace context required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if user is admin
        is_admin = WorkspaceMembership.objects.filter(
            user=request.user,
            workspace=workspace,
            role__in=['OWNER', 'ADMIN'],
            is_active=True
        ).exists()
        
        if not is_admin:
            return Response({'detail': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        
        requests = WorkspaceAccessRequest.objects.filter(
            workspace=workspace,
            status='PENDING'
        )
        serializer = self.get_serializer(requests, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve an access request and create workspace membership"""
        from django.utils import timezone
        
        access_request = self.get_object()
        workspace = access_request.workspace
        
        # Check if user is admin
        is_admin = WorkspaceMembership.objects.filter(
            user=request.user,
            workspace=workspace,
            role__in=['OWNER', 'ADMIN'],
            is_active=True
        ).exists()
        
        if not is_admin:
            return Response({'detail': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        
        if access_request.status != 'PENDING':
            return Response({'detail': 'Request already processed'}, status=status.HTTP_400_BAD_REQUEST)
        
        serializer = WorkspaceAccessRequestProcessSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        assigned_role = serializer.validated_data.get('assigned_role', 'VIEWER')
        assigned_custom_role_id = serializer.validated_data.get('assigned_custom_role')
        admin_notes = serializer.validated_data.get('admin_notes', '')
        
        # Create workspace membership
        membership = WorkspaceMembership.objects.create(
            user=access_request.requesting_user,
            workspace=workspace,
            role=assigned_role,
            invited_by=request.user,
            is_active=True
        )
        
        # Update request
        access_request.status = 'APPROVED'
        access_request.processed_by = request.user
        access_request.processed_at = timezone.now()
        access_request.admin_notes = admin_notes
        access_request.assigned_role = assigned_role
        
        if assigned_custom_role_id:
            try:
                custom_role = CustomRole.objects.get(id=assigned_custom_role_id, workspace=workspace)
                access_request.assigned_custom_role = custom_role
                
                # Create UserCustomRole
                from .models import UserCustomRole
                UserCustomRole.objects.create(
                    user=access_request.requesting_user,
                    role=custom_role,
                    workspace=workspace
                )
            except CustomRole.DoesNotExist:
                pass
        
        access_request.save()
        
        return Response({
            'detail': 'Access request approved',
            'membership': WorkspaceMembershipSerializer(membership).data,
            'request': WorkspaceAccessRequestSerializer(access_request).data
        })
    
    @action(detail=True, methods=['post'])
    def deny(self, request, pk=None):
        """Deny an access request"""
        from django.utils import timezone
        
        access_request = self.get_object()
        workspace = access_request.workspace
        
        # Check if user is admin
        is_admin = WorkspaceMembership.objects.filter(
            user=request.user,
            workspace=workspace,
            role__in=['OWNER', 'ADMIN'],
            is_active=True
        ).exists()
        
        if not is_admin:
            return Response({'detail': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        
        if access_request.status != 'PENDING':
            return Response({'detail': 'Request already processed'}, status=status.HTTP_400_BAD_REQUEST)
        
        serializer = WorkspaceAccessRequestProcessSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        admin_notes = serializer.validated_data.get('admin_notes', '')
        
        # Update request
        access_request.status = 'DENIED'
        access_request.processed_by = request.user
        access_request.processed_at = timezone.now()
        access_request.admin_notes = admin_notes
        access_request.save()
        
        return Response({
            'detail': 'Access request denied',
            'request': WorkspaceAccessRequestSerializer(access_request).data
        })
