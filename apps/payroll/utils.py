"""
Zambian Payroll Calculation Utilities
Handles NAPSA, PAYE, and NHIMA calculations according to 2025/2026 rates
Supports workspace-specific statutory settings
"""

from decimal import Decimal
from typing import Any


def get_statutory_settings(workspace=None):
    """
    Fetch statutory settings for a workspace, with fallback to defaults.
    Returns napsa_rate, napsa_ceiling, nhima_rate, and salary split ratios.
    """
    if workspace:
        try:
            from .models import WorkspaceStatutorySettings
            settings = WorkspaceStatutorySettings.objects.get(workspace=workspace)
            return {
                'napsa_rate': float(settings.napsa_rate),
                'napsa_ceiling': float(settings.napsa_ceiling_monthly),
                'nhima_rate': float(settings.nhima_rate),
                'basic_ratio': float(settings.basic_ratio),
                'housing_ratio': float(settings.housing_ratio),
                'transport_ratio': float(settings.transport_ratio),
                'lunch_ratio': float(settings.lunch_ratio),
            }
        except Exception:
            pass

    # Fallback to ZRA defaults
    return {
        'napsa_rate': 0.05,
        'napsa_ceiling': 34164.00,
        'nhima_rate': 0.01,
        'basic_ratio': 0.45,
        'housing_ratio': 0.25,
        'transport_ratio': 0.15,
        'lunch_ratio': 0.15,
    }


def get_paye_tax_bands(workspace=None):
    """
    Fetch PAYE tax bands for a workspace, with fallback to defaults
    
    Args:
        workspace: Workspace object (optional). If not provided, uses hardcoded defaults
    
    Returns:
        List of (max_amount, rate) tuples in ascending order
    """
    if workspace:
        try:
            from .models import PayeTaxBand
            bands = PayeTaxBand.objects.filter(workspace=workspace).order_by('order', 'min_amount')
            if bands.exists():
                return [(float(band.max_amount), float(band.rate)) for band in bands]
        except Exception:
            pass
    
    # Fallback to default Zambian 2025/2026 tax bands
    return [
        (5100.00, 0.00),      # K0 - K5,100: 0%
        (7100.00, 0.20),      # K5,100.01 - K7,100: 20%
        (9200.00, 0.30),      # K7,100.01 - K9,200: 30%
        (float('inf'), 0.37)  # K9,200.01+: 37%
    ]


def _paye_on(chargeable_income, tax_bands):
    """Progressive PAYE on a monthly chargeable income."""
    paye_tax = 0
    prev_max = 0
    for max_amount, rate in tax_bands:
        if chargeable_income <= prev_max:
            break
        if max_amount == float('inf'):
            taxable = chargeable_income - prev_max
        else:
            taxable = min(chargeable_income - prev_max, max_amount - prev_max)
        paye_tax += taxable * rate
        prev_max = max_amount
    return paye_tax


