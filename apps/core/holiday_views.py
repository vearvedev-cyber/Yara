from typing import Any, cast

from django.db.models import Q
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from .holidays import zambian_public_holidays
from .models import PublicHoliday


class PublicHolidaySerializer(serializers.ModelSerializer):
    is_national = serializers.SerializerMethodField()

    class Meta:
        model = PublicHoliday
        fields = ['id', 'date', 'name', 'is_national']
        read_only_fields = ['id', 'is_national']

    def get_is_national(self, obj):
        return obj.workspace_id is None


class PublicHolidayViewSet(viewsets.ModelViewSet):
    """
    National holidays (shared) plus the current workspace's own days off.
    Staff can add or remove workspace holidays; national ones are managed by
    superusers or the `seed` action.
    """
    serializer_class = PublicHolidaySerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        workspace = getattr(self.request, 'workspace', None)
        q = Q(workspace__isnull=True)
        if workspace is not None:
            q |= Q(workspace=workspace)
        qs = PublicHoliday.objects.filter(q)
        year = cast(Request, self.request).query_params.get('year')
        if year and year.isdigit():
            qs = qs.filter(date__year=int(year))
        return qs.order_by('date')

    def _ensure_staff(self):
        if not self.request.user.is_staff:
            raise PermissionDenied('Only staff can change public holidays')

    def perform_create(self, serializer):
        self._ensure_staff()
        workspace = getattr(self.request, 'workspace', None)
        if workspace is None:
            raise ValidationError({'error': 'Select a workspace first'})
        date = cast(dict[str, Any], serializer.validated_data)['date']
        if PublicHoliday.objects.filter(Q(workspace=workspace) | Q(workspace__isnull=True), date=date).exists():
            raise ValidationError({'date': 'There is already a holiday on this date'})
        serializer.save(workspace=workspace)

    def perform_destroy(self, instance):
        self._ensure_staff()
        if instance.workspace_id is None and not self.request.user.is_superuser:
            raise PermissionDenied('National holidays can only be removed by a superuser')
        instance.delete()

    @action(detail=False, methods=['post'])
    def seed(self, request):
        """Create the national Zambian holidays for a year (existing dates are kept)."""
        self._ensure_staff()
        try:
            year = int(request.data.get('year'))
        except (TypeError, ValueError):
            raise ValidationError({'year': 'A year is required'})
        if not 2000 <= year <= 2100:
            raise ValidationError({'year': 'Year out of range'})
        created = 0
        for day, name in zambian_public_holidays(year):
            _, was_created = PublicHoliday.objects.get_or_create(workspace=None, date=day, defaults={'name': name})
            created += int(was_created)
        return Response({'year': year, 'created': created}, status=status.HTTP_201_CREATED)
