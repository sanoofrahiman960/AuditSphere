"""Audit lifecycle: creation, assignment, checklist responses, evidence and state transitions."""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.roles import ADMIN_ROLES, Cap
from apps.activity_logs.services import log_activity
from apps.audit_templates.models import AuditQuestion, AuditTemplateVersion
from apps.core.exceptions import BusinessRuleError, WorkflowError
from apps.core.files import file_metadata, validate_upload
from apps.core.models import Sequence
from apps.core.scoping import is_audit_team_member
from apps.notifications.models import NotificationType
from apps.notifications.services import notify, notify_many

from . import scoring
from .models import Audit, AuditAssignment, AuditEvidence, AuditResponse, ReviewComment, ReviewDecision

S = Audit.Status


# --------------------------------------------------------------------------- helpers

def _lock(audit):
    return Audit.objects.select_for_update().select_related("template_version").get(pk=audit.pk)


def _require_state(audit, allowed, action):
    if audit.status not in allowed:
        raise WorkflowError(f"Cannot {action} an audit that is {audit.get_status_display().lower()}.")


def _audit_link(audit):
    return f"/audits/{audit.id}"


def team_users(audit):
    users = [audit.lead_auditor] if audit.lead_auditor else []
    users += [a.user for a in audit.assignments.filter(is_active=True, assignment_role="AUDITOR").select_related("user")]
    return users


def can_execute(user, audit):
    """Only the assigned audit team executes the checklist — administrators are not implicitly auditors."""
    return is_audit_team_member(user, audit)


def can_review(user, audit):
    """Assigned reviewer, or an administrator who is not part of the audit team (segregation of duties)."""
    if audit.reviewer_id == user.id:
        return True
    return user.role in ADMIN_ROLES and not is_audit_team_member(user, audit)


# --------------------------------------------------------------------------- create / assign

@transaction.atomic
def create_audit(user, data, request=None):
    team = data.pop("team_member_ids", None) or []
    version = data["template_version"]
    if version.status != AuditTemplateVersion.Status.APPROVED:
        raise ValidationError({"template_version": ["Only approved template versions can be used."]})
    audit = Audit.objects.create(
        organization=user.organization,
        reference=Sequence.next_reference(user.organization, "AUD"),
        created_by=user,
        **data,
    )
    sync_assignments(audit, user, team, notify_users=False)
    scoring.recalculate(audit)
    log_activity(user, "audit.created", audit, request=request,
                 changes={"status": audit.status, "template_version": version.id})
    return audit


def sync_assignments(audit, actor, team_member_ids=None, notify_users=True):
    """Keep AuditAssignment rows in line with lead_auditor / reviewer / co-auditors; notify new assignees."""
    desired = {}
    if audit.lead_auditor_id:
        desired[(audit.lead_auditor_id, AuditAssignment.AssignmentRole.LEAD_AUDITOR)] = audit.lead_auditor
    if audit.reviewer_id:
        desired[(audit.reviewer_id, AuditAssignment.AssignmentRole.REVIEWER)] = audit.reviewer
    if team_member_ids is not None:
        from apps.accounts.models import User

        for member in User.objects.filter(id__in=team_member_ids, organization_id=audit.organization_id):
            if member.id != audit.lead_auditor_id:
                desired[(member.id, AuditAssignment.AssignmentRole.AUDITOR)] = member

    current = {(a.user_id, a.assignment_role): a for a in audit.assignments.filter(is_active=True)}
    now = timezone.now()
    for key, assignment in current.items():
        keep = key in desired or (team_member_ids is None and key[1] == AuditAssignment.AssignmentRole.AUDITOR)
        if not keep:
            assignment.is_active = False
            assignment.ended_at = now
            assignment.save(update_fields=["is_active", "ended_at", "updated_at"])

    new_users = []
    for (user_id, role), member in desired.items():
        if (user_id, role) not in current:
            AuditAssignment.objects.create(audit=audit, user=member, assignment_role=role, assigned_by=actor)
            new_users.append((member, role))

    if notify_users and audit.status != S.DRAFT:
        for member, role in new_users:
            _notify_assignment(audit, member, role)
    return new_users


def _notify_assignment(audit, member, role):
    as_what = "reviewer" if role == AuditAssignment.AssignmentRole.REVIEWER else "auditor"
    notify(
        member, NotificationType.AUDIT_ASSIGNED,
        f"You are the {as_what} for audit {audit.reference}",
        f"'{audit.title}' ({audit.department}) — planned start {audit.planned_start_date:%d %b %Y}, "
        f"due {audit.due_date:%d %b %Y}.",
        link=_audit_link(audit), target=audit, dedupe_key=f"audit_assigned:{audit.id}:{role}:{member.id}",
    )


