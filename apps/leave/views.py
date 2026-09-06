from django.db.models import Count, Sum, Q, F, Value, CharField
from django.db.models.functions import Concat
from django.utils import timezone
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .models import LeaveRequest, SickNote, Absenteeism, DoubleTicketRequest
from .serializers import (
    LeaveRequestSerializer, 
    LeaveSummarySerializer, 
    SickNoteSerializer, 
    AbsenteeismSerializer,
    DoubleTicketRequestSerializer
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

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def approve(self, request, pk=None):
        self._ensure_manager(request)
        leave = self.get_object()
        leave.status = LeaveRequest.Status.APPROVED
        leave.approved_by = request.user
        leave.save(update_fields=["status", "approved_by", "updated_at", "days"])  # days recalculated in save
        return Response(self.get_serializer(leave).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def reject(self, request, pk=None):
        self._ensure_manager(request)
        leave = self.get_object()
        leave.status = LeaveRequest.Status.REJECTED
        leave.approved_by = request.user
        leave.save(update_fields=["status", "approved_by", "updated_at", "days"])  # days recalculated in save
        return Response(self.get_serializer(leave).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def cancel(self, request, pk=None):
        self._ensure_manager(request)
        leave = self.get_object()
        leave.status = LeaveRequest.Status.CANCELLED
        leave.save(update_fields=["status", "updated_at", "days"])  # days recalculated in save
        return Response(self.get_serializer(leave).data)


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

