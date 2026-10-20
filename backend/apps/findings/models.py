from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.audit_templates.models import RiskCategory, Severity
from apps.core.models import OrgScopedModel, TimeStampedModel

LIKERT = [MinValueValidator(1), MaxValueValidator(5)]


class AuditFinding(OrgScopedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        IN_PROGRESS = "IN_PROGRESS", "Action in progress"
        RESOLVED = "RESOLVED", "Resolved (actions closed)"
        CLOSED = "CLOSED", "Closed"
        RISK_ACCEPTED = "RISK_ACCEPTED", "Risk accepted"

    OPEN_STATES = (Status.OPEN, Status.IN_PROGRESS, Status.RESOLVED)

    reference = models.CharField(max_length=30)
    audit = models.ForeignKey("audits.Audit", on_delete=models.PROTECT, related_name="findings")
    department = models.ForeignKey("departments.Department", on_delete=models.PROTECT, related_name="findings")
    question = models.ForeignKey("audit_templates.AuditQuestion", on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name="findings")
    response = models.ForeignKey("audits.AuditResponse", on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name="findings")
    title = models.CharField(max_length=255)
    description = models.TextField()
    expected_requirement = models.TextField(blank=True)
    observed_condition = models.TextField(blank=True)
    root_cause = models.TextField(blank=True)
    business_impact = models.TextField(blank=True)
    risk_category = models.CharField(max_length=20, choices=RiskCategory.choices, default=RiskCategory.COMPLIANCE)

    # Current risk position; history lives in RiskAssessment.
    likelihood = models.PositiveSmallIntegerField(default=3, validators=LIKERT)
    impact = models.PositiveSmallIntegerField(default=3, validators=LIKERT)
    risk_score = models.PositiveSmallIntegerField(default=9)
    severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.MEDIUM, db_index=True)
    severity_overridden = models.BooleanField(default=False)

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name="owned_findings")
    recommended_action = models.TextField(blank=True)
    target_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.OPEN, db_index=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name="+")
    closure_notes = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "reference"], name="uniq_finding_ref_per_org"),
            models.CheckConstraint(condition=models.Q(likelihood__gte=1, likelihood__lte=5), name="finding_likelihood_1_5"),
            models.CheckConstraint(condition=models.Q(impact__gte=1, impact__lte=5), name="finding_impact_1_5"),
        ]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "severity"]),
        ]

    def __str__(self):
        return f"{self.reference} {self.title}"


class RiskAssessment(TimeStampedModel):
    """Every (re)assessment of a finding's risk, including manual overrides and their reasons."""

    finding = models.ForeignKey(AuditFinding, on_delete=models.CASCADE, related_name="risk_assessments")
    likelihood = models.PositiveSmallIntegerField(validators=LIKERT)
    impact = models.PositiveSmallIntegerField(validators=LIKERT)
    score = models.PositiveSmallIntegerField()
    calculated_severity = models.CharField(max_length=10, choices=Severity.choices)
    final_severity = models.CharField(max_length=10, choices=Severity.choices)
    is_override = models.BooleanField(default=False)
    rationale = models.TextField(blank=True)
    assessed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        ordering = ["-created_at"]