@transaction.atomic
def update_audit(user, audit, data, request=None):
    from apps.activity_logs.services import diff, snapshot

    audit = _lock(audit)
    if audit.status in (S.COMPLETED, S.CANCELLED):
        raise WorkflowError("Completed or cancelled audits cannot be edited. Reopen the audit first.")
    if audit.status not in (S.DRAFT, S.SCHEDULED):
        for locked in ("template_version", "department"):
            if locked in data and getattr(audit, locked) != data[locked]:
                raise WorkflowError(f"The {locked.replace('_', ' ')} cannot change once the audit has started.")
    if "template_version" in data and data["template_version"].status != AuditTemplateVersion.Status.APPROVED:
        raise ValidationError({"template_version": ["Only approved template versions can be used."]})

    team = data.pop("team_member_ids", None)
    before = snapshot(audit)
    for field, value in data.items():
        setattr(audit, field, value)
    audit.save()
    sync_assignments(audit, user, team)
    if "template_version" in data:
        scoring.recalculate(audit)
    changes = diff(before, snapshot(audit))
    if changes:
        log_activity(user, "audit.updated", audit, changes=changes, request=request)
    return audit


# --------------------------------------------------------------------------- transitions

@transaction.atomic
def schedule(user, audit, request=None):
    audit = _lock(audit)
    _require_state(audit, (S.DRAFT,), "schedule")
    missing = [f for f in ("lead_auditor", "reviewer") if not getattr(audit, f"{f}_id")]
    if missing:
        raise BusinessRuleError("Assign a lead auditor and a reviewer before scheduling.",
                                errors={f: ["Required to schedule."] for f in missing})
    audit.status = S.SCHEDULED
    audit.save(update_fields=["status", "updated_at"])
    for assignment in audit.assignments.filter(is_active=True).select_related("user"):
        _notify_assignment(audit, assignment.user, assignment.assignment_role)
    log_activity(user, "audit.scheduled", audit, request=request, changes={"status": {"from": "DRAFT", "to": S.SCHEDULED}})
    return audit


@transaction.atomic
def start(user, audit, request=None):
    audit = _lock(audit)
    _require_state(audit, (S.SCHEDULED, S.REWORK_REQUIRED), "start")
    if not can_execute(user, audit):
        raise PermissionDenied("Only the assigned audit team can start this audit.")
    previous = audit.status
    audit.status = S.IN_PROGRESS
    audit.started_at = audit.started_at or timezone.now()
    audit.save(update_fields=["status", "started_at", "updated_at"])
    log_activity(user, "audit.started", audit, request=request, changes={"status": {"from": previous, "to": S.IN_PROGRESS}})
    return audit


def validation_issues(audit):
    """Problems that block submission. Each issue: {question_id, code, message}."""
    issues = []
    for comment in audit.review_comments.filter(is_resolved=False).select_related("question"):
        label = (comment.question.code or f"Q{comment.question_id}") if comment.question_id else "Audit"
        issues.append({"question_id": comment.question_id, "code": "review_comment_open",
                       "message": f"{label}: reviewer comment not yet addressed — \"{comment.body[:80]}\""})
    questions = scoring.audit_questions(audit)
    responses = {r.question_id: r for r in audit.responses.prefetch_related("evidence", "findings")}
    for q in questions:
        r = responses.get(q.id)
        status = r.compliance if r else AuditResponse.Compliance.UNANSWERED
        label = q.code or f"Q{q.id}"
        if status == AuditResponse.Compliance.UNANSWERED:
            if q.is_mandatory:
                issues.append({"question_id": q.id, "code": "mandatory_unanswered",
                               "message": f"{label}: a response is mandatory."})
            continue
        if q.evidence_required and status != AuditResponse.Compliance.NOT_APPLICABLE and not r.evidence.exists():
            issues.append({"question_id": q.id, "code": "evidence_missing",
                           "message": f"{label}: supporting evidence is required."})
        if (status == AuditResponse.Compliance.NON_COMPLIANT and q.requires_corrective_action
                and not r.findings.exists()):
            issues.append({"question_id": q.id, "code": "finding_required",
                           "message": f"{label}: failed check requires a recorded finding."})
    return issues


