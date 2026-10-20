from django.db import models, transaction
from django.utils import timezone


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class OrgScopedModel(TimeStampedModel):
    """Base class for every tenant-owned row."""

    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="+", db_index=True
    )

    class Meta:
        abstract = True


class Sequence(models.Model):
    """Per-organisation counters used to build human readable reference numbers."""

    organization = models.ForeignKey("organizations.Organization", on_delete=models.CASCADE, related_name="+")
    key = models.CharField(max_length=40)
    value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "key"], name="uniq_sequence_per_org")]

    @classmethod
    def next_reference(cls, organization, prefix):
        """Return e.g. AUD-2026-0007, unique within the organisation."""
        key = f"{prefix}-{timezone.now().year}"
        with transaction.atomic():
            seq, _ = cls.objects.select_for_update().get_or_create(organization=organization, key=key)
            seq.value += 1
            seq.save(update_fields=["value"])
        return f"{key}-{seq.value:04d}"
