"""Corrective / preventive action workflow with recorded status transitions."""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.accounts.roles import ADMIN_ROLES, Cap, Role
from apps.activity_logs.services import diff, log_activity, snapshot
from apps.core.exceptions import WorkflowError
from apps.core.files import file_metadata, validate_upload
from apps.core.models import Sequence
from apps.core.scoping import manages_department
from apps.findings.models import AuditFinding
from apps.findings.services import refresh_status_from_actions
from apps.notifications.models import NotificationType
from apps.notifications.services import notify, notify_many

from .models import ActionComment, ActionEvidence, ActionStatusChange, CorrectiveAction

S = CorrectiveAction.Status

TRANSITIONS = {
    "start": ((S.OPEN, S.REWORK_REQUIRED), S.IN_PROGRESS),
    "submit_verification": ((S.OPEN, S.IN_PROGRESS, S.REWORK_REQUIRED), S.PENDING_VERIFICATION),
    "approve": ((S.PENDING_VERIFICATION,), S.CLOSED),
    "reject": ((S.PENDING_VERIFICATION,), S.REWORK_REQUIRED),
    "reopen": ((S.CLOSED,), S.REWORK_REQUIRED),
}


def _link(action):
    return f"/actions/{action.id}"


def _lock(action):
    return CorrectiveAction.objects.select_for_update().select_related(
        "finding__audit", "department__manager", "owner", "organization__settings"
    ).get(pk=action.pk)


def _transition(user, action, name, note="", request=None):
    allowed, target = TRANSITIONS[name]
    if action.status not in allowed:
        raise WorkflowError(f"Cannot {name.replace('_', ' ')} an action that is {action.get_status_display().lower()}.")
    previous = action.status
    action.status = target
    ActionStatusChange.objects.create(action=action, from_status=previous, to_status=target, changed_by=user, note=note)
    log_activity(user, f"action.{name}", action, request=request,
                 changes={"status": {"from": previous, "to": target}, "note": note})
    return previous


def can_manage(user, action_or_department_id):
    department_id = getattr(action_or_department_id, "department_id", action_or_department_id)
    return user.can(Cap.MANAGE_ACTIONS) and manages_department(user, department_id)


def can_work_on(user, action):
    return action.owner_id == user.id or can_manage(user, action)


def can_verify(user, action):
    if not user.can(Cap.VERIFY_ACTIONS):
        return False
    if action.owner_id == user.id and not action.organization.settings.allow_self_verification:
        return False
    if user.role in ADMIN_ROLES:
        return True
    return action.finding.audit.reviewer_id == user.id


def verifiers_for(action):
    reviewer = action.finding.audit.reviewer
    if reviewer and reviewer.is_active:
        return [reviewer]
    return list(User.objects.filter(organization_id=action.organization_id, role=Role.AUDIT_ADMIN, is_active=True))


@transaction.atomic
def create_action(user, data, request=None):
    finding = data["finding"]
    if not can_manage(user, finding.department_id):
        raise PermissionDenied("Only administrators or the department's manager can assign corrective actions.")
    if finding.status not in AuditFinding.OPEN_STATES:
        raise WorkflowError("Actions cannot be added to a closed finding.")
    owner = data["owner"]
    if owner.organization_id != user.organization_id or not owner.is_active:
        raise ValidationError({"owner": ["Owner must be an active user in your organisation."]})
    action = CorrectiveAction.objects.create(
        organization=user.organization,
        reference=Sequence.next_reference(user.organization, "CA"),
        department=finding.department,
        created_by=user,
        **data,
    )
    ActionStatusChange.objects.create(action=action, from_status="", to_status=action.status, changed_by=user,
                                      note="Action created")
    refresh_status_from_actions(finding)
    _notify_assigned(action)
    log_activity(user, "action.created", action, request=request,
                 changes={"finding": finding.reference, "owner": owner.email, "due_date": action.due_date})
    return action


def _notify_assigned(action):
    notify(action.owner, NotificationType.ACTION_ASSIGNED, f"Corrective action {action.reference} assigned to you",
           f"'{action.title}' — due {action.due_date:%d %b %Y} ({action.get_priority_display()} priority).",
           link=_link(action), target=action, dedupe_key=f"action_assigned:{action.id}:{action.owner_id}")


OWNER_FIELDS = {"progress", "resolution_notes"}
MANAGER_FIELDS = {"title", "description", "owner", "due_date", "priority", "action_type"} | OWNER_FIELDS


@transaction.atomic
def update_action(user, action, data, request=None):
    action = _lock(action)
    if action.status == S.CLOSED:
        raise WorkflowError("Closed actions cannot be edited. Reopen the action first.")
    allowed = MANAGER_FIELDS if can_manage(user, action) else (OWNER_FIELDS if action.owner_id == user.id else set())
    forbidden = set(data) - allowed
    if not allowed or forbidden:
        raise PermissionDenied(f"You cannot change: {', '.join(sorted(forbidden)) or 'this action'}.")
    if "owner" in data and (data["owner"].organization_id != user.organization_id or not data["owner"].is_active):
        raise ValidationError({"owner": ["Owner must be an active user in your organisation."]})
    before = snapshot(action)
    previous_owner = action.owner_id
    for field, value in data.items():
        setattr(action, field, value)
    action.save()
    if action.owner_id != previous_owner:
        _notify_assigned(action)
    changes = diff(before, snapshot(action))
    if changes:
        log_activity(user, "action.updated", action, changes=changes, request=request)
    return action


