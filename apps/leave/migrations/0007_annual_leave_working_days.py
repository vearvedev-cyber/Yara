"""
Annual leave is now counted in working days (Monday–Friday, excluding public holidays)
instead of calendar days. Seed national holidays for every year that has leave records,
then recount existing ANNUAL requests so balances built from them are correct.
"""
from datetime import date, timedelta

from django.db import migrations

from apps.core.holidays import zambian_public_holidays


def forwards(apps, schema_editor):
    LeaveRequest = apps.get_model('leave', 'LeaveRequest')
    PublicHoliday = apps.get_model('core', 'PublicHoliday')

    dates = LeaveRequest.objects.values_list('start_date', 'end_date')
    years = {d.year for pair in dates for d in pair if d}
    this_year = date.today().year
    years |= {this_year, this_year + 1}
    for year in sorted(years):
        for day, name in zambian_public_holidays(year):
            PublicHoliday.objects.get_or_create(workspace=None, date=day, defaults={'name': name})

    holidays = set(PublicHoliday.objects.filter(workspace__isnull=True).values_list('date', flat=True))
    for leave in LeaveRequest.objects.filter(leave_type='ANNUAL').only('id', 'start_date', 'end_date', 'days'):
        if not leave.start_date or not leave.end_date or leave.end_date < leave.start_date:
            continue
        days, current = 0, leave.start_date
        while current <= leave.end_date:
            if current.weekday() < 5 and current not in holidays:
                days += 1
            current += timedelta(days=1)
        if days != leave.days:
            LeaveRequest.objects.filter(pk=leave.pk).update(days=days)


class Migration(migrations.Migration):
    dependencies = [
        ('leave', '0006_leavepolicy_leaveledgerentry_and_more'),
        ('core', '0014_publicholiday_and_more'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
