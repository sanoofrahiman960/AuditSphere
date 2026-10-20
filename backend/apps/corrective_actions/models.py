from django.conf import settings
from django.core.validators import MaxValueValidator
from django.db import models
from django.utils import timezone

from apps.audits.models import Priority
from apps.core.files import evidence_upload_to
from apps.core.models import OrgScopedModel, TimeStampedModel


class CorrectiveAction(OrgScopedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        PENDING_VERIFICATION = "PENDING_VERIFICATION", "Pending Verification"
        REWORK_REQUIRED = "REWORK_REQUIRED", "Rejected / Rework Required"
        CLOSED = "CLOSED", "Closed"

    class ActionType(models.TextChoices):
        CORRECTIVE = "CORRECTIVE", "Corrective"
        PREVENTIVE = "PREVENTIVE", "Preventive"

    class VerificationResult(models.TextChoices):
        EFFECTIVE = "EFFECTIVE", "Effective"
        NOT_EFFECTIVE = "NOT_EFFECTIVE", "Not effective"

    OPEN_STATES = (Status.OPEN, Status.IN_PROGRESS, Status.PENDING_VERIFICATION, Status.REWORK_REQUIRED)

    reference = models.CharField(max_length=30)
    finding = models.ForeignKey("findings.AuditFinding", on_delete=models.PROTECT, related_name="actions")
    department = models.ForeignKey("departments.Department", on_delete=models.PROTECT, related_name="actions")
    action_type = models.CharField(max_length=10, choices=ActionType.choices, default=ActionType.CORRECTIVE)
    title = models.CharField(max_length=255)
    description = models.TextField()
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_actions")
    due_date = models.DateField(db_index=True)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True)
    progress = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(100)])
    resolution_notes = models.TextField(blank=True)
    verification_result = models.CharField(max_length=14, choices=VerificationResult.choices, blank=True)
    verification_notes = models.TextField(blank=True)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+")
    verified_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        ordering = ["due_date", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "reference"], name="uniq_action_ref_per_org"),
            models.CheckConstraint(condition=models.Q(progress__lte=100), name="action_progress_lte_100"),
        ]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "due_date"]),
            models.Index(fields=["owner", "status"]),
        ]

    def __str__(self):
        return f"{self.reference} {self.title}"

    @property
    def is_overdue(self):
        return self.status != self.Status.CLOSED and self.due_date < timezone.localdate()


class ActionComment(TimeStampedModel):
    action = models.ForeignKey(CorrectiveAction, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    body = models.TextField()

    class Meta:
        ordering = ["created_at"]


class ActionEvidence(OrgScopedModel):
    action = models.ForeignKey(CorrectiveAction, on_delete=models.CASCADE, related_name="evidence")
    file = models.FileField(upload_to=evidence_upload_to, max_length=300)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    description = models.CharField(max_length=500, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "action evidence"


class ActionStatusChange(TimeStampedModel):
    action = models.ForeignKey(CorrectiveAction, on_delete=models.CASCADE, related_name="status_changes")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["created_at"]
