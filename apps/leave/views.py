from decimal import Decimal
from typing import Any, cast

from django.db import transaction
from django.db.models import Count, Sum, Q, F, Value, CharField
from django.db.models.functions import Concat
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from apps.hcm.models import Employee
from .balances import (
    ZERO, InsufficientLeaveBalance, adjust_balance, check_can_approve, current_month_accrual,
    ensure_workspace_accruals, get_balance, get_policy, sync_leave_request, working_days_for_request,
)
from .models import LeaveRequest, SickNote, Absenteeism, DoubleTicketRequest, LeavePolicy, LeaveLedgerEntry
from .serializers import (
    LeaveRequestSerializer,
    LeaveSummarySerializer,
    SickNoteSerializer,
    AbsenteeismSerializer,
    DoubleTicketRequestSerializer,
    LeaveAdjustmentSerializer,
    LeaveBalanceSerializer,
    LeaveLedgerEntrySerializer,
    LeavePolicySerializer,
)


class LeaveRequestViewSet(viewsets.ModelViewSet):
    queryset = LeaveRequest.objects.select_related("employee", "approved_by")
    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["employee__first_name", "employee__last_name", "employee__employee_number", "leave_type", "status"]
    ordering_fields = ["created_at", "start_date", "end_date", "status"]
    ordering = ["-created_at"]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        employee_id = self.request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def _ensure_manager(self, request):
        if not request.user or not request.user.is_staff:
            raise PermissionDenied("Only staff can approve or reject requests")

    def perform_create(self, serializer):
        # Applicants create leave; approver set later when status transitions
        serializer.save()

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated], url_path="choices")
    def choices(self, request):
        return Response([
            {"label": label, "value": value}
            for value, label in LeaveRequest.LeaveType.choices
        ])

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def summary(self, request):
        employee_id = request.query_params.get("employee")
        qs = self.get_queryset()
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        summary = (
            qs.values(emp=F("employee_id"))
            .annotate(
                name=Concat(F("employee__first_name"), Value(" "), F("employee__last_name"), output_field=CharField()),
                total_requests=Count("id"),
                pending=Count("id", filter=Q(status=LeaveRequest.Status.PENDING)),
                approved=Count("id", filter=Q(status=LeaveRequest.Status.APPROVED)),
                rejected=Count("id", filter=Q(status=LeaveRequest.Status.REJECTED)),
                cancelled=Count("id", filter=Q(status=LeaveRequest.Status.CANCELLED)),
                total_days=Sum("days"),
                sick_days=Sum("days", filter=Q(leave_type=LeaveRequest.LeaveType.SICK)),
                annual_days=Sum("days", filter=Q(leave_type=LeaveRequest.LeaveType.ANNUAL)),
            )
        )

        data = [
            {
                "employee": row["emp"],
                "employee_name": row["name"],
                "total_requests": row["total_requests"] or 0,
                "pending": row["pending"] or 0,
                "approved": row["approved"] or 0,
                "rejected": row["rejected"] or 0,
                "cancelled": row["cancelled"] or 0,
                "total_days": row["total_days"] or 0,
                "sick_days": row["sick_days"] or 0,
                "annual_days": row["annual_days"] or 0,
            }
            for row in summary
        ]

        serializer = LeaveSummarySerializer(data, many=True)
        return Response(serializer.data)

    def perform_update(self, serializer):
        with transaction.atomic():
            leave = serializer.save()
            sync_leave_request(leave, actor=self.request.user)  # dates of an approved request changed

    def perform_destroy(self, instance):
        with transaction.atomic():
            sync_leave_request(instance, actor=self.request.user, deleted=True)
            instance.delete()

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def approve(self, request, pk=None):
        self._ensure_manager(request)
        leave = self.get_object()
        with transaction.atomic():
            try:
                check_can_approve(leave)
            except InsufficientLeaveBalance as exc:
                return Response(
                    {"error": str(exc), "available": exc.available, "requested": exc.requested},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            leave.status = LeaveRequest.Status.APPROVED
            leave.approved_by = request.user
            leave.save(update_fields=["status", "approved_by", "updated_at", "days"])  # days recalculated in save
            sync_leave_request(leave, actor=request.user)
        return Response(self.get_serializer(leave).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def reject(self, request, pk=None):
        self._ensure_manager(request)
        leave = self.get_object()
        with transaction.atomic():
            leave.status = LeaveRequest.Status.REJECTED
            leave.approved_by = request.user
            leave.save(update_fields=["status", "approved_by", "updated_at", "days"])  # days recalculated in save
            sync_leave_request(leave, actor=request.user)
        return Response(self.get_serializer(leave).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def cancel(self, request, pk=None):
        self._ensure_manager(request)
        leave = self.get_object()
        with transaction.atomic():
            leave.status = LeaveRequest.Status.CANCELLED
            leave.save(update_fields=["status", "updated_at", "days"])  # days recalculated in save
            sync_leave_request(leave, actor=request.user)
        return Response(self.get_serializer(leave).data)

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated], url_path="working-days")
    def working_days(self, request):
        """Preview for the request form: working days in a range and the balance after it."""
        serializer = self.get_serializer(data={
            "employee": request.query_params.get("employee"),
            "leave_type": request.query_params.get("leave_type", LeaveRequest.LeaveType.ANNUAL),
            "start_date": request.query_params.get("start_date"),
            "end_date": request.query_params.get("end_date"),
        })
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        employee = data["employee"]
        workspace = getattr(request, "workspace", None)
        if workspace and employee.workspace_id != workspace.pk:
            raise PermissionDenied("Employee belongs to another workspace")
        probe = LeaveRequest(employee=employee, leave_type=data["leave_type"],
                             start_date=data["start_date"], end_date=data["end_date"])
        probe.recalc_days()
        balance = get_balance(employee, data["leave_type"])
        return Response(_days_as_strings({
            "days": probe.days,
            "counts_working_days": working_days_for_request(probe) is not None,
            "available": balance["available"] if balance else None,
            "available_after": (balance["available"] - probe.days) if balance else None,
        }))


class SickNoteViewSet(viewsets.ModelViewSet):
    queryset = SickNote.objects.select_related("employee", "issued_by")
    serializer_class = SickNoteSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["employee__first_name", "employee__last_name", "employee__employee_id", "status", "diagnosis"]
    ordering_fields = ["created_at", "start_date", "end_date", "status"]
    ordering = ["-created_at"]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        employee_id = self.request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def _ensure_manager(self, request):
        if not request.user or not request.user.is_staff:
            raise PermissionDenied("Only staff can approve or reject sick notes")

    def perform_create(self, serializer):
        serializer.save(issued_by=self.request.user if self.request and self.request.user.is_authenticated else None)

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def summary(self, request):
        employee_id = request.query_params.get("employee")
        qs = self.get_queryset()
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        summary = (
            qs.values(emp=F("employee_id"))
            .annotate(
                name=Concat(F("employee__first_name"), Value(" "), F("employee__last_name"), output_field=CharField()),
                total_notes=Count("id"),
                pending=Count("id", filter=Q(status=SickNote.Status.PENDING)),
                approved=Count("id", filter=Q(status=SickNote.Status.APPROVED)),
                rejected=Count("id", filter=Q(status=SickNote.Status.REJECTED)),
                total_days=Sum("days"),
            )
        )

        data = [
            {
                "employee": row["emp"],
                "employee_name": row["name"],
                "total_notes": row["total_notes"] or 0,
                "pending": row["pending"] or 0,
                "approved": row["approved"] or 0,
                "rejected": row["rejected"] or 0,
                "total_days": row["total_days"] or 0,
            }
            for row in summary
        ]

        return Response(data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def approve(self, request, pk=None):
        self._ensure_manager(request)
        note = self.get_object()
        note.status = SickNote.Status.APPROVED
        note.save(update_fields=["status", "updated_at", "days"])  # days recalculated in save
        return Response(self.get_serializer(note).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def reject(self, request, pk=None):
        self._ensure_manager(request)
        note = self.get_object()
        note.status = SickNote.Status.REJECTED
        note.save(update_fields=["status", "updated_at", "days"])  # days recalculated in save
        return Response(self.get_serializer(note).data)


class AbsenteeismViewSet(viewsets.ModelViewSet):
    queryset = Absenteeism.objects.select_related("employee", "reported_by")
    serializer_class = AbsenteeismSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["employee__first_name", "employee__last_name", "employee__employee_id", "status"]
    ordering_fields = ["created_at", "date", "status"]
    ordering = ["-date"]
    filterset_fields = ["employee", "status", "date"]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = super().get_queryset()
        # Filter by workspace through employee relationship
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        return qs

    def perform_create(self, serializer):
        serializer.save(reported_by=self.request.user if self.request and self.request.user.is_authenticated else None)


class DoubleTicketRequestViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Double Ticket requests (Sunday/Holiday work)
    Zambian Employment Code Act: Work on rest days = double pay
    """
    queryset = DoubleTicketRequest.objects.select_related("employee", "approved_by")
    serializer_class = DoubleTicketRequestSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["employee__first_name", "employee__last_name", "employee__employee_id", "status"]
    ordering_fields = ["created_at", "work_date", "status"]
    ordering = ["-work_date", "-created_at"]
    filterset_fields = ["employee", "status", "work_date"]

    def get_queryset(self):
        qs = super().get_queryset()
        # Filter by workspace through employee
        if hasattr(self.request, 'workspace') and self.request.workspace:
            qs = qs.filter(employee__workspace=self.request.workspace)
        return qs

    def _ensure_manager(self, request):
        if not request.user or not request.user.is_staff:
            raise PermissionDenied("Only staff can approve or reject double ticket requests")

    def perform_create(self, serializer):
        """Create double ticket request"""
        serializer.save()

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def approve(self, request, pk=None):
        """Approve double ticket request and calculate payment"""
        self._ensure_manager(request)
        ticket = self.get_object()
        
        if ticket.status == DoubleTicketRequest.Status.APPROVED:
            return Response(
                {"error": "Double ticket request already approved"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Calculate and store payment amount
        calculated_amount = ticket.calculate_payment()
        
        ticket.status = DoubleTicketRequest.Status.APPROVED
        ticket.approved_by = request.user
        ticket.approved_at = timezone.now()
        ticket.calculated_amount = calculated_amount
        ticket.save(update_fields=["status", "approved_by", "approved_at", "calculated_amount", "updated_at"])
        
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def reject(self, request, pk=None):
        """Reject double ticket request"""
        self._ensure_manager(request)
        ticket = self.get_object()
        
        ticket.status = DoubleTicketRequest.Status.REJECTED
        ticket.approved_by = request.user
        ticket.approved_at = timezone.now()
        ticket.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        
        return Response(self.get_serializer(ticket).data)

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def summary(self, request):
        """Summary of double ticket requests by employee"""
        employee_id = request.query_params.get("employee")
        qs = self.get_queryset()
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        summary = (
            qs.values(emp=F("employee_id"))
            .annotate(
                name=Concat(F("employee__first_name"), Value(" "), F("employee__last_name"), output_field=CharField()),
                total_requests=Count("id"),
                pending=Count("id", filter=Q(status=DoubleTicketRequest.Status.PENDING)),
                approved=Count("id", filter=Q(status=DoubleTicketRequest.Status.APPROVED)),
                rejected=Count("id", filter=Q(status=DoubleTicketRequest.Status.REJECTED)),
                paid=Count("id", filter=Q(status=DoubleTicketRequest.Status.PAID)),
                total_hours=Sum("hours_worked"),
                total_amount=Sum("calculated_amount", filter=Q(status=DoubleTicketRequest.Status.APPROVED)),
            )
        )

        data = [
            {
                "employee": row["emp"],
                "employee_name": row["name"],
                "total_requests": row["total_requests"] or 0,
                "pending": row["pending"] or 0,
                "approved": row["approved"] or 0,
                "rejected": row["rejected"] or 0,
                "paid": row["paid"] or 0,
                "total_hours": float(row["total_hours"]) if row["total_hours"] else 0,
                "total_amount": float(row["total_amount"]) if row["total_amount"] else 0,
            }
            for row in summary
        ]

        return Response(data)



def _days_as_strings(data: dict) -> dict:
    """Render day amounts the way the serializers do ('3.00'), so every endpoint matches."""
    return {k: (f"{v:.2f}" if isinstance(v, Decimal) else v) for k, v in data.items()}


def _require_workspace(request):
    workspace = getattr(request, "workspace", None)
    if workspace is None:
        raise ValidationError({"error": "Select a workspace first"})
    return workspace


def _ensure_staff(request):
    if not request.user or not request.user.is_staff:
        raise PermissionDenied("Only staff can change leave balances or policies")


class LeaveBalanceViewSet(viewsets.ViewSet):
    """
    GET  /leave/balances/?leave_type=ANNUAL&search=&department=&include_terminated=1
    GET  /leave/balances/{employee_id}/?leave_type=ANNUAL     breakdown + ledger entries
    POST /leave/balances/{employee_id}/adjust/                {leave_type, days, note, date?}
    """
    permission_classes = [IsAuthenticated]

    def _leave_type(self, request):
        leave_type = request.query_params.get("leave_type", LeaveRequest.LeaveType.ANNUAL)
        if leave_type not in LeaveRequest.LeaveType.values:
            raise ValidationError({"leave_type": "Unknown leave type"})
        return leave_type

    def _employee(self, request, pk):
        workspace = _require_workspace(request)
        return get_object_or_404(
            Employee.objects.select_related("workspace", "department"), pk=pk, workspace=workspace
        )

    def list(self, request):
        workspace = _require_workspace(request)
        leave_type = self._leave_type(request)
        policy = get_policy(workspace, leave_type)
        if policy is None:
            return Response({"results": [], "policy": None})

        today = timezone.localdate()
        ensure_workspace_accruals(workspace, leave_type, today)

        employees = Employee.objects.filter(workspace=workspace, hire_date__isnull=False).select_related(
            "department", "termination"
        )
        if request.query_params.get("include_terminated") not in ("1", "true"):
            employees = employees.exclude(employment_status="TERMINATED")
        if request.query_params.get("department"):
            employees = employees.filter(department_id=request.query_params["department"])
        search = request.query_params.get("search")
        if search:
            employees = employees.filter(
                Q(first_name__icontains=search) | Q(last_name__icontains=search) | Q(employee_id__icontains=search)
            )

        totals = {}
        for row in (
            LeaveLedgerEntry.objects.filter(employee__in=employees, leave_type=leave_type)
            .values("employee_id", "kind").annotate(t=Sum("days"))
        ):
            totals.setdefault(row["employee_id"], {})[row["kind"]] = row["t"]

        Kind = LeaveLedgerEntry.Kind
        results = []
        for emp in employees.order_by("first_name", "last_name"):
            t = totals.get(emp.pk, {})
            balance = sum(t.values(), ZERO)
            this_month = current_month_accrual(emp, policy, today)
            results.append({
                "employee": emp.pk,
                "employee_name": emp.full_name,
                "employee_code": emp.employee_id,
                "department": emp.department.name if emp.department else "",
                "employment_status": emp.employment_status,
                "leave_type": leave_type,
                "opening": t.get(Kind.OPENING, ZERO),
                "accrued": t.get(Kind.ACCRUAL, ZERO),
                "taken": -t.get(Kind.TAKEN, ZERO),
                "adjustments": t.get(Kind.ADJUSTMENT, ZERO),
                "expired": -t.get(Kind.EXPIRY, ZERO),
                "paid_out": -t.get(Kind.PAID_OUT, ZERO),
                "balance": balance,
                "accruing_this_month": this_month,
                "available": balance + this_month,
            })
        return Response({
            "results": LeaveBalanceSerializer(results, many=True).data,
            "policy": LeavePolicySerializer(policy).data,
        })

    def retrieve(self, request, pk=None):
        employee = self._employee(request, pk)
        leave_type = self._leave_type(request)
        balance = get_balance(employee, leave_type)
        if balance is None:
            raise ValidationError({"leave_type": f"{leave_type} leave has no balance"})
        entries = LeaveLedgerEntry.objects.filter(employee=employee, leave_type=leave_type).select_related("created_by")
        return Response({
            **_days_as_strings(balance),
            "employee_name": employee.full_name,
            "employee_code": employee.employee_id,
            "hire_date": employee.hire_date,
            "entries": LeaveLedgerEntrySerializer(entries.order_by("-date", "-id"), many=True).data,
        })

    @action(detail=True, methods=["post"])
    def adjust(self, request, pk=None):
        _ensure_staff(request)
        employee = self._employee(request, pk)
        serializer = LeaveAdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        try:
            entry = adjust_balance(employee, data["leave_type"], data["days"], data["note"],
                                   actor=request.user, on=data.get("date"))
        except ValueError as exc:
            raise ValidationError({"error": str(exc)})
        return Response(LeaveLedgerEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class LeavePolicyViewSet(viewsets.ModelViewSet):
    """Leave entitlement rules for the current workspace. Writes are staff-only."""
    serializer_class = LeavePolicySerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        return LeavePolicy.objects.filter(workspace=_require_workspace(self.request))

    def perform_create(self, serializer):
        _ensure_staff(self.request)
        workspace = _require_workspace(self.request)
        if LeavePolicy.objects.filter(workspace=workspace, leave_type=cast(dict[str, Any], serializer.validated_data)["leave_type"]).exists():
            raise ValidationError({"leave_type": "A policy for this leave type already exists; edit it instead"})
        serializer.save(workspace=workspace)

    def perform_update(self, serializer):
        _ensure_staff(self.request)
        serializer.save()

    @action(detail=False, methods=["get"])
    def effective(self, request):
        """The policy in force for a leave type, including built-in defaults when none is saved."""
        workspace = _require_workspace(request)
        leave_type = request.query_params.get("leave_type", LeaveRequest.LeaveType.ANNUAL)
        policy = get_policy(workspace, leave_type)
        if policy is None:
            return Response({"leave_type": leave_type, "has_balance": False})
        return Response({**LeavePolicySerializer(policy).data, "has_balance": True, "is_default": policy.pk is None})
