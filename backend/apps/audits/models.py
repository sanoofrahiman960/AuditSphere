from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.files import evidence_upload_to
from apps.core.models import OrgScopedModel, TimeStampedModel


class Priority(models.TextChoices):
    LOW = "LOW", "Low"
    MEDIUM = "MEDIUM", "Medium"
    HIGH = "HIGH", "High"
    CRITICAL = "CRITICAL", "Critical"


class Audit(OrgScopedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        SCHEDULED = "SCHEDULED", "Scheduled"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        SUBMITTED = "SUBMITTED", "Submitted for Review"
        REWORK_REQUIRED = "REWORK_REQUIRED", "Rework Required"
        APPROVED = "APPROVED", "Approved"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    class AuditType(models.TextChoices):
        INTERNAL = "INTERNAL", "Internal"
        COMPLIANCE = "COMPLIANCE", "Compliance"
        OPERATIONAL = "OPERATIONAL", "Operational"
        FINANCIAL = "FINANCIAL", "Financial"
        IT = "IT", "IT / Security"
        FOLLOW_UP = "FOLLOW_UP", "Follow-up"
        SPECIAL = "SPECIAL", "Special investigation"

    # States in which the audit no longer counts as open/overdue.
    CLOSED_STATES = (Status.APPROVED, Status.COMPLETED, Status.CANCELLED)
    # States in which the checklist may be edited by the auditor.
    EDITABLE_STATES = (Status.IN_PROGRESS, Status.REWORK_REQUIRED)

    reference = models.CharField(max_length=30)
    title = models.CharField(max_length=255)
    department = models.ForeignKey("departments.Department", on_delete=models.PROTECT, related_name="audits")
    template_version = models.ForeignKey(
        "audit_templates.AuditTemplateVersion", on_delete=models.PROTECT, related_name="audits"
    )
    audit_type = models.CharField(max_length=12, choices=AuditType.choices, default=AuditType.INTERNAL)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    planned_start_date = models.DateField()
    due_date = models.DateField(db_index=True)
    lead_auditor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
                                     related_name="audits_led")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
                                 related_name="audits_reviewed")
    department_contact = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                           blank=True, related_name="audits_as_contact")
    scope = models.TextField(blank=True)
    objectives = models.TextField(blank=True)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)

    overall_summary = models.TextField(blank=True)
    overall_recommendation = models.TextField(blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    status_reason = models.TextField(blank=True, help_text="Reason recorded for the latest cancel/reopen.")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    # Cached score figures, recalculated by apps.audits.scoring.recalculate().
    total_questions = models.PositiveIntegerField(default=0)
    answered_count = models.PositiveIntegerField(default=0)
    mandatory_unanswered_count = models.PositiveIntegerField(default=0)
    compliant_count = models.PositiveIntegerField(default=0)
    non_compliant_count = models.PositiveIntegerField(default=0)
    not_applicable_count = models.PositiveIntegerField(default=0)
    compliance_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    score_numerator = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    score_denominator = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        ordering = ["-planned_start_date", "-id"]
        constraints = [models.UniqueConstraint(fields=["organization", "reference"], name="uniq_audit_ref_per_org")]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "due_date"]),
            models.Index(fields=["department", "status"]),
        ]

    def __str__(self):
        return f"{self.reference} {self.title}"

    @property
    def is_overdue(self):
        return self.status not in self.CLOSED_STATES and self.due_date < timezone.localdate()

    @property
    def completion_percentage(self):
        if not self.total_questions:
            return 0
        return round(self.answered_count * 100 / self.total_questions)


class AuditAssignment(TimeStampedModel):
    """Assignment history and audit team membership."""

    class AssignmentRole(models.TextChoices):
        LEAD_AUDITOR = "LEAD_AUDITOR", "Lead auditor"
        AUDITOR = "AUDITOR", "Co-auditor"
        REVIEWER = "REVIEWER", "Reviewer"

    audit = models.ForeignKey(Audit, on_delete=models.CASCADE, related_name="assignments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="audit_assignments")
    assignment_role = models.CharField(max_length=14, choices=AssignmentRole.choices)
    is_active = models.BooleanField(default=True)
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "is_active"])]
        constraints = [
            models.UniqueConstraint(
                fields=["audit", "user", "assignment_role"], condition=models.Q(is_active=True),
                name="uniq_active_assignment",
            )
        ]


