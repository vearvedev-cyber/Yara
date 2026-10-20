from decimal import Decimal
from typing import Any, cast

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.hcm.models import Contract, Employee

from .gratuity import calculate_contract_gratuity
from .models import FinalSettlement, PriorRedundancyPayment, SettlementLine
from .settlement import (
    DEDUCTION_KINDS, EARNING_KINDS, MANUAL_DEDUCTION_KINDS, MANUAL_EARNING_KINDS, SettlementError,
    add_manual_line, approve_settlement, calculate_settlement, cancel_settlement, mark_settlement_paid,
    remove_manual_line, set_line_tax,
)
from .settlement_pdf import generate_settlement_pdf


def _user_name(user):
    return (user.get_full_name() or user.username) if user else None


class SettlementLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SettlementLine
        fields = ['id', 'line_no', 'kind', 'category', 'description', 'basis', 'amount', 'is_manual',
                  'reason', 'paye', 'napsa', 'nhima', 'data']


class FinalSettlementSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    department = serializers.SerializerMethodField()
    hire_date = serializers.DateField(source='employee.hire_date', read_only=True)
    termination_reason = serializers.SerializerMethodField()
    contract_number = serializers.CharField(source='contract.contract_number', read_only=True, default=None)
    prepared_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    paid_by_name = serializers.SerializerMethodField()
    lines = SettlementLineSerializer(many=True, read_only=True)

    class Meta:
        model = FinalSettlement
        fields = [
            'id', 'employee', 'employee_name', 'employee_code', 'department', 'hire_date', 'kind',
            'termination', 'termination_reason', 'contract', 'contract_number', 'last_working_day', 'status',
            'payee_name', 'notes', 'total_earnings', 'total_deductions', 'net_payable', 'calculated_at',
            'calculation_notes', 'prepared_by_name', 'approved_by_name', 'approved_at', 'paid_by_name',
            'paid_at', 'payment_reference', 'created_at', 'lines',
        ]
        read_only_fields = [f for f in fields if f not in ('payee_name', 'notes', 'last_working_day')]

    def get_department(self, obj):
        return obj.employee.department.name if obj.employee.department else ''

    def get_termination_reason(self, obj):
        return getattr(getattr(obj.termination, 'termination_reason', None), 'name', '')

    def get_prepared_by_name(self, obj):
        return _user_name(obj.prepared_by)

    def get_approved_by_name(self, obj):
        return _user_name(obj.approved_by)

    def get_paid_by_name(self, obj):
        return _user_name(obj.paid_by)


class FinalSettlementListSerializer(FinalSettlementSerializer):
    class Meta(FinalSettlementSerializer.Meta):
        fields = [f for f in FinalSettlementSerializer.Meta.fields if f not in ('lines', 'calculation_notes')]


class CreateSettlementSerializer(serializers.Serializer):
    employee = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=FinalSettlement.Kind.choices, default=FinalSettlement.Kind.EXIT)
    contract = serializers.IntegerField(required=False, allow_null=True)
    last_working_day = serializers.DateField(required=False)
    payee_name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    notes = serializers.CharField(required=False, allow_blank=True)


class ManualLineSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=sorted(MANUAL_EARNING_KINDS | MANUAL_DEDUCTION_KINDS))
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    reason = serializers.CharField(max_length=255)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    paye = serializers.BooleanField(required=False)
    napsa = serializers.BooleanField(required=False)
    nhima = serializers.BooleanField(required=False)


class FinalSettlementViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                             viewsets.GenericViewSet):
    """
    GET   /payroll/settlements/?status=&kind=&employee=
    POST  /payroll/settlements/                      {employee, kind, contract?, last_working_day?, payee_name?}
    PATCH /payroll/settlements/{id}/                 payee_name, notes, last_working_day (draft)
    POST  /payroll/settlements/{id}/recalculate/
    POST  /payroll/settlements/{id}/lines/           manual line {kind, amount, reason, description?, paye?, napsa?, nhima?}
    DELETE /payroll/settlements/{id}/lines/{line}/
    POST  /payroll/settlements/{id}/approve/         staff, not the preparer
    POST  /payroll/settlements/{id}/mark-paid/       staff {reference, paid_on?}
    POST  /payroll/settlements/{id}/cancel/          draft only
    GET   /payroll/settlements/{id}/pdf/
    GET   /payroll/settlements/line-kinds/
    """
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def _workspace(self):
        workspace = getattr(self.request, 'workspace', None)
        if workspace is None:
            raise ValidationError({'error': 'Select a workspace first'})
        return workspace

    def get_queryset(self):
        qs = (FinalSettlement.objects.filter(employee__workspace=self._workspace())
              .select_related('employee', 'employee__department', 'termination__termination_reason', 'contract',
                              'prepared_by', 'approved_by', 'paid_by'))
        params = cast(Request, self.request).query_params
        for field in ('status', 'kind', 'employee'):
            if params.get(field):
                qs = qs.filter(**{field: params[field]})
        if self.action == 'retrieve':
            qs = qs.prefetch_related('lines')
        return qs

    def get_serializer_class(self):
        return FinalSettlementListSerializer if self.action == 'list' else FinalSettlementSerializer

    def _fail(self, exc):
        raise ValidationError({'error': str(exc)})

    def _detail(self, settlement):
        settlement = self.get_queryset().prefetch_related('lines').get(pk=settlement.pk)
        return Response(FinalSettlementSerializer(settlement).data)

    def _ensure_staff(self):
        if not self.request.user.is_staff:
            raise PermissionDenied('Only staff can approve or pay settlements')

    def create(self, request):
        workspace = self._workspace()
        serializer = CreateSettlementSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        employee = get_object_or_404(Employee, pk=data['employee'], workspace=workspace)
        contract = None
        termination = None
        if data.get('contract'):
            contract = get_object_or_404(Contract, pk=data['contract'], employee=employee)

        if data['kind'] == FinalSettlement.Kind.EXIT:
            termination = getattr(employee, 'termination', None)
            if termination is None:
                raise ValidationError({'error': 'Record the termination first (HCM → Engagements & Terminations)'})
            last_day = data.get('last_working_day') or termination.termination_date
        else:
            if contract is None:
                raise ValidationError({'contract': 'Choose the contract that ended'})
            if getattr(employee, 'termination', None) is not None:
                raise ValidationError({'error': 'The employee has left; their gratuity is paid in the final settlement'})
            result = calculate_contract_gratuity(contract)
            if not result.eligible:
                raise ValidationError({'contract': result.reason})
            if not contract.end_date or contract.end_date > timezone.localdate():
                raise ValidationError({'contract': 'The contract has not ended yet'})
            last_day = contract.end_date

        try:
            with transaction.atomic():
                settlement = FinalSettlement.objects.create(
                    workspace=workspace, employee=employee, kind=data['kind'], termination=termination,
                    contract=contract, last_working_day=last_day, payee_name=data.get('payee_name', ''),
                    notes=data.get('notes', ''), prepared_by=request.user,
                )
        except IntegrityError:
            raise ValidationError({'error': 'There is already an open settlement for this employee or contract'})
        calculate_settlement(settlement)
        return Response(self._detail(settlement).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        if serializer.instance.status != FinalSettlement.Status.DRAFT:
            raise ValidationError({'error': 'Only draft settlements can be changed'})
        settlement = serializer.save()
        calculate_settlement(settlement)

    def update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        super().update(request, *args, **kwargs)
        return self._detail(self.get_object())

    @action(detail=True, methods=['post'])
    def recalculate(self, request, pk=None):
        try:
            calculate_settlement(self.get_object())
        except SettlementError as exc:
            self._fail(exc)
        return self._detail(self.get_object())

    @action(detail=True, methods=['post'], url_path='lines')
    def add_line(self, request, pk=None):
        settlement = self.get_object()
        serializer = ManualLineSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        tax = None
        if data['kind'] in MANUAL_EARNING_KINDS and any(k in data for k in ('paye', 'napsa', 'nhima')):
            tax = (data.get('paye', False), data.get('napsa', False), data.get('nhima', False))
        try:
            add_manual_line(settlement, data['kind'], data['amount'], data['reason'],
                            data.get('description', ''), tax)
        except SettlementError as exc:
            self._fail(exc)
        return Response(self._detail(settlement).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete', 'patch'], url_path=r'lines/(?P<line_id>\d+)')
    def line(self, request, pk=None, line_id=None):
        settlement = self.get_object()
        line = get_object_or_404(SettlementLine, pk=line_id, settlement=settlement)
        try:
            if request.method == 'DELETE':
                remove_manual_line(settlement, line)
            else:
                set_line_tax(settlement, line, bool(request.data.get('paye')), bool(request.data.get('napsa')),
                             bool(request.data.get('nhima')))
        except SettlementError as exc:
            self._fail(exc)
        return self._detail(settlement)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        self._ensure_staff()
        try:
            settlement = approve_settlement(self.get_object(), request.user)
        except SettlementError as exc:
            self._fail(exc)
        return self._detail(settlement)

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        self._ensure_staff()
        paid_on = request.data.get('paid_on')
        try:
            paid_on = serializers.DateField().to_internal_value(paid_on) if paid_on else None
            settlement = mark_settlement_paid(self.get_object(), request.user,
                                              reference=str(request.data.get('reference', '')), paid_on=paid_on)
        except SettlementError as exc:
            self._fail(exc)
        return self._detail(settlement)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        try:
            settlement = cancel_settlement(self.get_object())
        except SettlementError as exc:
            self._fail(exc)
        return self._detail(settlement)

    @action(detail=True, methods=['get'])
    def pdf(self, request, pk=None):
        settlement = self.get_object()
        response = HttpResponse(generate_settlement_pdf(settlement), content_type='application/pdf')
        name = f"settlement_{settlement.employee.employee_id}_{settlement.last_working_day}.pdf"
        response['Content-Disposition'] = f'attachment; filename="{name}"'
        return response

    @action(detail=False, methods=['get'], url_path='line-kinds')
    def line_kinds(self, request):
        return Response({
            'manual_earnings': [{'value': k, 'label': EARNING_KINDS[k]} for k in sorted(MANUAL_EARNING_KINDS)],
            'manual_deductions': [{'value': k, 'label': DEDUCTION_KINDS[k]} for k in sorted(MANUAL_DEDUCTION_KINDS)],
        })


class PriorRedundancyPaymentSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = PriorRedundancyPayment
        fields = ['id', 'employee', 'employee_name', 'employee_code', 'amount', 'paid_on',
                  'employer_name', 'note', 'created_at']
        read_only_fields = ['id', 'created_at']


class PriorRedundancyPaymentViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin,
                                    viewsets.GenericViewSet):
    """
    Redundancy pay received before go-live or from other employers; counts against the
    lifetime PAYE-free redundancy limit.
    GET /payroll/prior-redundancy/?employee=   POST {employee, amount, paid_on, employer_name, note}
    DELETE /payroll/prior-redundancy/{id}/
    """
    serializer_class = PriorRedundancyPaymentSerializer
    permission_classes = [IsAuthenticated]

    def _workspace(self):
        workspace = getattr(self.request, 'workspace', None)
        if workspace is None:
            raise ValidationError({'error': 'Select a workspace first'})
        return workspace

    def get_queryset(self):
        qs = PriorRedundancyPayment.objects.filter(employee__workspace=self._workspace()).select_related('employee')
        employee = cast(Request, self.request).query_params.get('employee')
        if employee:
            qs = qs.filter(employee_id=employee)
        return qs

    def perform_create(self, serializer):
        if not self.request.user.is_staff:
            raise PermissionDenied('Only staff can record previous redundancy payments')
        workspace = self._workspace()
        employee = cast(dict[str, Any], serializer.validated_data)['employee']
        if employee.workspace_id != workspace.pk:
            raise ValidationError({'employee': 'Employee belongs to another workspace'})
        serializer.save(workspace=workspace, created_by=self.request.user)

    def perform_destroy(self, instance):
        if not self.request.user.is_staff:
            raise PermissionDenied('Only staff can remove previous redundancy payments')
        instance.delete()
