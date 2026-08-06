from rest_framework import serializers
from .models import (
    PayrollComponent, PayrollEntry, SalaryRange, TitleBreakdown, PayrollPeriod,
    Payslip, PayslipDeduction, WorkspaceStatutorySettings, PayeTaxBand, PayslipAuditLog,
    ComplianceDocument,
)
from .utils import calculate_zambian_payroll


class PayrollComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollComponent
        fields = '__all__'


class PayrollEntrySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_number = serializers.CharField(source='employee.employee_number', read_only=True)
    employee_id = serializers.CharField(source='employee.employee_id', read_only=True)
    position = serializers.SerializerMethodField()
    napsa_employee = serializers.SerializerMethodField()
    nhima_employee = serializers.SerializerMethodField()
    paye_tax = serializers.SerializerMethodField()
    
    # Explicitly define salary fields to ensure proper handling
    basic = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=0, required=False, allow_null=True)
    housing = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=0, required=False, allow_null=True)
    transportation = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=0, required=False, allow_null=True)
    lunch = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=0, required=False, allow_null=True)

    class Meta:
        model = PayrollEntry
        fields = [
            'id', 'employee', 'employee_name', 'employee_number', 'employee_id',
            'date_of_hire', 'department', 'resident', 'position',
            'currency', 'basic', 'housing', 'transportation', 'lunch',
            'gross', 'net', 'napsa_employee', 'nhima_employee', 'paye_tax',
            'employer_borne_deductions',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['employee_name', 'employee_number', 'employee_id', 'created_at', 'updated_at']

    def get_position(self, obj):
        # Use employee job title when available
        job_title = getattr(obj.employee, 'job_title', None)
        if job_title:
            return job_title
        return obj.department if hasattr(obj, 'department') else None

    def _get_workspace(self, employee):
        if getattr(employee, 'workspace', None):
            return employee.workspace
        memberships = getattr(employee, 'workspace_memberships', None)
        if memberships is not None and memberships.exists():
            return memberships.first().workspace
        return None

    def _get_statutory_breakdown(self, obj):
        workspace = self._get_workspace(obj.employee)
        result = calculate_zambian_payroll(
            float(obj.gross),
            unpaid_leave_deduction=0,
            custom_deductions={},
            workspace=workspace
        )
        return result['deductions']

    def get_napsa_employee(self, obj):
        return self._get_statutory_breakdown(obj)['napsa_employee']

    def get_nhima_employee(self, obj):
        return self._get_statutory_breakdown(obj)['nhima_employee']

    def get_paye_tax(self, obj):
        return self._get_statutory_breakdown(obj)['paye']

    def validate_basic(self, value):
        # Allow None and 0, only reject negative values
        if value is None:
            return 0
        if value < 0:
            raise serializers.ValidationError("Basic salary cannot be negative")
        return value

    def validate(self, data):
        """Ensure either net OR salary components are provided, not both or neither"""
        # Normalize None values to 0
        for field in ['basic', 'housing', 'transportation', 'lunch']:
            if data.get(field) is None:
                data[field] = 0
        
        max_value = 9999999999999.99
        for field in ['net', 'basic', 'housing', 'transportation', 'lunch']:
            if field in data and data[field] is not None:
                try:
                    val = float(data[field])
                    if val > max_value:
                        raise serializers.ValidationError({
                            field: f"Ensure that there are no more than 15 digits in total (max {max_value})."
                        })
                except (TypeError, ValueError) as e:
                    raise serializers.ValidationError({
                        field: f"Invalid value: {str(e)}"
                    })

        # On create, we need some input
        if not self.instance:
            has_net = data.get('net', 0) > 0
            has_components = any(data.get(k, 0) > 0 for k in ['basic', 'housing', 'transportation', 'lunch'])
            
            if not has_net and not has_components:
                raise serializers.ValidationError(
                    "Please provide either net salary OR salary components (basic, housing, transportation, lunch)"
                )
        
        return data

    def create(self, validated_data):
        """Auto-calculate based on input: either net->gross or components->net"""
        employee = validated_data.get('employee')
        workspace = self._get_workspace(employee) if employee else None
        
        # Check if user provided net salary (reverse calculation)
        net_input = validated_data.get('net')
        has_components = any(k in validated_data for k in ['basic', 'housing', 'transportation', 'lunch'])
        
        if net_input and not has_components:
            # User provided net, calculate gross and components
            from .utils import calculate_gross_from_net
            result = calculate_gross_from_net(float(net_input), workspace=workspace)
            
            validated_data['gross'] = result['gross_salary']
            validated_data['basic'] = result['basic_salary']
            validated_data['housing'] = result['housing_allowance']
            validated_data['transportation'] = result['transportation_allowance']
            validated_data['lunch'] = result['lunch_allowance']
            validated_data['net'] = result['net_salary']
        else:
            # User provided components, calculate gross and net
            gross = (
                validated_data.get('basic', 0) +
                validated_data.get('housing', 0) +
                validated_data.get('transportation', 0) +
                validated_data.get('lunch', 0)
            )
            validated_data['gross'] = gross

            # Calculate net using statutory deductions (NAPSA/NHIMA/PAYE)
            from .utils import calculate_zambian_payroll
            result = calculate_zambian_payroll(float(gross), 0, {}, workspace=workspace)
            validated_data['net'] = result['net_pay']
        
        return super().create(validated_data)
    
    def update(self, instance, validated_data):
        """Auto-calculate based on what changed: net->gross or components->net"""
        workspace = self._get_workspace(instance.employee)
        
        # Check if user updated net salary (reverse calculation)
        net_input = validated_data.get('net')
        has_component_updates = any(k in validated_data for k in ['basic', 'housing', 'transportation', 'lunch'])
        
        if 'net' in validated_data and not has_component_updates:
            # User changed net, recalculate gross and components
            from .utils import calculate_gross_from_net
            result = calculate_gross_from_net(float(net_input), workspace=workspace)
            
            validated_data['gross'] = result['gross_salary']
            validated_data['basic'] = result['basic_salary']
            validated_data['housing'] = result['housing_allowance']
            validated_data['transportation'] = result['transportation_allowance']
            validated_data['lunch'] = result['lunch_allowance']
            validated_data['net'] = result['net_salary']
        elif has_component_updates:
            # User changed components, recalculate gross and net
            gross = (
                validated_data.get('basic', instance.basic) +
                validated_data.get('housing', instance.housing) +
                validated_data.get('transportation', instance.transportation) +
                validated_data.get('lunch', instance.lunch)
            )
            validated_data['gross'] = gross

            # Recalculate net using statutory deductions
            from .utils import calculate_zambian_payroll
            result = calculate_zambian_payroll(float(gross), 0, {}, workspace=workspace)
            validated_data['net'] = result['net_pay']
        
        return super().update(instance, validated_data)


class SalaryRangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryRange
        fields = '__all__'


class TitleBreakdownSerializer(serializers.ModelSerializer):
    class Meta:
        model = TitleBreakdown
        fields = '__all__'


class PayrollPeriodSerializer(serializers.ModelSerializer):
    month_display = serializers.CharField(source='get_month_display', read_only=True)
    payslip_count = serializers.SerializerMethodField()
    
    class Meta:
        model = PayrollPeriod
        fields = '__all__'
    
    def get_payslip_count(self, obj):
        return obj.payslips.count()


class PayslipDeductionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayslipDeduction
        fields = '__all__'


class PayslipSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_number = serializers.CharField(source='employee.employee_number', read_only=True)
    employee_id = serializers.CharField(source='employee.employee_id', read_only=True)
    period_display = serializers.CharField(source='period.__str__', read_only=True)
    custom_deductions = PayslipDeductionSerializer(many=True, read_only=True)
    department = serializers.SerializerMethodField()
    
    class Meta:
        model = Payslip
        fields = '__all__'
    
    def get_department(self, obj):
        department = getattr(obj.employee, 'department', None)
        if department:
            return getattr(department, 'name', None) or str(department)
        return None


class PayslipCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating payslips with custom deductions"""
    custom_deductions_data = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False
    )
    
    class Meta:
        model = Payslip
        fields = [
            'id', 'employee', 'period',
            'basic_salary', 'housing_allowance', 'transportation_allowance',
            'lunch_allowance', 'other_allowances', 'overtime_payment', 'bonus',
            'double_ticket_payment',
            'unpaid_leave_days', 'unpaid_leave_deduction',
            'absenteeism_days', 'absenteeism_deduction',
            'employer_borne_deductions',
            'notes', 'custom_deductions_data'
        ]
    
    def create(self, validated_data):
        custom_deductions_data = validated_data.pop('custom_deductions_data', [])
        
        # Create payslip
        payslip = Payslip.objects.create(**validated_data)
        
        # Add custom deductions
        for deduction_data in custom_deductions_data:
            PayslipDeduction.objects.create(
                payslip=payslip,
                description=deduction_data['description'],
                amount=deduction_data['amount']
            )
        
        # Calculate all amounts
        payslip.calculate()
        payslip.save()
        
        return payslip
    
    def update(self, instance, validated_data):
        custom_deductions_data = validated_data.pop('custom_deductions_data', None)
        
        # Update payslip fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        # Update custom deductions if provided
        if custom_deductions_data is not None:
            # Clear existing
            instance.custom_deductions.all().delete()
            # Add new ones
            for deduction_data in custom_deductions_data:
                PayslipDeduction.objects.create(
                    payslip=instance,
                    description=deduction_data['description'],
                    amount=deduction_data['amount']
                )
        
        # Recalculate
        instance.calculate()
        instance.save()
        
        return instance


class PayeTaxBandSerializer(serializers.ModelSerializer):
    workspace_name = serializers.CharField(source='workspace.name', read_only=True)
    
    class Meta:
        model = PayeTaxBand
        fields = '__all__'


class WorkspaceStatutorySettingsSerializer(serializers.ModelSerializer):
    workspace_name = serializers.CharField(source='workspace.name', read_only=True)
    paye_bands = PayeTaxBandSerializer(source='workspace.paye_tax_bands', many=True, read_only=True)

    class Meta:
        model = WorkspaceStatutorySettings
        fields = [
            'id', 'workspace', 'workspace_name',
            'napsa_rate', 'napsa_ceiling_monthly', 'nhima_rate',
            'basic_ratio', 'housing_ratio', 'transport_ratio', 'lunch_ratio',
            'effective_date', 'created_at', 'updated_at', 'paye_bands',
        ]
        read_only_fields = ['effective_date', 'created_at', 'updated_at']


class ComplianceDocumentSerializer(serializers.ModelSerializer):
    computed_status = serializers.CharField(read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)

    class Meta:
        model = ComplianceDocument
        fields = [
            'id', 'workspace', 'document_type', 'document_type_display', 'document_name',
            'reference_number', 'issued_by', 'issue_date', 'expiry_date', 'is_permanent',
            'document_file', 'notes', 'reminder_days',
            'computed_status', 'days_until_expiry',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class PayslipAuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True, allow_blank=True)
    action_display = serializers.CharField(source='get_action_display', read_only=True)
    
    class Meta:
        model = PayslipAuditLog
        fields = [
            'id', 'payslip', 'action', 'action_display', 'user', 'user_name',
            'timestamp', 'changes'
        ]
        read_only_fields = ['id', 'timestamp']


class PAYEReturnDetailRowSerializer(serializers.Serializer):
    """
    Serializer for detailed PAYE return row (one employee per row).
    """
    tpin = serializers.CharField(max_length=50, allow_blank=True)
    full_name = serializers.CharField(max_length=200)
    employee_nature = serializers.CharField(max_length=50)  # Contract type display
    contractor_type = serializers.CharField(max_length=20)  # Machine readable
    gross_pay = serializers.DecimalField(max_digits=15, decimal_places=2)
    chargeable_amount = serializers.DecimalField(max_digits=15, decimal_places=2)
    tax_credit = serializers.DecimalField(max_digits=15, decimal_places=2)
    tax_payable = serializers.DecimalField(max_digits=15, decimal_places=2)
    employee_id = serializers.CharField(max_length=50)


class PAYEReturnSerializer(serializers.ModelSerializer):
    """
    Serializer for PAYE Return summary.
    """
    workspace_name = serializers.CharField(source='workspace.name', read_only=True)
    period_display = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, allow_blank=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = None  # Will use from import below
        fields = [
            'id', 'workspace', 'workspace_name', 'period', 'period_display',
            'total_employees', 'total_gross_pay', 'total_chargeable_amount',
            'total_tax_credit', 'total_tax_payable',
            'status', 'status_display', 'submitted_at', 'submission_notes',
            'created_at', 'updated_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = ['total_employees', 'total_gross_pay', 'total_chargeable_amount',
                           'total_tax_credit', 'total_tax_payable', 'created_at', 'updated_at']
    
    def get_period_display(self, obj):
        """Return period as 'Month Year' format."""
        return f"{obj.period.get_month_display()} {obj.period.year}"


# Update Meta for PAYEReturnSerializer
from .models import PAYEReturn
PAYEReturnSerializer.Meta.model = PAYEReturn

