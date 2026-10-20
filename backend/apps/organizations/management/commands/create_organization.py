import getpass

from django.contrib.auth import password_validation
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.departments.models import Department
from apps.audit_templates.sample_data import SAMPLE_DEPARTMENTS
from apps.organizations.models import Organization


class Command(BaseCommand):
    help = "Production bootstrap: create an organisation and its first Super Administrator."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True)
        parser.add_argument("--slug")
        parser.add_argument("--admin-email", required=True)
        parser.add_argument("--admin-first-name", default="Admin")
        parser.add_argument("--admin-last-name", default="User")
        parser.add_argument("--with-departments", action="store_true", help="Create the standard department list")

    @transaction.atomic
    def handle(self, *args, **o):
        slug = o["slug"] or slugify(o["name"])
        if Organization.objects.filter(slug=slug).exists():
            raise CommandError(f"Organisation '{slug}' already exists.")
        email = o["admin_email"].lower()
        if User.objects.filter(email=email).exists():
            raise CommandError(f"User {email} already exists.")
        password = getpass.getpass("Password for the Super Administrator: ")
        candidate = User(email=email, first_name=o["admin_first_name"], last_name=o["admin_last_name"])
        password_validation.validate_password(password, candidate)

        org = Organization.objects.create(name=o["name"], slug=slug)
        User.objects.create_user(email=email, password=password, organization=org, role=Role.SUPER_ADMIN,
                                 first_name=o["admin_first_name"], last_name=o["admin_last_name"])
        if o["with_departments"]:
            for name, code, description in SAMPLE_DEPARTMENTS:
                Department.objects.create(organization=org, name=name, code=code, description=description)
        self.stdout.write(self.style.SUCCESS(f"Created organisation '{org.name}' ({slug}) with admin {email}."))
