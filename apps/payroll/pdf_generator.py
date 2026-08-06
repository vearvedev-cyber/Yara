"""
PDF generation utilities for payslips.
Receipt-style layout using ReportLab canvas directly.
"""
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from io import BytesIO


def generate_payslip_pdf(payslip, workspace_name=None):
    """
    Generate a receipt-style PDF for a payslip.
    Returns a bytes object containing the PDF.
    """
    # ---- Company name ----
    if workspace_name:
        company_name = workspace_name.upper()
    else:
        workspace = getattr(payslip.employee, 'workspace', None)
        company_name = workspace.name.upper() if workspace else 'COMPANY'

    # ---- Department ----
    dept = getattr(payslip.employee, 'department', None)
    department_name = getattr(dept, 'name', None) or 'N/A'

    # ---- Currency ----
    currency = getattr(payslip, 'currency', 'ZMW') or 'ZMW'

    def fmt(val):
        try:
            return f"{float(val):,.2f}"
        except (TypeError, ValueError):
            return '0.00'

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    left = 35
    right = width - 35
    y = height - 45

    def draw_line(text, size=9, bold=False, center=False, right_align=False):
        nonlocal y
        font = 'Helvetica-Bold' if bold else 'Helvetica'
        c.setFont(font, size)
        if center:
            tw = c.stringWidth(text, font, size)
            x = (width - tw) / 2
        elif right_align:
            tw = c.stringWidth(text, font, size)
            x = right - tw
        else:
            x = left
        c.drawString(x, y, text)
        y -= size + 4

    def draw_row(label, value, label_size=9, value_size=9, bold_label=False, bold_value=False):
        """Draw a key-value row on the same line."""
        nonlocal y
        lf = 'Helvetica-Bold' if bold_label else 'Helvetica'
        vf = 'Helvetica-Bold' if bold_value else 'Helvetica'
        c.setFont(lf, label_size)
        c.drawString(left, y, label)
        c.setFont(vf, value_size)
        tw = c.stringWidth(value, vf, value_size)
        c.drawString(right - tw, y, value)
        y -= label_size + 4

    def draw_separator(char='-'):
        nonlocal y
        c.setFont('Courier', 8)
        max_chars = int((right - left) / c.stringWidth(char, 'Courier', 8))
        c.drawString(left, y, char * max_chars)
        y -= 11

    # ======= HEADER =======
    draw_line(company_name, size=14, bold=True, center=True)
    draw_line('PAYSLIP', size=11, center=True)
    draw_separator('=')
    y -= 3

    # ======= EMPLOYEE INFO =======
    draw_line('EMPLOYEE INFORMATION', size=9, bold=True)
    y -= 2
    draw_row('Employee ID', payslip.employee.employee_id)
    draw_row('Name', payslip.employee.full_name)
    draw_row('Department', department_name)
    draw_row('Pay Period', str(payslip.period))
    draw_row('Currency', currency)
    draw_separator()

    # ======= EARNINGS =======
    draw_line('EARNINGS', size=9, bold=True)
    y -= 2
    draw_row('Basic Salary', fmt(payslip.basic_salary))

    if float(payslip.housing_allowance or 0) > 0:
        draw_row('Housing Allowance', fmt(payslip.housing_allowance))
    if float(payslip.transportation_allowance or 0) > 0:
        draw_row('Transportation Allowance', fmt(payslip.transportation_allowance))
    if float(payslip.lunch_allowance or 0) > 0:
        draw_row('Lunch Allowance', fmt(payslip.lunch_allowance))
    if float(payslip.other_allowances or 0) > 0:
        draw_row('Other Allowances', fmt(payslip.other_allowances))
    if float(payslip.overtime_payment or 0) > 0:
        draw_row('Overtime', fmt(payslip.overtime_payment))
    if float(payslip.bonus or 0) > 0:
        draw_row('Bonus', fmt(payslip.bonus))
    if float(payslip.double_ticket_payment or 0) > 0:
        draw_row('Double Ticket (Sun/Holiday)', fmt(payslip.double_ticket_payment))

    draw_separator('-')
    draw_row('GROSS SALARY', f"{currency} {fmt(payslip.gross_salary)}", bold_label=True, bold_value=True)
    draw_separator()

    # ======= DEDUCTIONS =======
    employer_borne = getattr(payslip, 'employer_borne_deductions', False)
    deduction_header = 'DEDUCTIONS (COVERED BY EMPLOYER)' if employer_borne else 'DEDUCTIONS'
    draw_line(deduction_header, size=9, bold=True)
    y -= 2
    draw_row('NAPSA (Employee)', fmt(payslip.napsa_employee))
    draw_row('PAYE Tax', fmt(payslip.paye_tax))
    draw_row('NHIMA (Employee)', fmt(payslip.nhima_employee))

    if float(payslip.unpaid_leave_deduction or 0) > 0:
        draw_row('Unpaid Leave', fmt(payslip.unpaid_leave_deduction))
    if float(payslip.absenteeism_deduction or 0) > 0:
        draw_row('Absenteeism', fmt(payslip.absenteeism_deduction))

    for ded in payslip.custom_deductions.all():
        draw_row(ded.description[:40], fmt(ded.amount))

    draw_separator('-')
    draw_row('TOTAL DEDUCTIONS', f"{currency} {fmt(payslip.total_deductions)}", bold_label=True, bold_value=True)
    draw_separator()

    # ======= NET PAY =======
    y -= 4
    draw_row('NET PAY', f"{currency} {fmt(payslip.net_salary)}", label_size=12, value_size=12, bold_label=True, bold_value=True)
    y -= 4
    draw_separator('=')

    # ======= EMPLOYER CONTRIBUTIONS =======
    draw_line('EMPLOYER CONTRIBUTIONS (info only)', size=9, bold=True)
    y -= 2
    draw_row('NAPSA (Employer)', fmt(payslip.napsa_employer))
    draw_row('NHIMA (Employer)', fmt(payslip.nhima_employer))
    draw_separator()

    # ======= NOTES =======
    if payslip.notes:
        draw_line('NOTES', size=9, bold=True)
        y -= 2
        for line in str(payslip.notes)[:300].split('\n')[:6]:
            if line.strip():
                draw_line(line.strip()[:75], size=8)
        draw_separator()

    # ======= FOOTER =======
    y -= 6
    draw_separator('=')
    draw_line('This is a computer-generated payslip.', size=7, center=True)
    draw_line(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", size=7, center=True)
    draw_separator('=')

    c.showPage()
    c.save()

    buffer.seek(0)
    return buffer.getvalue()
