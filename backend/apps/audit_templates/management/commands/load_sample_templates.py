from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.audit_templates.loader import load_sample_templates
from apps.organizations.models import Organization


class Command(BaseCommand):
    help = "Load the example department audit templates into an organisation (safe to re-run)."

    def add_arguments(self, parser):
        parser.add_argument("--org", required=True, help="Organisation slug")
        parser.add_argument("--draft", action="store_true", help="Leave templates as drafts instead of approving")

    def handle(self, *args, **options):
        org = Organization.objects.filter(slug=options["org"]).first()
        if org is None:
            raise CommandError(f"Organisation '{options['org']}' not found.")
        actor = User.objects.filter(organization=org, role=Role.SUPER_ADMIN, is_active=True).first()
        if actor is None:
            raise CommandError("The organisation needs an active Super Administrator.")
        created = load_sample_templates(org, actor, approve=not options["draft"])
        self.stdout.write(self.style.SUCCESS(f"Created {len(created)} template(s)."))
