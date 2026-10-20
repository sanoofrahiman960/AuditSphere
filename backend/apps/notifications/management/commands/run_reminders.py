from django.core.management.base import BaseCommand

from apps.notifications.reminders import run_reminders


class Command(BaseCommand):
    help = ("Send due-date and overdue reminders. Idempotent — schedule it daily (cron / Windows Task Scheduler) "
            "when Celery beat is not running.")

    def handle(self, *args, **options):
        totals = run_reminders()
        self.stdout.write(self.style.SUCCESS(f"Reminders sent: {totals}"))
