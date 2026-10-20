"""Small builders for tests — explicit, no external factory library."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.audit_templates import services as template_services
from apps.audit_templates.models import AuditTemplate
from apps.audits import services as audit_services
from apps.departments.models import Department
from apps.organizations.models import Organization

PASSWORD = "Str0ng-Test-Passw0rd!"


def make_org(slug="acme"):
    return Organization.objects.create(name=slug.title(), slug=slug)


def make_user(org, role, email=None, **extra):
    email = email or f"{role.lower()}-{User.objects.count()}@{org.slug}.test"
    return User.objects.create_user(email=email, password=PASSWORD, organization=org, role=role,
                                    first_name=extra.pop("first_name", role.title()), last_name="Test", **extra)


def make_department(org, name="Finance", manager=None):
    return Department.objects.create(organization=org, name=name, manager=manager)


SECTIONS = [
    {"title": "Controls", "questions": [
        {"code": "Q1", "text": "Is the control documented?", "response_type": "YES_NO", "is_mandatory": True,
         "weight": "1.00"},
        {"code": "Q2", "text": "Does the control pass testing?", "response_type": "PASS_FAIL", "is_mandatory": True,
         "evidence_required": True, "weight": "3.00", "failure_severity": "HIGH"},
        {"code": "Q3", "text": "Applicable to this department?", "response_type": "YES_NO_NA",
         "is_mandatory": True, "requires_corrective_action": True, "weight": "1.00"},
        {"code": "Q4", "text": "Rate maturity", "response_type": "RATING", "is_mandatory": False, "rating_max": 5,
         "rating_pass_threshold": 3},
        {"code": "Q5", "text": "Notes", "response_type": "TEXT", "is_mandatory": False},
    ]},
]


def make_template(org, admin, department=None, scoring_method="SIMPLE", approve=True, name="Test template"):
    template = template_services.create_template(
        admin, {"name": name, "department": department},
        {"applicable_standard": "Test policy", "scoring_method": scoring_method}, SECTIONS,
    )
    if approve:
        template_services.approve_version(admin, template.latest_version)
    return AuditTemplate.objects.get(pk=template.pk)


def make_audit(admin, department, template, lead, reviewer, schedule=True, start=False):
    today = timezone.localdate()
    audit = audit_services.create_audit(admin, {
        "title": "Test audit", "department": department, "template_version": template.current_approved_version,
        "planned_start_date": today, "due_date": today + timedelta(days=14), "lead_auditor": lead,
        "reviewer": reviewer,
    })
    if schedule:
        audit = audit_services.schedule(admin, audit)
    if start:
        audit = audit_services.start(lead, audit)
    return audit


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


class World:
    """A ready-made organisation with one user per role, a department, an approved template and an audit."""

    def __init__(self, slug="acme", start=False):
        self.org = make_org(slug)
        self.admin = make_user(self.org, Role.SUPER_ADMIN)
        self.audit_admin = make_user(self.org, Role.AUDIT_ADMIN)
        self.auditor = make_user(self.org, Role.AUDITOR)
        self.other_auditor = make_user(self.org, Role.AUDITOR)
        self.reviewer = make_user(self.org, Role.REVIEWER)
        self.manager = make_user(self.org, Role.DEPT_MANAGER)
        self.other_manager = make_user(self.org, Role.DEPT_MANAGER)
        self.owner = make_user(self.org, Role.ACTION_OWNER)
        self.executive = make_user(self.org, Role.EXECUTIVE)
        self.department = make_department(self.org, "Finance", manager=self.manager)
        self.other_department = make_department(self.org, "Sales", manager=self.other_manager)
        self.template = make_template(self.org, self.audit_admin, self.department)
        self.audit = make_audit(self.audit_admin, self.department, self.template, self.auditor, self.reviewer,
                                start=start)

    def questions(self):
        from apps.audit_templates.models import AuditQuestion

        return {q.code: q for q in AuditQuestion.objects.filter(section__version=self.audit.template_version)}
