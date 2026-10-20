from django.conf import settings
from django.db import models

from apps.core.files import evidence_upload_to
from apps.core.models import OrgScopedModel


class PolicyDocument(OrgScopedModel):
    """An approved policy / SOP made searchable for retrieval-augmented answers."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending processing"
        PROCESSED = "PROCESSED", "Indexed"
        FAILED = "FAILED", "Failed"

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    version_label = models.CharField(max_length=50, blank=True)
    department = models.ForeignKey("departments.Department", on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="policy_documents")
    file = models.FileField(upload_to=evidence_upload_to, max_length=300)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    is_approved = models.BooleanField(default=False, help_text="Only approved documents are searchable.")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    page_count = models.PositiveIntegerField(default=0)
    chunk_count = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title


class PolicyChunk(models.Model):
    document = models.ForeignKey(PolicyDocument, on_delete=models.CASCADE, related_name="chunks")
    chunk_index = models.PositiveIntegerField()
    page_number = models.PositiveIntegerField(null=True, blank=True)
    text = models.TextField()
    point_id = models.CharField(max_length=40, blank=True, help_text="Qdrant point id")

    class Meta:
        ordering = ["document", "chunk_index"]
        constraints = [models.UniqueConstraint(fields=["document", "chunk_index"], name="uniq_chunk_index")]
