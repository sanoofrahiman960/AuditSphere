import json
import logging
import urllib.request

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import Notification

logger = logging.getLogger("auditsphere.notifications")


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_notification_email(self, notification_id):
    """Deliver one notification by email (SMTP) or via the n8n webhook when configured."""
    notification = (
        Notification.objects.select_related("recipient").filter(id=notification_id).first()
    )
    if notification is None or notification.email_status != Notification.EmailStatus.PENDING:
        return "skipped"
    url = f"{settings.FRONTEND_URL.rstrip('/')}{notification.link}" if notification.link else settings.FRONTEND_URL
    body = f"{notification.message}\n\nOpen in AuditSphere: {url}\n"
    try:
        if settings.N8N_WEBHOOK_URL:
            payload = json.dumps({
                "to": notification.recipient.email,
                "name": notification.recipient.full_name,
                "type": notification.notification_type,
                "subject": notification.title,
                "message": notification.message,
                "url": url,
            }).encode()
            request = urllib.request.Request(settings.N8N_WEBHOOK_URL, data=payload,
                                             headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=10):  # noqa: S310 (URL comes from settings)
                pass
        else:
            send_mail(f"[AuditSphere] {notification.title}", body, settings.DEFAULT_FROM_EMAIL,
                      [notification.recipient.email], fail_silently=False)
    except Exception as exc:  # network/SMTP errors
        logger.warning("Email for notification %s failed: %s", notification_id, exc)
        if not settings.CELERY_TASK_ALWAYS_EAGER and self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        Notification.objects.filter(id=notification_id).update(email_status=Notification.EmailStatus.FAILED)
        return "failed"
    Notification.objects.filter(id=notification_id).update(
        email_status=Notification.EmailStatus.SENT, emailed_at=timezone.now()
    )
    return "sent"


@shared_task
def run_reminders_task():
    from .reminders import run_reminders

    return run_reminders()
