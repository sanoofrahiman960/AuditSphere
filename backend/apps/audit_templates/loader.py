from django.db import transaction

from apps.departments.models import Department

from . import services
from .models import AuditCategory, AuditTemplate, AuditTemplateVersion
from .sample_data import SAMPLE_TEMPLATES


@transaction.atomic
def load_sample_templates(organization, user, approve=True):
    """Create the example department checklists for an organisation (skips names that already exist)."""
    created = []
    for spec in SAMPLE_TEMPLATES:
        if AuditTemplate.objects.filter(organization=organization, name=spec["name"]).exists():
            continue
        category, _ = AuditCategory.objects.get_or_create(organization=organization, name=spec["category"])
        department = Department.objects.filter(organization=organization, name=spec["department"]).first()
        template = services.create_template(
            user,
            {"name": spec["name"], "description": spec["description"], "department": department,
             "category": category},
            {"applicable_standard": spec["applicable_standard"],
             "scoring_method": spec.get("scoring_method", AuditTemplateVersion.ScoringMethod.SIMPLE)},
            spec["sections"],
        )
        if approve:
            services.approve_version(user, template.latest_version)
        created.append(template)
    return created
