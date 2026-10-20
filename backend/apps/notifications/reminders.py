"""
Scheduled reminders: upcoming audit deadlines, upcoming action deadlines and overdue actions.

Idempotent: every reminder carries a dedupe key built from the object, its due
date and the reminder "bucket", so running the job several times a day (or
catching up after downtime) never sends the same reminder twice.
"""
import logging

from django.utils import timezone

from apps.audits.models import Audit
from apps.corrective_actions.models import CorrectiveAction
from apps.organizations.models import Organization

from .models import NotificationType
from .services import notify, notify_many

logger = logging.getLogger("auditsphere.notifications")


def reminder_bucket(days_left, reminder_days):
    """
    Smallest configured threshold that `days_left` has reached, e.g. with [7, 3, 1]
    and 2 days left -> 3. Returns None if the deadline is further away than every threshold.
    """
    reached = [d for d in reminder_days if days_left <= d]
    return min(reached) if reached else None


def run_reminders(today=None):
    today = today or timezone.localdate()
    totals = {"audit_due": 0, "action_due": 0, "action_overdue": 0}
    for org in Organization.objects.filter(is_active=True).select_related("settings"):
        settings = org.settings
        totals["audit_due"] += _audit_reminders(org, settings, today)
        due, overdue = _action_reminders(org, settings, today)
        totals["action_due"] += due
        totals["action_overdue"] += overdue
    logger.info("Reminder run complete: %s", totals)
    return totals


def _audit_reminders(org, settings, today):
    days = sorted(int(d) for d in settings.audit_reminder_days or [])
    if not days:
        return 0
    count = 0
    audits = Audit.objects.filter(
        organization=org,
        status__in=[Audit.Status.SCHEDULED, Audit.Status.IN_PROGRESS, Audit.Status.REWORK_REQUIRED],
        due_date__gte=today,
    ).select_related("lead_auditor")
    for audit in audits:
        bucket = reminder_bucket((audit.due_date - today).days, days)
        if bucket is None:
            continue
        team = [audit.lead_auditor] + [a.user for a in audit.assignments.filter(
            is_active=True, assignment_role="AUDITOR").select_related("user")]
        count += len(notify_many(
            team, NotificationType.AUDIT_DUE_SOON,
            f"Audit {audit.reference} is due {audit.due_date:%d %b %Y}",
            f"'{audit.title}' is due in {(audit.due_date - today).days} day(s). "
            f"Completion: {audit.completion_percentage}%.",
            link=f"/audits/{audit.id}", target=audit,
            dedupe_key=f"audit_due:{audit.id}:{audit.due_date:%Y%m%d}:{bucket}",
        ))
    return count


def _action_reminders(org, settings, today):
    days = sorted(int(d) for d in settings.action_reminder_days or [])
    interval = max(1, settings.overdue_reminder_interval_days)
    due_count = overdue_count = 0
    actions = CorrectiveAction.objects.filter(
        organization=org, status__in=CorrectiveAction.OPEN_STATES
    ).exclude(status=CorrectiveAction.Status.PENDING_VERIFICATION).select_related("owner", "department__manager")
    for action in actions:
        days_left = (action.due_date - today).days
        if days_left >= 0:
            bucket = reminder_bucket(days_left, days) if days else None
            if bucket is None:
                continue
            if notify(
                action.owner, NotificationType.ACTION_DUE_SOON,
                f"Corrective action {action.reference} is due {action.due_date:%d %b %Y}",
                f"'{action.title}' is due in {days_left} day(s). Current progress: {action.progress}%.",
                link=f"/actions/{action.id}", target=action,
                dedupe_key=f"action_due:{action.id}:{action.due_date:%Y%m%d}:{bucket}",
            ):
                due_count += 1
        else:
            days_overdue = -days_left
            period = (days_overdue - 1) // interval  # day 1, then every `interval` days
            recipients = [action.owner, action.department.manager]
            overdue_count += len(notify_many(
                recipients, NotificationType.ACTION_OVERDUE,
                f"Corrective action {action.reference} is overdue",
                f"'{action.title}' (owner: {action.owner}) was due {action.due_date:%d %b %Y} "
                f"and is {days_overdue} day(s) overdue.",
                link=f"/actions/{action.id}", target=action,
                dedupe_key=f"action_overdue:{action.id}:{action.due_date:%Y%m%d}:{period}",
            ))
    return due_count, overdue_count
