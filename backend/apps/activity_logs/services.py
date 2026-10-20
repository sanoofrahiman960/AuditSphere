import json
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models, transaction
from django.utils import timezone

from .models import AuditActivityLog

IGNORED_FIELDS = {"updated_at", "created_at", "password", "last_login"}


def _client_ip(request):
    if request is None:
        return None
    if getattr(settings, "TRUST_X_FORWARDED_FOR", False):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:45]
    return request.META.get("REMOTE_ADDR")


def _plain(value):
    if isinstance(value, models.Model):
        return value.pk
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "name") and hasattr(value, "url"):  # FieldFile
        return value.name
    return value


def snapshot(instance):
    """Serialisable dict of concrete field values, used to diff before/after an update."""
    data = {}
    for field in instance._meta.concrete_fields:
        if field.name in IGNORED_FIELDS:
            continue
        data[field.name] = _plain(getattr(instance, field.attname))
    return data


def diff(before, after):
    return {
        key: {"from": before.get(key), "to": value}
        for key, value in after.items()
        if before.get(key) != value
    }


def log_activity(actor, action, obj=None, *, changes=None, request=None, organization=None,
                 object_type=None, object_id=None, object_repr=None):
    """Append one entry to the organisation's hash-chained activity log."""
    if organization is None:
        organization = getattr(obj, "organization", None) or getattr(actor, "organization", None)
    actor_obj = actor if getattr(actor, "is_authenticated", False) else None
    normalised = json.loads(json.dumps(changes or {}, cls=DjangoJSONEncoder))

    with transaction.atomic():
        last = (
            AuditActivityLog.objects.select_for_update()
            .filter(organization=organization)
            .order_by("-id")
            .first()
        )
        entry = AuditActivityLog(
            organization=organization,
            actor=actor_obj,
            actor_email=getattr(actor_obj, "email", "") or "system",
            action=action,
            object_type=object_type or (obj._meta.label_lower if obj is not None else ""),
            object_id=str(object_id if object_id is not None else getattr(obj, "pk", "") or ""),
            object_repr=(object_repr or (str(obj) if obj is not None else ""))[:255],
            changes=normalised,
            ip_address=_client_ip(request),
            user_agent=(request.META.get("HTTP_USER_AGENT", "")[:255] if request else ""),
            request_id=getattr(request, "request_id", "") if request else "",
            created_at=timezone.now(),
            prev_hash=last.hash if last else "",
        )
        entry.hash = entry.compute_hash()
        entry.save()
    return entry


def verify_chain(organization):
    """Return a list of ids whose hash or link is broken (empty list = intact)."""
    broken = []
    prev = ""
    for entry in AuditActivityLog.objects.filter(organization=organization).order_by("id").iterator():
        if entry.prev_hash != prev or entry.compute_hash() != entry.hash:
            broken.append(entry.id)
        prev = entry.hash
    return broken
