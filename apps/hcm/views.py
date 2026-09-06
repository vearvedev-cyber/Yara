"""
HCM API ViewSets
Handles CRUD operations for employees, contracts, departments, etc.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import ValidationError
from django_filters.rest_framework import DjangoFilterBackend
from django.db import transaction
from django.db.models import Sum, Q, Count
from django.utils import timezone     

if TYPE_CHECKING:
    from apps.core.types import WorkspaceRequest
from django.http import HttpResponse
from datetime import timedelta, date
import pandas as pd
import csv
from io import BytesIO, StringIO
from .models import (
    Employee, Contract, Engagement, Termination, Department, Job,
    ContractType, TerminationReason, EmploymentType, EmployeeCategory, EmployeeDocument,
    EmployeeBeneficiary
)
from .filters import ContractFilter
from apps.core.models import WorkspaceMembership
from .serializers import (
    EmployeeListSerializer, EmployeeDetailSerializer,
    ContractSerializer, EngagementSerializer, TerminationSerializer,
    DepartmentSerializer, JobSerializer, ContractTypeSerializer, TerminationReasonSerializer,
    EmploymentTypeSerializer, EmployeeCategorySerializer, EmployeeDocumentSerializer,
    EmployeeBeneficiarySerializer
)


class EmployeeViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Employee CRUD operations.
    List view uses EmployeeListSerializer, detail uses EmployeeDetailSerializer.
    """
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = Employee.objects.select_related(
        'department', 'employment_type', 'category', 'classification', 'workspace'
    ).all()
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['department', 'employment_status', 'gender', 'category']
    search_fields = ['first_name', 'last_name', 'nrc', 'employee_id', 'email']
    ordering_fields = ['created_at', 'first_name', 'last_name', 'hire_date']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = super().get_queryset()
        # Filter by workspace context when available
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(workspace=self.request.workspace)
        
        # Handle full name search
        search_param = self.request.query_params.get('search', '').strip()
        if search_param:
            # Search for full name pattern "First Last"
            name_parts = search_param.split()
            if len(name_parts) >= 2:
                # Try to match "FirstName LastName" pattern
                first_name_query = name_parts[0]
                last_name_query = ' '.join(name_parts[1:])
                qs = qs.filter(
                    Q(first_name__icontains=first_name_query, last_name__icontains=last_name_query) |
                    Q(first_name__icontains=search_param) |
                    Q(last_name__icontains=search_param) |
                    Q(employee_id__icontains=search_param) |
                    Q(email__icontains=search_param) |
                    Q(nrc__icontains=search_param)
                )
            # If only one word, let the default search filter handle it
        
        return qs

    def _resolve_workspace(self, request):
        if hasattr(request, 'workspace') and request.workspace:
            return request.workspace
        if request.user and request.user.is_authenticated:
            membership = WorkspaceMembership.objects.filter(
                user=request.user,
                is_active=True,
                is_default=True
            ).select_related('workspace').first()
            if not membership:
                membership = WorkspaceMembership.objects.filter(
                    user=request.user,
                    is_active=True
                ).select_related('workspace').first()
            if membership:
                return membership.workspace
        return None

    def perform_create(self, serializer):
        # Auto-assign workspace on create; require a workspace to prevent orphan employees
        workspace = self._resolve_workspace(self.request)
        if not workspace:
            raise ValidationError({'workspace': 'Workspace is required for employee creation.'})
        serializer.save(workspace=workspace, created_by=self.request.user)

    def get_serializer_class(self):
        if self.action == 'list':
            return EmployeeListSerializer
        return EmployeeDetailSerializer

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Return live counts for dashboard cards using optimized aggregation."""
        today = timezone.now().date()
        in_30 = today + timedelta(days=30)
        
        # Get workspace-filtered queryset
        employees_qs = Employee.objects.all()
        if hasattr(request, 'workspace') and request.workspace:
            employees_qs = employees_qs.filter(workspace=request.workspace)
        
        # Single aggregation for all employee status counts
        employee_counts = employees_qs.aggregate(
            total_active=Count('id', filter=Q(employment_status='ACTIVE')),
            on_leave=Count('id', filter=Q(employment_status='ON_LEAVE')),
            suspended=Count('id', filter=Q(employment_status='SUSPENDED')),
            terminated=Count('id', filter=Q(employment_status='TERMINATED'))
        )
        
        # Contracts expiring in next 30 days (single query)
        active_qs = employees_qs.filter(employment_status='ACTIVE')
        expiring_30d = Contract.objects.filter(
            employee__in=active_qs,
            status='ACTIVE',
            end_date__gte=today,
            end_date__lte=in_30
        ).count()
        
        # Sick notes and leave data with aggregation
        sick_data = {'pending': 0, 'total': 0}
        leave_data = {'approved_days': 0, 'total_requests': 0}
        hearings_active = 0
        investigations_active = 0
        
        try:
            from apps.leave.models import SickNote, LeaveRequest
            
            # Sick notes aggregation
            sick_qs = SickNote.objects.filter(
                start_date__lte=today,
                end_date__gte=today
            )
            if hasattr(request, 'workspace') and request.workspace:
                sick_qs = sick_qs.filter(employee__workspace=request.workspace)
            
            sick_counts = sick_qs.aggregate(
                pending=Count('id', filter=Q(status='PENDING')),
                total=Count('id')
            )
            sick_data = {'pending': sick_counts['pending'], 'total': sick_counts['total']}
            
            # Leave requests aggregation
            leave_qs = LeaveRequest.objects.filter(
                status='APPROVED',
                start_date__lte=today,
                end_date__gte=today
            )
            if hasattr(request, 'workspace') and request.workspace:
                leave_qs = leave_qs.filter(employee__workspace=request.workspace)
            
            leave_counts = leave_qs.aggregate(
                total=Count('id'),
                days=Sum('days')
            )
            leave_data = {
                'total_requests': leave_counts['total'],
                'approved_days': leave_counts['days'] or 0
            }
        except Exception:
            pass
        
        # Hearings and investigations (minimal queries)
        try:
            from apps.activities.models import Hearing, Investigation
            
            hearing_qs = Hearing.objects.exclude(status='CONCLUDED')
            investigation_qs = Investigation.objects.exclude(status__in=['COMPLETED', 'CLOSED'])
            
            if hasattr(request, 'workspace') and request.workspace:
                hearing_qs = hearing_qs.filter(related_employee__workspace=request.workspace)
                investigation_qs = investigation_qs.filter(related_employee__workspace=request.workspace)
            
            hearings_active = hearing_qs.count()
            investigations_active = investigation_qs.count()
        except Exception:
            pass

        return Response({
            'employees': {
                'total': employee_counts['total_active'],
                'active': employee_counts['total_active'],
                'on_leave': employee_counts['on_leave'],
                'suspended': employee_counts['suspended'],
                'terminated': employee_counts['terminated'],
            },
            'sick_notes': sick_data,
            'leave': leave_data,
            'situations': {
                'contracts_expiring_30d': expiring_30d,
                'hearings_active': hearings_active,
                'investigations_active': investigations_active,
            }
        })

    @action(detail=False, methods=['get'])
    def classification_summary(self, request):
        """Return employee counts by classification (Local, Regional, National, Expatriate)"""
        from apps.hcm.models import EmployeeClassification
        
        classifications = EmployeeClassification.objects.all()
        data = {}
        
        # Get workspace-filtered queryset
        employee_qs = Employee.objects.filter(employment_status='ACTIVE')
        if hasattr(request, 'workspace') and request.workspace:
            employee_qs = employee_qs.filter(workspace=request.workspace)
        
        for classification in classifications:
            count = employee_qs.filter(classification=classification).count()
            data[classification.name.lower()] = count
        
        return Response(data)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def weekly_headcount(self, request):
        """Return weekly headcount movement (previous week vs current week)"""
        from django.utils import timezone
        from datetime import timedelta
        
        today = timezone.now().date()
        week_ago = today - timedelta(days=7)
        
        # Filter by workspace if available
        employee_qs = Employee.objects.all()
        if hasattr(request, 'workspace') and request.workspace:
            employee_qs = employee_qs.filter(workspace=request.workspace)
        
        # Current week active employees
        current_total = employee_qs.filter(employment_status='ACTIVE').count()
        
        # Previous week total (approximate):
        # Count employees hired on or before last week and not terminated before last week
        previous_total = employee_qs.filter(
            hire_date__lte=week_ago,
            employment_status__in=['ACTIVE', 'SUSPENDED']  # Include suspended as they were employed
        ).count()
        
        difference = current_total - previous_total
        
        return Response({
            'previous_week_total': previous_total,
            'current_week_total': current_total,
            'headcount_difference': difference,
            'comment': f'Week of {week_ago.strftime("%b %d, %Y")}'
        })

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def template_download(self, _request):
        """
        Download CSV template for employee import.
        Headers show all supported fields and example data.
        No authentication required.
        """
        output = StringIO()
        writer = csv.writer(output)

        # Headers must exactly match the import column_mapping keys (after lowercase)
        headers = [
            'Employee ID',
            'First Name',
            'Last Name',
            'Email',
            'NRC',
            'Phone',
            'Job Title',
            'Hire Date',
            'Date of Birth',
            'Gender',
            'House Address',
            'TPIN',
            'NHIMA',
            'NAPSA Number',
            'S/S Number',
            'Nationality',
            'Point of Hire',
        ]

        # Instructions row (not imported — starts with #)
        instructions = [
            '# Required: Employee ID, First Name, Last Name, NRC, Phone, Email, House Address, Job Title, Hire Date, Date of Birth, Gender',
            '', '', '', '', '', '',
            'Format: YYYY-MM-DD',
            'Format: YYYY-MM-DD',
            'M or F or OTHER',
            '', '', '', '', '', 'Default: Zambian', '',
        ]

        # Example data row
        example_row = [
            'EMP-001',
            'John',
            'Doe',
            'john.doe@company.com',
            '353891/66/1',
            '+260971234567',
            'Software Engineer',
            '2023-01-15',
            '1990-05-20',
            'M',
            '123 Main Street, Kitwe',
            'TPN123456',
            'NHM456789',
            'NAPSA001234',
            'SSS987654',
            'Zambian',
            'Kitwe',
        ]

        writer.writerow(headers)
        writer.writerow(instructions)
        writer.writerow(example_row)

        response = HttpResponse(output.getvalue(), content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="employee_import_template.csv"'
        return response

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def import_data(self, request):
        """
        Import employees from CSV or XLSX file.
        Expects 'file' in multipart form data.
        """
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Read file based on extension
            if file_obj.name.endswith('.csv'):
                df = pd.read_csv(BytesIO(file_obj.read()))
            elif file_obj.name.endswith(('.xlsx', '.xls')):
                df = pd.read_excel(BytesIO(file_obj.read()))
            else:
                return Response({'error': 'Unsupported file format. Use CSV or XLSX.'}, status=status.HTTP_400_BAD_REQUEST)

            # Map common column names to model fields (case-insensitive, after strip+lower)
            column_mapping = {
                'employee id': 'employee_id',
                'employee number': 'employee_id',
                'employee no': 'employee_id',
                's/no': 'skip_column',
                'full name': 'full_name',
                'first name': 'first_name',
                'surname': 'last_name',
                'last name': 'last_name',
                'job title': 'job_title',
                'position': 'job_title',
                # Hire date — plain and with format hint variants
                'hire date': 'hire_date',
                'hire date (yyyy-mm-dd)': 'hire_date',
                'date of engagement': 'hire_date',
                'start date': 'hire_date',
                # Date of birth variants
                'date of birth': 'date_of_birth',
                'date of birth (yyyy-mm-dd)': 'date_of_birth',
                'dob': 'date_of_birth',
                'birth date': 'date_of_birth',
                # Gender variants
                'gender': 'gender',
                'gender (m/f/other)': 'gender',
                'sex': 'gender',
                # Identity numbers
                'nrc': 'nrc',
                'national id (nrc)': 'nrc',
                'national id': 'nrc',
                'nrc number': 'nrc',
                'tpin': 'tpin',
                'tpin number': 'tpin',
                'nhima': 'nhima',
                'nhima number': 'nhima',
                'napsa number': 'napsa_number',
                'napsa_number': 'napsa_number',
                'napsa': 'napsa_number',
                's/s number': 'sss_number',
                'sss number': 'sss_number',
                'sss_number': 'sss_number',
                'ss number': 'sss_number',
                # Contact
                'phone': 'phone',
                'phone number': 'phone',
                'contact details': 'phone',
                'mobile': 'phone',
                'email': 'email',
                'email address': 'email',
                'house address': 'house_address',
                'address': 'house_address',
                'residential address': 'house_address',
                # Other
                'nationality': 'nationality',
                'point of hire': 'point_of_hire',
                'employment type': 'employment_type',
            }

            # Normalize column names
            df.columns = df.columns.str.strip().str.lower()
            df.rename(columns=column_mapping, inplace=True)

            created = 0
            updated = 0
            errors = []

            workspace = self._resolve_workspace(request)
            if not workspace:
                return Response({'error': 'Workspace is required for employee import.'}, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                for idx, row in df.iterrows():
                    try:
                        # Skip rows with missing employee_id (header rows, etc)
                        emp_id = row.get('employee_id')
                        if pd.isna(emp_id) or str(emp_id).strip() == '':
                            continue
                        
                        emp_id_str = str(emp_id).strip()
                        
                        # Skip header-like rows
                        if emp_id_str.lower() in ['employee number', 'employee id', 's/no', '']:
                            continue

                        # Skip instruction/comment rows (rows where employee_id starts with #)
                        if emp_id_str.startswith('#'):
                            continue

                        # Get first and last names
                        first_name = str(row.get('first_name', '')).strip()
                        last_name = str(row.get('last_name', '')).strip()
                        
                        # If Full Name is provided but First/Last names are empty, split it
                        if (not first_name or not last_name) and pd.notna(row.get('full_name')):
                            full_name = str(row.get('full_name', '')).strip()
                            if full_name and ' ' in full_name:
                                parts = full_name.rsplit(' ', 1)  # Split on last space
                                first_name = first_name or parts[0]
                                last_name = last_name or parts[1]
                            elif full_name:
                                first_name = first_name or full_name
                                last_name = last_name or 'Employee'

                        # Build employee data
                        employee_data = {
                            'employee_id': emp_id_str,
                            'first_name': first_name or 'Unknown',
                            'last_name': last_name or 'Employee',

                            'job_title': str(row.get('job_title', '')).strip() or 'Not Specified',
                            'nrc': str(row.get('nrc', '')).strip() or f"NRC-{row.get('employee_id', idx)}",
                            'email': str(row.get('email', '')).strip() or f"employee{row.get('employee_id', idx)}@company.com",
                            'phone': str(row.get('phone', '')).strip() or '0000000000',
                            'house_address': str(row.get('house_address', '')).strip() or 'N/A',
                            'gender': 'OTHER',  # Default gender
                            'date_of_birth': pd.to_datetime('1990-01-01').date(),  # Default DOB
                            'hire_date': date.today(),  # Default hire date; overridden below if provided
                        }

                        # Optional fields - override defaults if provided
                        if pd.notna(row.get('hire_date')):
                            employee_data['hire_date'] = pd.to_datetime(row['hire_date']).date()
                        
                        if pd.notna(row.get('date_of_birth')):
                            employee_data['date_of_birth'] = pd.to_datetime(row['date_of_birth']).date()
                        
                        if pd.notna(row.get('gender')):
                            gender = str(row['gender']).strip().upper()
                            if gender in ['M', 'MALE']:
                                employee_data['gender'] = 'M'
                            elif gender in ['F', 'FEMALE']:
                                employee_data['gender'] = 'F'
                            else:
                                employee_data['gender'] = 'OTHER'

                        if pd.notna(row.get('tpin')):
                            employee_data['tpin'] = str(row['tpin']).strip()
                        
                        if pd.notna(row.get('nhima')):
                            employee_data['nhima'] = str(row['nhima']).strip()
                        
                        if pd.notna(row.get('sss_number')):
                            employee_data['sss_number'] = str(row['sss_number']).strip()
                        
                        if pd.notna(row.get('point_of_hire')):
                            employee_data['point_of_hire'] = str(row['point_of_hire']).strip()

                        if pd.notna(row.get('napsa_number')):
                            employee_data['napsa_number'] = str(row['napsa_number']).strip()

                        if pd.notna(row.get('nationality')):
                            employee_data['nationality'] = str(row['nationality']).strip()

                        # Handle employment type - normalize and use valid choices
                        # Valid EmploymentType choices: DIRECT, CONTRACTOR, CONSULTANT, TEMPORARY
                        if pd.notna(row.get('employment_type')):
                            raw_type = str(row['employment_type']).strip().upper()
                        else:
                            raw_type = ''

                        mapping = {
                            'DIRECT': 'DIRECT',
                            'EMPLOYEE': 'DIRECT',
                            'PERMANENT': 'DIRECT',  # Map common synonym to DIRECT employee
                            'CONTRACTOR': 'CONTRACTOR',
                            'CONTRACT': 'CONTRACTOR',
                            'CONSULTANT': 'CONSULTANT',
                            'TEMP': 'TEMPORARY',
                            'TEMPORARY': 'TEMPORARY',
                        }
                        emp_type_name = mapping.get(raw_type, 'DIRECT')

                        emp_type, _ = EmploymentType.objects.get_or_create(name=emp_type_name)
                        employee_data['employment_type'] = emp_type

                        # Always assign workspace to avoid orphan employees
                        employee_data['workspace'] = workspace

                        existing = Employee.objects.filter(employee_id=employee_data['employee_id']).first()
                        if existing and existing.workspace and existing.workspace != workspace:
                            raise ValueError('Employee ID belongs to a different workspace')

                        # Update or create
                        _, created_flag = Employee.objects.update_or_create(
                            employee_id=employee_data['employee_id'],
                            defaults=employee_data
                        )

                        if created_flag:
                            created += 1
                        else:
                            updated += 1

                    except Exception as e:
                        errors.append(f"Row {idx}: {str(e)}")

            return Response({
                'success': True,
                'created': created,
                'updated': updated,
                'errors': errors,
                'total_processed': created + updated
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({'error': f'Import failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ContractViewSet(viewsets.ModelViewSet):
    """ViewSet for employee contracts."""
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = Contract.objects.select_related('employee', 'contract_type').all()
    serializer_class = ContractSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = ContractFilter
    ordering_fields = ['start_date', 'end_date', 'created_at']
    ordering = ['-created_at']

    def get_queryset(self):
        today = timezone.now().date()

        # Bulk-sync: mark ACTIVE contracts whose end_date has passed
        Contract.objects.filter(status='ACTIVE', end_date__lt=today).update(status='EXPIRED')

        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        return qs


class EngagementViewSet(viewsets.ModelViewSet):
    """ViewSet for employee engagements."""
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = Engagement.objects.select_related('employee', 'employee__department', 'contract_type').all()
    serializer_class = EngagementSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['employee']
    ordering_fields = ['engagement_date', 'created_at']
    ordering = ['-engagement_date']

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        return qs


class TerminationViewSet(viewsets.ModelViewSet):
    """ViewSet for employee terminations."""
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = Termination.objects.select_related('employee', 'employee__department', 'termination_reason').all()
    serializer_class = TerminationSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['employee', 'termination_reason']
    ordering_fields = ['termination_date', 'created_at']
    ordering = ['-termination_date']

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        return qs

    # Employee status update is handled by the post_save signal on Termination model.


class ContractTypeViewSet(viewsets.ModelViewSet):
    """Lookup ViewSet for contract types."""
    queryset = ContractType.objects.all().order_by('name')
    serializer_class = ContractTypeSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['name']


class TerminationReasonViewSet(viewsets.ModelViewSet):
    """Lookup ViewSet for termination reasons."""
    queryset = TerminationReason.objects.all().order_by('name')
    serializer_class = TerminationReasonSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['name']


class DepartmentViewSet(viewsets.ModelViewSet):
    """ViewSet for departments."""
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = Department.objects.select_related('manager').prefetch_related('jobs').all()
    serializer_class = DepartmentSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        qs = super().get_queryset()
        # Filter departments by workspace FK
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(workspace=self.request.workspace)
        return qs

    def perform_create(self, serializer):
        if hasattr(self.request, 'workspace') and self.request.workspace:
            serializer.save(workspace=self.request.workspace)
        else:
            serializer.save()

    def perform_update(self, serializer):
        serializer.save()


class JobViewSet(viewsets.ModelViewSet):
    """ViewSet for department job titles."""
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = Job.objects.select_related('department').all()
    serializer_class = JobSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['department', 'is_active']
    search_fields = ['title', 'department__name']
    ordering_fields = ['title', 'created_at']
    ordering = ['title']

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(department__workspace=self.request.workspace)
        return qs

    def perform_create(self, serializer):
        department = serializer.validated_data.get('department')
        if hasattr(self.request, 'workspace') and self.request.workspace:
            if department and department.workspace_id != self.request.workspace_id:
                raise ValidationError({'department': 'Department is not in your active workspace.'})
        serializer.save()

    def perform_update(self, serializer):
        department = serializer.validated_data.get('department', getattr(serializer.instance, 'department', None))
        if hasattr(self.request, 'workspace') and self.request.workspace:
            if department and department.workspace_id != self.request.workspace_id:
                raise ValidationError({'department': 'Department is not in your active workspace.'})
        serializer.save()


class EmploymentTypeViewSet(viewsets.ModelViewSet):
    """Lookup ViewSet for employment types."""
    queryset = EmploymentType.objects.all().order_by('name')
    serializer_class = EmploymentTypeSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['name']


class EmployeeCategoryViewSet(viewsets.ModelViewSet):
    """Lookup ViewSet for employee categories."""
    queryset = EmployeeCategory.objects.all().order_by('name')
    serializer_class = EmployeeCategorySerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['name']


class EmployeeDocumentViewSet(viewsets.ModelViewSet):
    """Employee document uploads."""
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = EmployeeDocument.objects.select_related('employee').all()
    serializer_class = EmployeeDocumentSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['employee']
    ordering_fields = ['uploaded_at']
    ordering = ['-uploaded_at']

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        return qs


class EmployeeBeneficiaryViewSet(viewsets.ModelViewSet):
    """Persistent employee beneficiaries."""
    if TYPE_CHECKING:
        request: WorkspaceRequest

    queryset = EmployeeBeneficiary.objects.select_related('employee').all()
    serializer_class = EmployeeBeneficiarySerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['employee']
    ordering_fields = ['created_at', 'name']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        return qs

    def perform_create(self, serializer):
        employee = serializer.validated_data.get('employee')
        if not employee:
            raise ValidationError({'employee': 'Employee is required.'})

        if hasattr(self.request, 'workspace') and self.request.workspace:
            if employee.workspace_id != self.request.workspace_id:
                raise ValidationError({'employee': 'Employee is not in your active workspace.'})

        serializer.save()
