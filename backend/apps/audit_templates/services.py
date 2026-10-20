from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.activity_logs.services import log_activity
from apps.core.exceptions import BusinessRuleError, WorkflowError

from .models import AuditQuestion, AuditSection, AuditTemplate, AuditTemplateVersion

QUESTION_FIELDS = [
    "code", "text", "guidance", "response_type", "is_mandatory", "evidence_required", "weight", "risk_category",
    "failure_severity", "requires_corrective_action", "rating_max", "rating_pass_threshold", "numeric_min",
    "numeric_max",
]


def write_structure(version, sections):
    """Replace the sections/questions of a draft version from nested data."""
    if not version.is_editable:
        raise WorkflowError("Only unused draft versions can be edited. Create a new version instead.")
    version.sections.all().delete()
    for s_index, section_data in enumerate(sections):
        section = AuditSection.objects.create(
            version=version, title=section_data["title"], description=section_data.get("description", ""),
            order=section_data.get("order", s_index),
        )
        for q_index, question in enumerate(section_data.get("questions", [])):
            AuditQuestion.objects.create(
                section=section, order=question.get("order", q_index),
                **{f: question[f] for f in QUESTION_FIELDS if f in question},
            )


def clone_structure(source, target):
    for section in source.sections.prefetch_related("questions"):
        new_section = AuditSection.objects.create(version=target, title=section.title,
                                                  description=section.description, order=section.order)
        AuditQuestion.objects.bulk_create([
            AuditQuestion(section=new_section, order=q.order, **{f: getattr(q, f) for f in QUESTION_FIELDS})
            for q in section.questions.all()
        ])


@transaction.atomic
def create_template(user, data, version_data, sections, request=None):
    template = AuditTemplate.objects.create(organization=user.organization, created_by=user, **data)
    version = AuditTemplateVersion.objects.create(template=template, version=1, created_by=user, **version_data)
    write_structure(version, sections)
    log_activity(user, "template.created", template, request=request, changes={"version": 1})
    return template


@transaction.atomic
def new_version(user, template, source=None, change_notes="", request=None):
    source = source or template.latest_version
    number = (template.versions.aggregate(m=Max("version"))["m"] or 0) + 1
    version = AuditTemplateVersion.objects.create(
        template=template, version=number, created_by=user, change_notes=change_notes,
        applicable_standard=source.applicable_standard if source else "",
        scoring_method=source.scoring_method if source else AuditTemplateVersion.ScoringMethod.SIMPLE,
    )
    if source:
        clone_structure(source, version)
    log_activity(user, "template.version_created", template, request=request,
                 changes={"version": number, "source_version": source.version if source else None})
    return version


@transaction.atomic
def duplicate_template(user, template, name, request=None):
    source = template.latest_version
    copy = AuditTemplate.objects.create(
        organization=template.organization, name=name, description=template.description,
        department=template.department, category=template.category, created_by=user,
    )
    version = AuditTemplateVersion.objects.create(
        template=copy, version=1, created_by=user, change_notes=f"Duplicated from {template.name}",
        applicable_standard=source.applicable_standard if source else "",
        scoring_method=source.scoring_method if source else AuditTemplateVersion.ScoringMethod.SIMPLE,
    )
    if source:
        clone_structure(source, version)
    log_activity(user, "template.duplicated", copy, request=request, changes={"source_template": template.id})
    return copy


@transaction.atomic
def approve_version(user, version, request=None):
    version = AuditTemplateVersion.objects.select_for_update().get(pk=version.pk)
    if version.status != AuditTemplateVersion.Status.DRAFT:
        raise WorkflowError("Only draft versions can be approved.")
    if not AuditQuestion.objects.filter(section__version=version).exists():
        raise BusinessRuleError("A template version needs at least one question before approval.")
    superseded = list(version.template.versions.filter(status=AuditTemplateVersion.Status.APPROVED)
                      .values_list("version", flat=True))
    version.template.versions.filter(status=AuditTemplateVersion.Status.APPROVED).update(
        status=AuditTemplateVersion.Status.ARCHIVED
    )
    version.status = AuditTemplateVersion.Status.APPROVED
    version.approved_by = user
    version.approved_at = timezone.now()
    version.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    log_activity(user, "template.version_approved", version.template, request=request,
                 changes={"version": version.version, "archived_versions": superseded})
    return version


@transaction.atomic
def archive_version(user, version, request=None):
    if version.status == AuditTemplateVersion.Status.ARCHIVED:
        raise WorkflowError("Version is already archived.")
    version.status = AuditTemplateVersion.Status.ARCHIVED
    version.save(update_fields=["status", "updated_at"])
    log_activity(user, "template.version_archived", version.template, request=request,
                 changes={"version": version.version})
    return version