@transaction.atomic
def start(user, action, request=None):
    action = _lock(action)
    if not can_work_on(user, action):
        raise PermissionDenied("Only the owner or the department manager can start this action.")
    _transition(user, action, "start", request=request)
    action.save(update_fields=["status", "updated_at"])
    refresh_status_from_actions(action.finding)
    return action


@transaction.atomic
def submit_for_verification(user, action, resolution_notes="", request=None):
    action = _lock(action)
    if not can_work_on(user, action):
        raise PermissionDenied("Only the owner or the department manager can request verification.")
    if resolution_notes:
        action.resolution_notes = resolution_notes
    if not action.resolution_notes.strip():
        raise ValidationError({"resolution_notes": ["Describe how the action was resolved."]})
    _transition(user, action, "submit_verification", note=action.resolution_notes, request=request)
    action.progress = 100
    action.submitted_at = timezone.now()
    action.save(update_fields=["status", "progress", "resolution_notes", "submitted_at", "updated_at"])
    refresh_status_from_actions(action.finding)
    notify_many(verifiers_for(action), NotificationType.ACTION_VERIFICATION_REQUESTED,
                f"Corrective action {action.reference} awaits verification",
                f"'{action.title}' was submitted by {user}.", link=_link(action), target=action,
                dedupe_key=f"action_verify:{action.id}:{action.submitted_at:%Y%m%d%H%M%S}")
    return action


@transaction.atomic
def verify(user, action, approved, notes="", request=None):
    action = _lock(action)
    if not can_verify(user, action):
        if action.owner_id == user.id:
            raise PermissionDenied("You cannot verify your own corrective action.")
        raise PermissionDenied("You are not authorised to verify this action.")
    if not approved and not (notes or "").strip():
        raise ValidationError({"notes": ["Explain why the evidence is insufficient."]})
    _transition(user, action, "approve" if approved else "reject", note=notes, request=request)
    action.verification_result = (CorrectiveAction.VerificationResult.EFFECTIVE if approved
                                  else CorrectiveAction.VerificationResult.NOT_EFFECTIVE)
    action.verification_notes = notes
    action.verified_by = user
    action.verified_at = timezone.now()
    action.closed_at = action.verified_at if approved else None
    action.save(update_fields=["status", "verification_result", "verification_notes", "verified_by", "verified_at",
                               "closed_at", "updated_at"])
    refresh_status_from_actions(action.finding)
    if approved:
        notify(action.owner, NotificationType.ACTION_CLOSED, f"Corrective action {action.reference} was closed",
               notes or f"Verified as effective by {user}.", link=_link(action), target=action,
               dedupe_key=f"action_closed:{action.id}:{action.verified_at:%Y%m%d%H%M%S}")
    else:
        notify_many([action.owner, action.department.manager], NotificationType.ACTION_REJECTED,
                    f"Closure of {action.reference} was rejected", notes, link=_link(action), target=action,
                    dedupe_key=f"action_rejected:{action.id}:{action.verified_at:%Y%m%d%H%M%S}")
    return action


@transaction.atomic
def reopen(user, action, notes, request=None):
    action = _lock(action)
    if not (user.can(Cap.VERIFY_ACTIONS) and (user.role in ADMIN_ROLES or action.finding.audit.reviewer_id == user.id)):
        raise PermissionDenied("Only the reviewer or an administrator can reopen actions.")
    if not (notes or "").strip():
        raise ValidationError({"notes": ["A reason is required to reopen an action."]})
    finding = action.finding
    if finding.status in (AuditFinding.Status.CLOSED, AuditFinding.Status.RISK_ACCEPTED):
        raise WorkflowError("Reopen the finding before reopening its actions.")
    _transition(user, action, "reopen", note=notes, request=request)
    action.closed_at = None
    action.save(update_fields=["status", "closed_at", "updated_at"])
    refresh_status_from_actions(finding)
    notify(action.owner, NotificationType.ACTION_REJECTED, f"Corrective action {action.reference} was reopened",
           notes, link=_link(action), target=action, dedupe_key=f"action_reopened:{action.id}:{timezone.now():%Y%m%d%H%M%S}")
    return action


@transaction.atomic
def add_comment(user, action, body, request=None):
    if user.role == Role.EXECUTIVE:
        raise PermissionDenied("Executive viewers have read-only access.")
    if not body.strip():
        raise ValidationError({"body": ["Comment cannot be empty."]})
    comment = ActionComment.objects.create(action=action, author=user, body=body)
    log_activity(user, "action.commented", action, request=request, changes={"comment_id": comment.id})
    return comment


@transaction.atomic
def add_evidence(user, action, uploaded, description="", request=None):
    if action.status == S.CLOSED:
        raise WorkflowError("Evidence cannot be added to a closed action.")
    if not can_work_on(user, action):
        raise PermissionDenied("Only the owner or the department manager can upload resolution evidence.")
    validate_upload(uploaded)
    evidence = ActionEvidence(organization_id=action.organization_id, action=action, uploaded_by=user,
                              description=description[:500], **file_metadata(uploaded))
    evidence.file.save(uploaded.name, uploaded, save=False)
    evidence.save()
    log_activity(user, "action.evidence_uploaded", action, request=request,
                 changes={"evidence_id": evidence.id, "file": evidence.original_name, "sha256": evidence.sha256})
    return evidence
