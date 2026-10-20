"""Upload validation, metadata extraction and private file streaming."""
import hashlib
import mimetypes
import os
import uuid

from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from rest_framework.exceptions import ValidationError

# Executable / script content is refused whatever the extension claims.
_BLOCKED_SIGNATURES = (b"MZ", b"\x7fELF", b"#!")


def evidence_upload_to(instance, filename):
    """Random, non-guessable storage key partitioned by organisation."""
    ext = os.path.splitext(filename)[1].lower()[:10]
    org_id = getattr(instance, "organization_id", "x")
    now = timezone.now()
    return f"org_{org_id}/{instance._meta.model_name}/{now:%Y/%m}/{uuid.uuid4().hex}{ext}"


def validate_upload(uploaded):
    if uploaded is None:
        raise ValidationError({"file": ["No file was uploaded."]})
    if uploaded.size == 0:
        raise ValidationError({"file": ["File is empty."]})
    if uploaded.size > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise ValidationError({"file": [f"File exceeds the {settings.MAX_UPLOAD_SIZE_MB} MB limit."]})
    ext = os.path.splitext(uploaded.name)[1].lower().lstrip(".")
    if ext not in settings.ALLOWED_UPLOAD_EXTENSIONS:
        raise ValidationError({"file": [f"File type '.{ext}' is not allowed."]})
    head = uploaded.read(4)
    uploaded.seek(0)
    if any(head.startswith(sig) for sig in _BLOCKED_SIGNATURES):
        raise ValidationError({"file": ["Executable content is not allowed."]})


def file_metadata(uploaded):
    digest = hashlib.sha256()
    for chunk in uploaded.chunks():
        digest.update(chunk)
    uploaded.seek(0)
    return {
        "original_name": os.path.basename(uploaded.name)[:255],
        "content_type": mimetypes.guess_type(uploaded.name)[0] or "application/octet-stream",
        "size": uploaded.size,
        "sha256": digest.hexdigest(),
    }


def stream_file(file_field, original_name, content_type):
    response = FileResponse(
        file_field.open("rb"),
        as_attachment=True,
        filename=original_name,
        content_type=content_type or "application/octet-stream",
    )
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response
