from rest_framework import serializers
from .balances import working_days_for_request
from .models import (
    LeaveRequest, SickNote, Absenteeism, DoubleTicketRequest, LeavePolicy, LeaveLedgerEntry
)


def _absolutize_file_urls(data, request, fields):
    if not request:
        return data
    for field in fields:
        value = data.get(field)
        if isinstance(value, str) and value.startswith('/'):
            data[field] = request.build_absolute_uri(value)
    return data


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_id", read_only=True)

    class Meta:
        model = LeaveRequest
        fields = "__all__"
        # status changes only through the approve / reject / cancel actions
        read_only_fields = ["days", "status", "created_at", "updated_at", "approved_by"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and start > end:
            raise serializers.ValidationError("start_date cannot be after end_date")
        employee = attrs.get("employee", getattr(self.instance, "employee", None))
        leave_type = attrs.get("leave_type", getattr(self.instance, "leave_type", None))
        if employee and leave_type and start and end:
            probe = LeaveRequest(employee=employee, leave_type=leave_type, start_date=start, end_date=end)
            if working_days_for_request(probe) == 0:
                raise serializers.ValidationError(
                    "The selected dates contain no working days (weekends and public holidays don't count)"
                )
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user and not validated_data.get("approved_by"):
            # Applicants are the employee; approver set later
            pass
        return super().create(validated_data)

    def update(self, instance, validated_data):
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return _absolutize_file_urls(data, self.context.get('request'), ['doctor_note'])


class SickNoteSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_id", read_only=True)

    class Meta:
        model = SickNote
        fields = "__all__"
        read_only_fields = ["days", "created_at", "updated_at", "issued_by"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and start > end:
            raise serializers.ValidationError("start_date cannot be after end_date")
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return _absolutize_file_urls(data, self.context.get('request'), ['document'])


class LeaveSummarySerializer(serializers.Serializer):
    employee = serializers.IntegerField()
    employee_name = serializers.CharField()
    total_requests = serializers.IntegerField()
    pending = serializers.IntegerField()
    approved = serializers.IntegerField()
    rejected = serializers.IntegerField()
    cancelled = serializers.IntegerField()
    total_days = serializers.IntegerField()
    sick_days = serializers.IntegerField()
    annual_days = serializers.IntegerField()


class AbsenteeismSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_id", read_only=True)
    reported_by_name = serializers.CharField(source="reported_by.username", read_only=True)

    class Meta:
        model = Absenteeism
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at", "reported_by"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return _absolutize_file_urls(data, self.context.get('request'), ['supporting_document'])


class DoubleTicketRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_id", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.username", read_only=True)
    calculated_payment = serializers.SerializerMethodField()

    class Meta:
        model = DoubleTicketRequest
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at", "approved_by", "approved_at", "calculated_amount"]

    def get_calculated_payment(self, obj):
        """Return calculated double ticket payment"""
        return obj.calculate_payment()

    def validate_hours_worked(self, value):
        """Ensure hours worked is reasonable (0-24)"""
        if value <= 0 or value > 24:
            raise serializers.ValidationError("Hours worked must be between 0 and 24")
        return value



class LeavePolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = LeavePolicy
        fields = [
            "id", "leave_type", "days_per_month", "carry_forward_cap", "leave_year_start_month",
            "count_working_days", "working_weekdays", "allow_negative_balance", "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]

    def validate_leave_year_start_month(self, value):
        if not 1 <= value <= 12:
            raise serializers.ValidationError("Must be a month number from 1 to 12")
        return value

    def validate_working_weekdays(self, value):
        parts = [p.strip() for p in value.split(",") if p.strip()]
        if not parts or any(not p.isdigit() or int(p) > 6 for p in parts):
            raise serializers.ValidationError("Use weekday numbers 0 (Monday) to 6 (Sunday), comma-separated")
        return ",".join(sorted(set(parts), key=int))


class LeaveLedgerEntrySerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = LeaveLedgerEntry
        fields = [
            "id", "leave_type", "kind", "kind_display", "date", "period", "days",
            "source_type", "source_id", "note", "created_by_name", "created_at",
        ]

    def get_created_by_name(self, obj):
        user = obj.created_by
        return (user.get_full_name() or user.username) if user else "System"


class LeaveBalanceSerializer(serializers.Serializer):
    employee = serializers.IntegerField()
    employee_name = serializers.CharField()
    employee_code = serializers.CharField()
    department = serializers.CharField(allow_blank=True)
    employment_status = serializers.CharField()
    leave_type = serializers.CharField()
    opening = serializers.DecimalField(max_digits=9, decimal_places=2)
    accrued = serializers.DecimalField(max_digits=9, decimal_places=2)
    taken = serializers.DecimalField(max_digits=9, decimal_places=2)
    adjustments = serializers.DecimalField(max_digits=9, decimal_places=2)
    expired = serializers.DecimalField(max_digits=9, decimal_places=2)
    paid_out = serializers.DecimalField(max_digits=9, decimal_places=2)
    balance = serializers.DecimalField(max_digits=9, decimal_places=2)
    accruing_this_month = serializers.DecimalField(max_digits=9, decimal_places=2)
    available = serializers.DecimalField(max_digits=9, decimal_places=2)


class LeaveAdjustmentSerializer(serializers.Serializer):
    leave_type = serializers.ChoiceField(choices=LeaveRequest.LeaveType.choices, default=LeaveRequest.LeaveType.ANNUAL)
    days = serializers.DecimalField(max_digits=7, decimal_places=2)
    note = serializers.CharField(max_length=255)
    date = serializers.DateField(required=False)

    def validate_days(self, value):
        if value == 0:
            raise serializers.ValidationError("Days can't be zero")
        return value
