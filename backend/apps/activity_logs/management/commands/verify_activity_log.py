from django.core.management.base import BaseCommand

from apps.activity_logs.services import verify_chain
from apps.organizations.models import Organization


class Command(BaseCommand):
    help = "Verify the tamper-evident hash chain of every organisation's activity log."

    def handle(self, *args, **options):
        failures = 0
        for org in Organization.objects.all():
            broken = verify_chain(org)
            if broken:
                failures += 1
                self.stdout.write(self.style.ERROR(f"{org.slug}: {len(broken)} broken entr(ies), first ids {broken[:10]}"))
            else:
                self.stdout.write(self.style.SUCCESS(f"{org.slug}: intact"))
        if failures:
            raise SystemExit(1)