class AuditResponse(TimeStampedModel):
    class Choice(models.TextChoices):
        YES = "YES", "Yes"
        NO = "NO", "No"
        PASS = "PASS", "Pass"
        FAIL = "FAIL", "Fail"
        NA = "NA", "Not applicable"

    class Compliance(models.TextChoices):
        COMPLIANT = "COMPLIANT", "Compliant"
        NON_COMPLIANT = "NON_COMPLIANT", "Non-compliant"
        NOT_APPLICABLE = "NOT_APPLICABLE", "Not applicable"
        INFORMATIONAL = "INFORMATIONAL", "Informational"
        UNANSWERED = "UNANSWERED", "Unanswered"

    audit = models.ForeignKey(Audit, on_delete=models.CASCADE, related_name="responses")
    question = models.ForeignKey("audit_templates.AuditQuestion", on_delete=models.PROTECT, related_name="responses")
    choice_value = models.CharField(max_length=4, choices=Choice.choices, blank=True)
    text_value = models.TextField(blank=True)
    number_value = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    date_value = models.DateField(null=True, blank=True)
    rating_value = models.PositiveSmallIntegerField(null=True, blank=True)
    is_not_applicable = models.BooleanField(default=False)
    # For informational question types the auditor may record an explicit judgement.
    manual_assessment = models.CharField(
        max_length=14, blank=True,
        choices=[(Compliance.COMPLIANT, "Compliant"), (Compliance.NON_COMPLIANT, "Non-compliant")],
    )
    compliance = models.CharField(max_length=14, choices=Compliance.choices, default=Compliance.UNANSWERED,
                                  db_index=True)
    observation = models.TextField(blank=True)
    recommendation = models.TextField(blank=True)
    risk_flagged = models.BooleanField(default=False)
    answered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["audit", "question"], name="uniq_response_per_question")]

    def __str__(self):
        return f"{self.audit.reference} Q{self.question_id}: {self.compliance}"


class AuditEvidence(OrgScopedModel):
    """Evidence file for an audit; optionally linked to a checklist response or a finding."""

    audit = models.ForeignKey(Audit, on_delete=models.CASCADE, related_name="evidence")
    response = models.ForeignKey(AuditResponse, on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name="evidence")
    finding = models.ForeignKey("findings.AuditFinding", on_delete=models.SET_NULL, null=True, blank=True,
                                related_name="evidence")
    file = models.FileField(upload_to=evidence_upload_to, max_length=300)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    description = models.CharField(max_length=500, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "audit evidence"

    def __str__(self):
        return self.original_name


class ReviewComment(TimeStampedModel):
    """
    Reviewer feedback on a specific checklist question (or the audit as a whole when question is null).
    Open comments must be resolved by the audit team before the audit can be resubmitted.
    """

    audit = models.ForeignKey(Audit, on_delete=models.CASCADE, related_name="review_comments")
    question = models.ForeignKey("audit_templates.AuditQuestion", on_delete=models.PROTECT, null=True, blank=True,
                                 related_name="review_comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    body = models.TextField()
    is_resolved = models.BooleanField(default=False)
    resolution_note = models.TextField(blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["audit", "is_resolved"])]


class ReviewDecision(TimeStampedModel):
    class Decision(models.TextChoices):
        APPROVED = "APPROVED", "Approved"
        REWORK_REQUIRED = "REWORK_REQUIRED", "Rework required"

    audit = models.ForeignKey(Audit, on_delete=models.CASCADE, related_name="review_decisions")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    decision = models.CharField(max_length=16, choices=Decision.choices)
    comments = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
