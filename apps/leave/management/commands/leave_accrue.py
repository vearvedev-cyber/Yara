from django.core.management.base import BaseCommand

from apps.core.models import Workspace
from apps.leave.balances import ensure_workspace_accruals


class Command(BaseCommand):
    help = "Post monthly leave accruals and carry-forward expiries for every workspace (safe to re-run)."

    def handle(self, *args, **options):
        for workspace in Workspace.objects.filter(is_active=True):
            ensure_workspace_accruals(workspace)
            self.stdout.write(f"{workspace.code}: up to date")