@transaction.atomic
def submit(user, audit, request=None):
    audit = _lock(audit)
    _require_state(audit, (S.IN_PROGRESS,), "submit")
    if not can_execute(user, audit):
        raise PermissionDenied("Only the assigned audit team can submit this audit.")
    if not audit.reviewer_id:
        raise BusinessRuleError("A reviewer must be assigned before submission.")
    issues = validation_issues(audit)
    if issues:
        raise BusinessRuleError(
            f"The checklist is incomplete ({len(issues)} issue(s)).", code="incomplete_checklist",
            errors={"issues": issues},
        )
    scoring.recalculate(audit)
    audit.status = S.SUBMITTED
    audit.submitted_at = timezone.now()
    audit.save(update_fields=["status", "submitted_at", "updated_at"])
    notify(audit.reviewer, NotificationType.AUDIT_SUBMITTED, f"Audit {audit.reference} is awaiting your review",
           f"'{audit.title}' was submitted by {user}. Score: {audit.compliance_score or '—'}%.",
           link=_audit_link(audit), target=audit,
           dedupe_key=f"audit_submitted:{audit.id}:{audit.submitted_at:%Y%m%d%H%M%S}")
    log_activity(user, "audit.submitted", audit, request=request,
                 changes={"status": {"from": S.IN_PROGRESS, "to": S.SUBMITTED},
                          "compliance_score": audit.compliance_score})
    return audit


@transaction.atomic
def approve(user, audit, comments="", request=None):
    audit = _lock(audit)
    _require_state(audit, (S.SUBMITTED,), "approve")
    if not can_review(user, audit):
        raise PermissionDenied("Only the assigned reviewer can approve this audit.")
    ReviewDecision.objects.create(audit=audit, reviewer=user, decision=ReviewDecision.Decision.APPROVED,
                                  comments=comments)
    audit.status = S.APPROVED
    audit.approved_at = timezone.now()
    audit.save(update_fields=["status", "approved_at", "updated_at"])
    recipients = team_users(audit) + [audit.department.manager]
    notify_many(recipients, NotificationType.AUDIT_APPROVED, f"Audit {audit.reference} was approved",
                comments or f"'{audit.title}' was approved by {user}.", link=_audit_link(audit), target=audit,
                dedupe_key=f"audit_approved:{audit.id}:{audit.approved_at:%Y%m%d%H%M%S}")
    log_activity(user, "audit.approved", audit, request=request,
                 changes={"status": {"from": S.SUBMITTED, "to": S.APPROVED}, "comments": comments})
    return audit


@transaction.atomic
def request_rework(user, audit, comments, request=None):
    audit = _lock(audit)
    if not (comments or "").strip() and not audit.review_comments.filter(is_resolved=False).exists():
        raise ValidationError({"comments": ["Explain what needs to change, or add comments on specific questions."]})
    _require_state(audit, (S.SUBMITTED,), "return")
    if not can_review(user, audit):
        raise PermissionDenied("Only the assigned reviewer can request rework.")
    decision = ReviewDecision.objects.create(audit=audit, reviewer=user,
                                             decision=ReviewDecision.Decision.REWORK_REQUIRED, comments=comments)
    audit.status = S.REWORK_REQUIRED
    audit.save(update_fields=["status", "updated_at"])
    notify_many(team_users(audit), NotificationType.AUDIT_REWORK, f"Audit {audit.reference} needs rework",
                comments, link=_audit_link(audit), target=audit, dedupe_key=f"audit_rework:{decision.id}")
    log_activity(user, "audit.rework_requested", audit, request=request,
                 changes={"status": {"from": S.SUBMITTED, "to": S.REWORK_REQUIRED}, "comments": comments})
    return audit


@transaction.atomic
def complete(user, audit, request=None):
    audit = _lock(audit)
    _require_state(audit, (S.APPROVED,), "complete")
    if not (can_review(user, audit) or user.can(Cap.MANAGE_AUDITS)):
        raise PermissionDenied("Only the reviewer or an audit administrator can complete this audit.")
    scoring.recalculate(audit)
    audit.status = S.COMPLETED
    audit.completed_at = timezone.now()
    audit.save(update_fields=["status", "completed_at", "updated_at"])
    log_activity(user, "audit.completed", audit, request=request,
                 changes={"status": {"from": S.APPROVED, "to": S.COMPLETED}, "compliance_score": audit.compliance_score})
    return audit


