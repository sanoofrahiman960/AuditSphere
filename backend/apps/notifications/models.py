from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class NotificationType(models.TextChoices):
    AUDIT_ASSIGNED = "AUDIT_ASSIGNED", "New audit assignment"
    AUDIT_DUE_SOON = "AUDIT_DUE_SOON", "Upcoming audit deadline"
    AUDIT_SUBMITTED = "AUDIT_SUBMITTED", "Audit awaiting review"
    AUDIT_APPROVED = "AUDIT_APPROVED", "Audit approved"
    AUDIT_REWORK = "AUDIT_REWORK", "Audit returned for rework"
    FINDING_ASSIGNED = "FINDING_ASSIGNED", "Finding assigned"
    ACTION_ASSIGNED = "ACTION_ASSIGNED", "Corrective action assigned"
    ACTION_DUE_SOON = "ACTION_DUE_SOON", "Upcoming corrective-action deadline"
    ACTION_OVERDUE = "ACTION_OVERDUE", "Overdue corrective action"
    ACTION_VERIFICATION_REQUESTED = "ACTION_VERIFICATION_REQUESTED", "Action awaiting verification"
    ACTION_REJECTED = "ACTION_REJECTED", "Corrective-action closure rejected"
    ACTION_CLOSED = "ACTION_CLOSED", "Corrective action closed"


class Notification(TimeStampedModel):
    class EmailStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        SKIPPED = "SKIPPED", "Skipped"
        FAILED = "FAILED", "Failed"

    organization = models.ForeignKey("organizations.Organization", on_delete=models.CASCADE, related_name="+")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    notification_type = models.CharField(max_length=32, choices=NotificationType.choices)
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True)
    link = models.CharField(max_length=255, blank=True, help_text="Frontend route, e.g. /audits/12")
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.PositiveBigIntegerField(null=True, blank=True)
    # Same event + reminder period => same key => only one notification is ever created.
    dedupe_key = models.CharField(max_length=160, blank=True)
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    email_status = models.CharField(max_length=8, choices=EmailStatus.choices, default=EmailStatus.SKIPPED)
    emailed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "is_read", "-created_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["recipient", "dedupe_key"], condition=~models.Q(dedupe_key=""),
                name="uniq_notification_dedupe",
            )
        ]

    def __str__(self):
        return f"{self.recipient}: {self.title}"


class NotificationPreference(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="notification_preferences")
    notification_type = models.CharField(max_length=32, choices=NotificationType.choices)
    in_app = models.BooleanField(default=True)
    email = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "notification_type"], name="uniq_notification_pref"),
        ]
