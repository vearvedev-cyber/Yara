"""Final settlement statement PDF (same receipt style as payslips)."""
from io import BytesIO

from django.utils import timezone
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .models import FinalSettlement, SettlementLine


def _fmt(value) -> str:
    return f"{float(value):,.2f}"


def generate_settlement_pdf(settlement: FinalSettlement) -> bytes:
    employee = settlement.employee
    workspace = employee.workspace
    company = (workspace.name if workspace else 'Company').upper()

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left, right = 40, width - 40
    y = height - 50

    def new_page_if_needed(space=40):
        nonlocal y
        if y < space:
            c.showPage()
            y = height - 50

    def text(value, size=9, bold=False, center=False):
        nonlocal y
        new_page_if_needed()
        font = 'Helvetica-Bold' if bold else 'Helvetica'
        c.setFont(font, size)
        x = (width - c.stringWidth(value, font, size)) / 2 if center else left
        c.drawString(x, y, value)
        y -= size + 5

    def row(label, value, bold=False, sub=''):
        nonlocal y
        new_page_if_needed()
        font = 'Helvetica-Bold' if bold else 'Helvetica'
        c.setFont(font, 9)
        c.drawString(left, y, label[:80])
        c.drawString(right - c.stringWidth(value, font, 9), y, value)
        y -= 12
        if sub:
            c.setFont('Helvetica-Oblique', 7.5)
            c.drawString(left + 10, y, sub[:120])
            y -= 11

    def rule():
        nonlocal y
        c.setLineWidth(0.5)
        c.line(left, y + 4, right, y + 4)
        y -= 8

    title = 'FINAL SETTLEMENT STATEMENT' if settlement.kind == FinalSettlement.Kind.EXIT else 'CONTRACT-END GRATUITY STATEMENT'
    text(company, size=14, bold=True, center=True)
    text(title, size=11, center=True)
    if settlement.status not in (FinalSettlement.Status.APPROVED, FinalSettlement.Status.PAID):
        text(f'{settlement.get_status_display().upper()} — NOT FOR PAYMENT', size=9, bold=True, center=True)
    y -= 6

    reason = getattr(getattr(settlement.termination, 'termination_reason', None), 'name', '')
    row('Employee', f"{employee.full_name} ({employee.employee_id})")
    row('Job title', employee.job_title or '-')
    row('Date hired', str(employee.hire_date))
    row('Last working day', str(settlement.last_working_day))
    if reason:
        row('Reason for leaving', reason.replace('_', ' ').title())
    if settlement.contract:
        row('Contract', settlement.contract.contract_number)
    if settlement.payee_name:
        row('Payee', settlement.payee_name)
    y -= 4
    rule()

    sections = [
        (SettlementLine.Category.EARNING, 'EARNINGS'),
        (SettlementLine.Category.DEDUCTION, 'DEDUCTIONS'),
    ]
    lines = list(settlement.lines.order_by('line_no'))
    for category, heading in sections:
        text(heading, size=10, bold=True)
        items = [l for l in lines if l.category == category]
        if not items:
            row('None', '0.00')
        for line in items:
            sub = line.basis
            if line.is_manual and line.reason:
                sub = f"{sub} — {line.reason}" if sub else line.reason
            row(line.description, _fmt(line.amount), sub=sub)
        y -= 2
        rule()

    row('Total earnings', _fmt(settlement.total_earnings), bold=True)
    row('Total deductions', _fmt(settlement.total_deductions), bold=True)
    net_label = 'NET PAYABLE (ZMW)' if settlement.net_payable >= 0 else 'AMOUNT OWED BY EMPLOYEE (ZMW)'
    row(net_label, _fmt(abs(settlement.net_payable)), bold=True)
    rule()

    employer = [l for l in lines if l.category == SettlementLine.Category.EMPLOYER]
    if employer:
        text('EMPLOYER CONTRIBUTIONS (not deducted from pay)', size=9, bold=True)
        for line in employer:
            row(line.description, _fmt(line.amount))
        rule()

    y -= 20
    for label, person, when in (
        ('Prepared by', settlement.prepared_by, settlement.created_at),
        ('Approved by', settlement.approved_by, settlement.approved_at),
    ):
        name = (person.get_full_name() or person.username) if person else '______________________'
        stamp = timezone.localtime(when).strftime('%Y-%m-%d') if when and person else '__________'
        row(label, f"{name}   {stamp}")
    y -= 24
    row('Employee signature', '______________________   Date __________')
    y -= 10
    text('I confirm receipt of the above amount in full and final settlement of my employment dues.', size=8)

    c.showPage()
    c.save()
    return buffer.getvalue()