@transaction.atomic
def cancel(user, audit, reason, request=None):
    if not (reason or "").strip():
        raise ValidationError({"reason": ["A reason is required to cancel an audit."]})
    audit = _lock(audit)
    _require_state(audit, (S.DRAFT, S.SCHEDULED, S.IN_PROGRESS, S.REWORK_REQUIRED, S.SUBMITTED), "cancel")
    previous = audit.status
    audit.status = S.CANCELLED
    audit.cancelled_at = timezone.now()
    audit.status_reason = reason
    audit.save(update_fields=["status", "cancelled_at", "status_reason", "updated_at"])
    log_activity(user, "audit.cancelled", audit, request=request,
                 changes={"status": {"from": previous, "to": S.CANCELLED}, "reason": reason})
    return audit


@transaction.atomic
def reopen(user, audit, reason, request=None):
    if not (reason or "").strip():
        raise ValidationError({"reason": ["A reason is required to reopen an audit."]})
    audit = _lock(audit)
    _require_state(audit, (S.APPROVED, S.COMPLETED, S.CANCELLED), "reopen")
    previous = audit.status
    if audit.started_at:
        audit.status = S.IN_PROGRESS
    elif audit.lead_auditor_id and audit.reviewer_id:
        audit.status = S.SCHEDULED
    else:
        audit.status = S.DRAFT
    audit.status_reason = reason
    audit.completed_at = None
    audit.approved_at = None
    audit.cancelled_at = None
    audit.save(update_fields=["status", "status_reason", "completed_at", "approved_at", "cancelled_at", "updated_at"])
    log_activity(user, "audit.reopened", audit, request=request,
                 changes={"status": {"from": previous, "to": audit.status}, "reason": reason})
    return audit


# --------------------------------------------------------------------------- review comments

@transaction.atomic
def add_review_comment(user, audit, body, question_id=None, request=None):
    """Reviewer feedback on a question (or the whole audit) while the audit is under review."""
    if audit.status != S.SUBMITTED:
        raise WorkflowError("Review comments can only be added while the audit is submitted for review.")
    if not can_review(user, audit):
        raise PermissionDenied("Only the reviewer can add review comments.")
    if not (body or "").strip():
        raise ValidationError({"body": ["Comment cannot be empty."]})
    question = None
    if question_id:
        question = AuditQuestion.objects.filter(id=question_id, section__version_id=audit.template_version_id).first()
        if question is None:
            raise ValidationError({"question_id": ["Question is not part of this audit."]})
    comment = ReviewComment.objects.create(audit=audit, question=question, author=user, body=body.strip())
    log_activity(user, "audit.review_comment_added", audit, request=request,
                 changes={"comment_id": comment.id, "question_id": question_id})
    return comment


@transaction.atomic
def resolve_review_comment(user, comment, note="", request=None):
    """The audit team marks a comment as addressed while reworking the audit."""
    comment = ReviewComment.objects.select_for_update().select_related("audit").get(pk=comment.pk)
    audit = comment.audit
    if comment.is_resolved:
        raise WorkflowError("This comment is already resolved.")
    if audit.status not in Audit.EDITABLE_STATES:
        raise WorkflowError("Comments are resolved while the audit is being reworked.")
    if not can_execute(user, audit):
        raise PermissionDenied("Only the audit team can resolve review comments.")
    comment.is_resolved = True
    comment.resolution_note = (note or "").strip()
    comment.resolved_by = user
    comment.resolved_at = timezone.now()
    comment.save(update_fields=["is_resolved", "resolution_note", "resolved_by", "resolved_at", "updated_at"])
    if audit.status == S.REWORK_REQUIRED:
        # Addressing feedback is rework — resume the audit, as saving responses does.
        Audit.objects.filter(pk=audit.pk).update(status=S.IN_PROGRESS, updated_at=timezone.now())
    log_activity(user, "audit.review_comment_resolved", audit, request=request,
                 changes={"comment_id": comment.id, "note": comment.resolution_note})
    return comment


# --------------------------------------------------------------------------- execution

RESPONSE_VALUE_FIELDS = ("choice_value", "text_value", "number_value", "date_value", "rating_value",
                         "is_not_applicable", "manual_assessment", "observation", "recommendation", "risk_flagged")


def _validate_response_value(question, item):
    RT = AuditQuestion.ResponseType
    choice = item.get("choice_value") or ""
    allowed = {
        RT.YES_NO: {"YES", "NO"},
        RT.YES_NO_NA: {"YES", "NO", "NA"},
        RT.PASS_FAIL: {"PASS", "FAIL"},
    }.get(question.response_type)
    if choice and (allowed is None or choice not in allowed):
        raise ValidationError({"responses": [f"Invalid answer '{choice}' for question {question.id}."]})
    rating = item.get("rating_value")
    if rating is not None and question.response_type == RT.RATING and not (1 <= rating <= question.rating_max):
        raise ValidationError({"responses": [f"Rating for question {question.id} must be 1–{question.rating_max}."]})
    if item.get("manual_assessment") and question.is_scored:
        raise ValidationError({"responses": [f"Question {question.id} is scored automatically."]})


