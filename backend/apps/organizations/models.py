from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import TimeStampedModel


def default_reminder_days():
    return [7, 3, 1]


class Organization(TimeStampedModel):
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=80, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class OrganizationSettings(TimeStampedModel):
    """Configurable rules for one organisation. Created automatically with the organisation."""

    organization = models.OneToOneField(Organization, on_delete=models.CASCADE, related_name="settings")

    # Risk score = likelihood (1-5) x impact (1-5). Score >= threshold => severity.
    risk_critical_threshold = models.PositiveSmallIntegerField(
        default=20, validators=[MinValueValidator(1), MaxValueValidator(25)]
    )
    risk_high_threshold = models.PositiveSmallIntegerField(
        default=12, validators=[MinValueValidator(1), MaxValueValidator(25)]
    )
    risk_medium_threshold = models.PositiveSmallIntegerField(
        default=6, validators=[MinValueValidator(1), MaxValueValidator(25)]
    )

    compliance_target = models.PositiveSmallIntegerField(
        default=85, validators=[MaxValueValidator(100)], help_text="Target compliance % shown on dashboards."
    )

    audit_reminder_days = models.JSONField(default=default_reminder_days, blank=True)
    action_reminder_days = models.JSONField(default=default_reminder_days, blank=True)
    overdue_reminder_interval_days = models.PositiveSmallIntegerField(
        default=7, help_text="Repeat overdue-action reminders every N days."
    )

    allow_self_verification = models.BooleanField(
        default=False, help_text="Allow an action owner to verify their own corrective action."
    )
    email_notifications_enabled = models.BooleanField(default=True)

    def __str__(self):
        return f"Settings for {self.organization}"

    def severity_for_score(self, score):
        if score >= self.risk_critical_threshold:
            return "CRITICAL"
        if score >= self.risk_high_threshold:
            return "HIGH"
        if score >= self.risk_medium_threshold:
            return "MEDIUM"
        return "LOW"