def calculate_zambian_payroll(
    gross_salary: float | Decimal,
    unpaid_leave_deduction: float | Decimal = 0.0,
    custom_deductions: dict[str, float | Decimal] | None = None,
    workspace=None,
    paye_gross_up: bool = False,
) -> dict[str, Any]:
    """
    Calculate Zambian payroll with statutory deductions
    Supports workspace-specific rates and tax bands
    
    Args:
        gross_salary: Employee's gross monthly salary
        unpaid_leave_deduction: Pay not earned (unpaid leave + absenteeism). It is taken off
            before NAPSA, PAYE and NHIMA, because tax is charged on actual earnings.
        custom_deductions: Dict of custom deduction amounts {name: amount} (after tax)
        workspace: Workspace object (optional, for workspace-specific settings)
        paye_gross_up: True when the employer pays the employee's PAYE (free-of-tax pay).
            The tax paid for the employee is itself a taxable benefit, so PAYE is solved
            for: PAYE = tax on (chargeable income + PAYE). Returned as `paye_gross_up`.
    
    Returns:
        Dict with breakdown of all calculations
    """
    # Get workspace-specific statutory settings
    statutory_settings = get_statutory_settings(workspace)
    NAPSA_RATE = statutory_settings['napsa_rate']
    NAPSA_CEILING_MONTHLY = statutory_settings['napsa_ceiling']
    NHIMA_RATE = statutory_settings['nhima_rate']
    
    # Get workspace-specific PAYE tax bands
    TAX_BANDS = get_paye_tax_bands(workspace)
    
    # --- 1. Adjust Gross for Unpaid Leave/Absenteeism ---
    adjusted_gross = gross_salary - unpaid_leave_deduction
    
    # --- 2. Calculate NAPSA (rate capped at ceiling) ---
    NAPSA_MAX_EMPLOYEE_CONTRIBUTION = NAPSA_CEILING_MONTHLY * NAPSA_RATE
    employee_napsa = min(adjusted_gross * NAPSA_RATE, NAPSA_MAX_EMPLOYEE_CONTRIBUTION)
    employer_napsa = min(adjusted_gross * NAPSA_RATE, NAPSA_MAX_EMPLOYEE_CONTRIBUTION)
    
    # --- 3. Calculate Chargeable Income for PAYE ---
    chargeable_income = adjusted_gross - employee_napsa
    
    # --- 4. Calculate PAYE (progressive tax bands) ---
    paye_tax = _paye_on(chargeable_income, TAX_BANDS)
    gross_up = 0
    if paye_gross_up:
        # Fixed point: the benefit equals the tax on (income + benefit). Converges because
        # the top marginal rate is below 100%.
        for _ in range(100):
            next_tax = _paye_on(chargeable_income + paye_tax, TAX_BANDS)
            if abs(next_tax - paye_tax) < 0.001:
                paye_tax = next_tax
                break
            paye_tax = next_tax
        gross_up = paye_tax
    
    # --- 5. Calculate NHIMA (rate of adjusted gross) ---
    employee_nhima = adjusted_gross * NHIMA_RATE
    employer_nhima = adjusted_gross * NHIMA_RATE
    
    # --- 6. Process Custom Deductions ---
    custom_deductions = custom_deductions or {}
    total_custom_deductions = sum(custom_deductions.values())
    
    # --- 7. Calculate Total Deductions and Net Pay ---
    total_statutory_deductions = employee_napsa + paye_tax + employee_nhima
    total_deductions = total_statutory_deductions + unpaid_leave_deduction + total_custom_deductions
    net_pay = gross_salary - total_deductions
    
    return {
        'gross_salary': round(gross_salary, 2),
        'adjusted_gross': round(adjusted_gross, 2),
        'deductions': {
            'unpaid_leave': round(unpaid_leave_deduction, 2),
            'napsa_employee': round(employee_napsa, 2),
            'napsa_employer': round(employer_napsa, 2),
            'paye': round(paye_tax, 2),
            'nhima_employee': round(employee_nhima, 2),
            'nhima_employer': round(employer_nhima, 2),
            'custom': {k: round(v, 2) for k, v in custom_deductions.items()},
            'total_custom': round(total_custom_deductions, 2),
            'total_statutory': round(total_statutory_deductions, 2),
            'total': round(total_deductions, 2),
        },
        'chargeable_income': round(chargeable_income + gross_up, 2),
        'paye_gross_up': round(gross_up, 2),
        'net_pay': round(net_pay, 2),
    }


def calculate_unpaid_leave_deduction(gross_salary, unpaid_days, working_days_in_month=26):
    """
    Calculate deduction amount for unpaid leave days per Zambian Employment Code Act
    
    Args:
        gross_salary: Monthly gross salary
        unpaid_days: Number of unpaid leave/absent days
        working_days_in_month: Total working days in the month (default 26 per Zambian law)
    
    Returns:
        Deduction amount
    """
    daily_rate = gross_salary / working_days_in_month
    return round(daily_rate * unpaid_days, 2)


