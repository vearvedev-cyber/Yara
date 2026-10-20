from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.holidays import zambian_public_holidays
from apps.core.models import PublicHoliday


class Command(BaseCommand):
    help = "Create national Zambian public holidays for one or more years (existing dates are left alone)."

    def add_arguments(self, parser):
        parser.add_argument('years', nargs='*', type=int, help='Years to seed (default: this year and next)')

    def handle(self, *args, **options):
        years = options['years'] or [timezone.now().year, timezone.now().year + 1]
        for year in years:
            created = 0
            for day, name in zambian_public_holidays(year):
                _, was_created = PublicHoliday.objects.get_or_create(
                    workspace=None, date=day, defaults={'name': name}
                )
                created += int(was_created)
            self.stdout.write(self.style.SUCCESS(f'{year}: {created} holidays added'))
