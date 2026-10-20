import hashlib
import json

from django.conf import settings
from django.db import models


class AppendOnlyError(Exception):
    pass


class AuditActivityLog(models.Model):
    """
    Append-only, hash-chained activity history.

    Each row's hash covers its own content plus the previous row's hash (per
    organisation), so editing or deleting a historical row breaks the chain and
    is detected by `manage.py verify_activity_log`.
    """

    organization = models.ForeignKey("organizations.Organization", on_delete=models.PROTECT, null=True,
                                     related_name="+")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name="+")
    actor_email = models.CharField(max_length=254, blank=True)
    action = models.CharField(max_length=60, db_index=True, help_text="e.g. audit.submitted")
    object_type = models.CharField(max_length=60, db_index=True)
    object_id = models.CharField(max_length=40, blank=True, db_index=True)
    object_repr = models.CharField(max_length=255, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    request_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(db_index=True)
    prev_hash = models.CharField(max_length=64, blank=True)
    hash = models.CharField(max_length=64)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["organization", "-created_at"]),
                   models.Index(fields=["object_type", "object_id"])]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor_email} {self.action} {self.object_repr}"

    def compute_hash(self):
        payload = {
            "org": self.organization_id,
            "actor": self.actor_email,
            "action": self.action,
            "object_type": self.object_type,
            "object_id": self.object_id,
            "object_repr": self.object_repr,
            "changes": self.changes,
            "created_at": self.created_at.isoformat(),
            "prev": self.prev_hash,
        }
        canonical = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise AppendOnlyError("Activity log entries cannot be modified.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AppendOnlyError("Activity log entries cannot be deleted.")
