from decimal import Decimal

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.hcm.models import Contract, ContractType

from .gratuity import calculate_contract_gratuity, get_gratuity_policy
from .models import GratuityPayment, GratuityPolicy


def _as_strings(data: dict) -> dict:
    return {k: (f"{v:.2f}" if isinstance(v, Decimal) else v) for k, v in data.items()}


def _workspace(request):
    workspace = getattr(request, 'workspace', None)
    if workspace is None:
        raise ValidationError({'error': 'Select a workspace first'})
    return workspace


class GratuityPolicySerializer(serializers.ModelSerializer):
    is_default = serializers.SerializerMethodField()

    class Meta:
        model = GratuityPolicy
        fields = ['rate_percent', 'eligible_contract_types', 'long_term_months',
                  'estimate_missing_months', 'is_default', 'updated_at']
        read_only_fields = ['is_default', 'updated_at']

    def get_is_default(self, obj):
        return obj.pk is None

    def validate_rate_percent(self, value):
        if value < Decimal('25'):
            raise serializers.ValidationError('The Employment Code Act minimum is 25% of basic pay')
        if value > Decimal('100'):
            raise serializers.ValidationError('Rate looks too high')
        return value

    def validate_eligible_contract_types(self, value):
        names = [n.strip() for n in value.split(',') if n.strip()]
        known = {name for name, _ in ContractType.TYPES}
        unknown = [n for n in names if n not in known]
        if not names or unknown:
            raise serializers.ValidationError(f'Unknown contract types: {", ".join(unknown) or "none given"}')
        return ','.join(names)


class GratuityPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = GratuityPayment
        fields = ['id', 'amount', 'paid_on', 'covers_to', 'source_type', 'source_id', 'note', 'created_at']


class GratuityViewSet(viewsets.ViewSet):
    """
    GET /payroll/gratuity/?status=ACCRUING|DUE|PAID&search=     fixed-duration contracts
    GET /payroll/gratuity/{contract_id}/                                    month-by-month breakdown
    GET|PUT /payroll/gratuity/policy/                                       workspace policy
    """
    permission_classes = [IsAuthenticated]

    def list(self, request):
        workspace = _workspace(request)
        policy = get_gratuity_policy(workspace)
        contracts = (Contract.objects
                     .filter(employee__workspace=workspace, contract_type__name__in=policy.contract_type_names)
                     .exclude(status='RENEWED', end_date__isnull=True)
                     .select_related('employee', 'employee__termination__termination_reason', 'contract_type'))
        search = request.query_params.get('search')
        if search:
            contracts = (contracts.filter(employee__first_name__icontains=search)
                         | contracts.filter(employee__last_name__icontains=search)
                         | contracts.filter(employee__employee_id__icontains=search)
                         | contracts.filter(contract_number__icontains=search))
        wanted = request.query_params.get('status')
        today = timezone.localdate()
        rows = []
        for contract in contracts.distinct().order_by('end_date'):
            result = calculate_contract_gratuity(contract, today, policy)
            if wanted and result.status != wanted:
                continue
            rows.append(_as_strings(result.as_dict()))
        return Response({'results': rows, 'policy': GratuityPolicySerializer(policy).data})

    def retrieve(self, request, pk=None):
        workspace = _workspace(request)
        contract = get_object_or_404(
            Contract.objects.select_related('employee', 'contract_type'), pk=pk, employee__workspace=workspace
        )
        result = calculate_contract_gratuity(contract)
        return Response({
            **_as_strings(result.as_dict()),
            'months': [
                _as_strings({
                    'year': m.year, 'month': m.month, 'days_covered': m.days_covered,
                    'days_in_month': m.days_in_month, 'basic_salary': m.basic_salary,
                    'unpaid_leave_days': m.unpaid_leave_days, 'unpaid_leave_reduction': m.unpaid_leave_reduction,
                    'basic_earned': m.basic_earned, 'source': m.source, 'payslip': m.payslip_id,
                })
                for m in result.months
            ],
            'payments': GratuityPaymentSerializer(contract.gratuity_payments.all(), many=True).data,
        })

    @action(detail=False, methods=['get', 'put'])
    def policy(self, request):
        workspace = _workspace(request)
        policy = get_gratuity_policy(workspace)
        if request.method == 'GET':
            return Response(GratuityPolicySerializer(policy).data)
        if not request.user.is_staff:
            raise PermissionDenied('Only staff can change the gratuity policy')
        serializer = GratuityPolicySerializer(policy if policy.pk else None, data=request.data, partial=bool(policy.pk))
        serializer.is_valid(raise_exception=True)
        saved = serializer.save(workspace=workspace)
        return Response(GratuityPolicySerializer(saved).data)