def get_tax_band_breakdown(chargeable_income, workspace=None):
    """
    Get detailed breakdown of which tax bands apply
    
    Args:
        chargeable_income: Income after NAPSA deduction
        workspace: Workspace object (optional, for workspace-specific bands)
    
    Returns:
        List of dicts with band details
    """
    TAX_BANDS = get_paye_tax_bands(workspace)
    breakdown = []
    income = chargeable_income
    
    for band_index, (max_amount, rate) in enumerate(TAX_BANDS):
        if income <= 0:
            break
        
        # Find previous band max or 0
        if band_index == 0:
            prev_max = 0
        else:
            prev_max = TAX_BANDS[band_index - 1][0]
        
        # Format band label
        if max_amount == float('inf'):
            band_label = f'K{prev_max:,.2f}+'
        else:
            band_label = f'K{prev_max:,.2f} - K{max_amount:,.2f}'
        
        # Calculate taxable amount in this band
        if income > max_amount:
            taxable_in_band = max_amount - prev_max
            tax_amount = taxable_in_band * rate
            breakdown.append({
                'band': band_label,
                'rate': f'{rate*100:.0f}%',
                'amount': round(taxable_in_band, 2),
                'tax': round(tax_amount, 2)
            })
            income -= taxable_in_band
        else:
            taxable_in_band = max(0, income - prev_max)
            tax_amount = taxable_in_band * rate
            if taxable_in_band > 0:
                breakdown.append({
                    'band': band_label,
                    'rate': f'{rate*100:.0f}%',
                    'amount': round(taxable_in_band, 2),
                    'tax': round(tax_amount, 2)
                })
            break
    
    return breakdown

def calculate_gross_from_net(
    net_salary: float | Decimal,
    workspace=None,
) -> dict[str, Any]:
    """
    Reverse-calculate gross salary from net using iterative approach.
    Finds the gross salary that, when all deductions are applied, results in the target net.
    Also breaks down gross into standard salary components.
    
    Args:
        net_salary: Target net salary
        workspace: Workspace object (optional, for workspace-specific settings)
    
    Returns:
        Dict with estimated gross_salary, salary components breakdown, or error message
    """
    statutory_settings = get_statutory_settings(workspace)
    NAPSA_RATE = statutory_settings['napsa_rate']
    NAPSA_CEILING_MONTHLY = statutory_settings['napsa_ceiling']
    NHIMA_RATE = statutory_settings['nhima_rate']
    basic_ratio = statutory_settings['basic_ratio']
    housing_ratio = statutory_settings['housing_ratio']
    transport_ratio = statutory_settings['transport_ratio']
    lunch_ratio = statutory_settings['lunch_ratio']

    # Use binary search to find gross that yields target net
    # Assume gross is between net and net * 1.5 (upper bound)
    low = net_salary
    high = net_salary * 1.5
    tolerance = 0.01
    max_iterations = 50
    
    for _ in range(max_iterations):
        mid = (low + high) / 2
        
        # Calculate what net we get from this gross
        result = calculate_zambian_payroll(mid, 0, {}, workspace)
        calculated_net = result['net_pay']
        
        if abs(calculated_net - net_salary) < tolerance:
            gross_salary = round(mid, 2)
            housing_allowance = round(gross_salary * housing_ratio, 2)
            transportation_allowance = round(gross_salary * transport_ratio, 2)
            lunch_allowance = round(gross_salary * lunch_ratio, 2)
            total_allowances = housing_allowance + transportation_allowance + lunch_allowance
            basic_salary = round(gross_salary - total_allowances, 2)
            return {
                'success': True,
                'gross_salary': gross_salary,
                'net_salary': round(calculated_net, 2),
                'basic_salary': basic_salary,
                'housing_allowance': housing_allowance,
                'transportation_allowance': transportation_allowance,
                'lunch_allowance': lunch_allowance,
            }

        if calculated_net < net_salary:
            low = mid
        else:
            high = mid

    # Return best approximation found
    result = calculate_zambian_payroll((low + high) / 2, 0, {}, workspace)
    gross_salary = round((low + high) / 2, 2)
    housing_allowance = round(gross_salary * housing_ratio, 2)
    transportation_allowance = round(gross_salary * transport_ratio, 2)
    lunch_allowance = round(gross_salary * lunch_ratio, 2)
    total_allowances = housing_allowance + transportation_allowance + lunch_allowance
    basic_salary = round(gross_salary - total_allowances, 2)
    return {
        'success': True,
        'gross_salary': gross_salary,
        'net_salary': round(result['net_pay'], 2),
        'basic_salary': basic_salary,
        'housing_allowance': housing_allowance,
        'transportation_allowance': transportation_allowance,
        'lunch_allowance': lunch_allowance,
    }