import logging

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Notification, NotificationPreference

logger = logging.getLogger("auditsphere.notifications")


def notify(recipient, notification_type, title, message="", *, link="", target=None, dedupe_key=""):
    """
    Create an in-app notification and queue an email if the recipient wants one.

    `dedupe_key` identifies the event + reminder period; a second call with the
    same key for the same recipient is a no-op, so reminders are never duplicated.
    """
    if recipient is None or not recipient.is_active or not recipient.organization_id:
        return None
    if dedupe_key and Notification.objects.filter(recipient=recipient, dedupe_key=dedupe_key).exists():
        return None

    pref = NotificationPreference.objects.filter(user=recipient, notification_type=notification_type).first()
    want_in_app = pref.in_app if pref else True
    want_email = pref.email if pref else True
    org_settings = recipient.organization.settings
    send_email = bool(want_email and org_settings.email_notifications_enabled and recipient.email)

    try:
        with transaction.atomic():
            notification = Notification.objects.create(
                organization_id=recipient.organization_id,
                recipient=recipient,
                notification_type=notification_type,
                title=title[:255],
                message=message,
                link=link,
                target_type=target._meta.model_name if target is not None else "",
                target_id=target.pk if target is not None else None,
                dedupe_key=dedupe_key,
                # Users who switched off in-app delivery still get the record (for audit), pre-read.
                is_read=not want_in_app,
                read_at=None if want_in_app else timezone.now(),
                email_status=Notification.EmailStatus.PENDING if send_email else Notification.EmailStatus.SKIPPED,
            )
    except IntegrityError:
        return None  # concurrent duplicate

    if send_email:
        from .tasks import send_notification_email

        transaction.on_commit(lambda: send_notification_email.delay(notification.id))
    return notification


def notify_many(recipients, *args, **kwargs):
    seen = set()
    created = []
    for user in recipients:
        if user is None or user.id in seen:
            continue
        seen.add(user.id)
        result = notify(user, *args, **kwargs)
        if result:
            created.append(result)
    return created
