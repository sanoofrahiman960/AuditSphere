from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import OrgScopedModel, TimeStampedModel


class Severity(models.TextChoices):
    CRITICAL = "CRITICAL", "Critical"
    HIGH = "HIGH", "High"
    MEDIUM = "MEDIUM", "Medium"
    LOW = "LOW", "Low"


class RiskCategory(models.TextChoices):
    COMPLIANCE = "COMPLIANCE", "Compliance"
    OPERATIONAL = "OPERATIONAL", "Operational"
    FINANCIAL = "FINANCIAL", "Financial"
    SECURITY = "SECURITY", "Information Security"
    REPUTATIONAL = "REPUTATIONAL", "Reputational"
    STRATEGIC = "STRATEGIC", "Strategic"
    LEGAL = "LEGAL", "Legal"
    PEOPLE = "PEOPLE", "People"


class AuditCategory(OrgScopedModel):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "audit categories"
        constraints = [models.UniqueConstraint(fields=["organization", "name"], name="uniq_category_per_org")]

    def __str__(self):
        return self.name


class AuditTemplate(OrgScopedModel):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    department = models.ForeignKey(
        "departments.Department", on_delete=models.SET_NULL, null=True, blank=True, related_name="templates",
        help_text="Leave empty for a template usable by every department.",
    )
    category = models.ForeignKey(AuditCategory, on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name="templates")
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                   related_name="+")

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["organization", "name"], name="uniq_template_name_per_org")]

    def __str__(self):
        return self.name

    @property
    def latest_version(self):
        return self.versions.order_by("-version").first()

    @property
    def current_approved_version(self):
        return self.versions.filter(status=AuditTemplateVersion.Status.APPROVED).order_by("-version").first()


class AuditTemplateVersion(TimeStampedModel):
    """
    An immutable-once-approved snapshot of a template's questions.
    Audits reference a version (PROTECT), so the questions used by an audit are preserved.
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        APPROVED = "APPROVED", "Approved"
        ARCHIVED = "ARCHIVED", "Archived"

    class ScoringMethod(models.TextChoices):
        SIMPLE = "SIMPLE", "Simple (each question counts once)"
        WEIGHTED = "WEIGHTED", "Weighted (question weights)"

    template = models.ForeignKey(AuditTemplate, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    applicable_standard = models.CharField(max_length=255, blank=True,
                                           help_text="Policy, SOP or standard this checklist is based on.")
    scoring_method = models.CharField(max_length=10, choices=ScoringMethod.choices, default=ScoringMethod.SIMPLE)
    change_notes = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["template", "-version"]
        constraints = [models.UniqueConstraint(fields=["template", "version"], name="uniq_template_version")]

    def __str__(self):
        return f"{self.template.name} v{self.version}"

    @property
    def organization_id(self):
        return self.template.organization_id

    @property
    def is_editable(self):
        return self.status == self.Status.DRAFT and not self.audits.exists()


class AuditSection(models.Model):
    version = models.ForeignKey(AuditTemplateVersion, on_delete=models.CASCADE, related_name="sections")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.title


class AuditQuestion(models.Model):
    class ResponseType(models.TextChoices):
        YES_NO = "YES_NO", "Yes / No"
        PASS_FAIL = "PASS_FAIL", "Pass / Fail"
        YES_NO_NA = "YES_NO_NA", "Yes / No / Not Applicable"
        RATING = "RATING", "Rating scale"
        TEXT = "TEXT", "Text"
        NUMBER = "NUMBER", "Numeric value"
        DATE = "DATE", "Date"

    section = models.ForeignKey(AuditSection, on_delete=models.CASCADE, related_name="questions")
    code = models.CharField(max_length=30, blank=True, help_text="Optional control reference, e.g. IT-AC-01.")
    text = models.TextField()
    guidance = models.TextField(blank=True, help_text="Guidance or expected criteria for the auditor.")
    response_type = models.CharField(max_length=12, choices=ResponseType.choices, default=ResponseType.YES_NO)
    is_mandatory = models.BooleanField(default=True)
    evidence_required = models.BooleanField(default=False)
    weight = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("1.00"),
                                 validators=[MinValueValidator(Decimal("0"))])
    risk_category = models.CharField(max_length=20, choices=RiskCategory.choices, default=RiskCategory.COMPLIANCE)
    failure_severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.MEDIUM)
    requires_corrective_action = models.BooleanField(default=False)
    rating_max = models.PositiveSmallIntegerField(default=5, validators=[MinValueValidator(2), MaxValueValidator(10)])
    rating_pass_threshold = models.PositiveSmallIntegerField(default=3)
    numeric_min = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    numeric_max = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text[:80]

    @property
    def is_scored(self):
        """Whether the answer itself determines compliance (see apps.audits.scoring)."""
        RT = self.ResponseType
        if self.response_type in (RT.YES_NO, RT.PASS_FAIL, RT.YES_NO_NA, RT.RATING):
            return True
        if self.response_type == RT.NUMBER:
            return self.numeric_min is not None or self.numeric_max is not None
        return False