@transaction.atomic
def save_responses(user, audit, items, overall=None, request=None):
    """Upsert checklist answers (draft save). Allowed only while the audit is being executed."""
    audit = _lock(audit)
    if audit.status not in Audit.EDITABLE_STATES:
        raise WorkflowError("Responses can only be changed while the audit is in progress.")
    if not can_execute(user, audit):
        raise PermissionDenied("Only the assigned audit team can record responses.")
    if audit.status == S.REWORK_REQUIRED:
        # Editing during rework implicitly resumes the audit.
        audit.status = S.IN_PROGRESS
        audit.save(update_fields=["status", "updated_at"])

    questions = {q.id: q for q in scoring.audit_questions(audit)}
    existing = {r.question_id: r for r in audit.responses.select_for_update()}
    changed = []
    for item in items:
        question = questions.get(item["question_id"])
        if question is None:
            raise ValidationError({"responses": [f"Question {item['question_id']} is not part of this audit."]})
        _validate_response_value(question, item)
        response = existing.get(question.id) or AuditResponse(audit=audit, question=question)
        before = {f: getattr(response, f) for f in RESPONSE_VALUE_FIELDS} if response.pk else {}
        for field in RESPONSE_VALUE_FIELDS:
            if field in item:
                value = item[field]
                if value is None and field in ("choice_value", "text_value", "manual_assessment",
                                                "observation", "recommendation"):
                    value = ""
                setattr(response, field, value)
        response.compliance = scoring.evaluate(question, response)
        response.answered_by = user
        response.save()
        after = {f: getattr(response, f) for f in RESPONSE_VALUE_FIELDS}
        if before != after:
            changed.append({"question_id": question.id, "compliance": response.compliance,
                            "changes": {k: {"from": before.get(k), "to": v} for k, v in after.items()
                                        if before.get(k) != v}})

    update_fields = []
    for field in ("overall_summary", "overall_recommendation"):
        if overall and field in overall and overall[field] is not None:
            setattr(audit, field, overall[field])
            update_fields.append(field)
    if update_fields:
        audit.save(update_fields=update_fields + ["updated_at"])

    scoring.recalculate(audit)
    if changed:
        log_activity(user, "audit.responses_saved", audit, request=request,
                     changes={"count": len(changed), "responses": changed[:50]})
    return audit


@transaction.atomic
def add_evidence(user, audit, uploaded, *, response_id=None, finding_id=None, description="", request=None):
    if audit.status in (S.COMPLETED, S.CANCELLED):
        raise WorkflowError("Evidence cannot be added to a completed or cancelled audit.")
    if not (can_execute(user, audit) or can_review(user, audit)):
        raise PermissionDenied("Only the audit team or reviewer can upload evidence.")
    validate_upload(uploaded)
    response = None
    if response_id:
        response = audit.responses.filter(id=response_id).first()
        if response is None:
            raise ValidationError({"response_id": ["Response does not belong to this audit."]})
    finding = None
    if finding_id:
        finding = audit.findings.filter(id=finding_id).first()
        if finding is None:
            raise ValidationError({"finding_id": ["Finding does not belong to this audit."]})
    evidence = AuditEvidence(organization_id=audit.organization_id, audit=audit, response=response, finding=finding,
                             description=description[:500], uploaded_by=user, **file_metadata(uploaded))
    evidence.file.save(uploaded.name, uploaded, save=False)
    evidence.save()
    log_activity(user, "evidence.uploaded", audit, request=request,
                 changes={"evidence_id": evidence.id, "file": evidence.original_name, "sha256": evidence.sha256,
                          "response_id": response_id, "finding_id": finding_id})
    return evidence


@transaction.atomic
def delete_evidence(user, evidence, request=None):
    audit = evidence.audit
    if audit.status not in Audit.EDITABLE_STATES:
        raise WorkflowError("Evidence can only be removed while the audit is in progress.")
    if evidence.uploaded_by_id != user.id and not user.can(Cap.MANAGE_AUDITS):
        raise PermissionDenied("Only the uploader can remove this evidence.")
    log_activity(user, "evidence.deleted", audit, request=request,
                 changes={"evidence_id": evidence.id, "file": evidence.original_name, "sha256": evidence.sha256})
    evidence.file.delete(save=False)
    evidence.delete()
