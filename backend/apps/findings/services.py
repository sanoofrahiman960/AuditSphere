"""Findings and the transparent risk-scoring rule (likelihood x impact against org thresholds)."""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.roles import ADMIN_ROLES, Cap
from apps.activity_logs.services import diff, log_activity, snapshot
from apps.audits.models import Audit
from apps.audits.services import can_execute, can_review
from apps.core.exceptions import WorkflowError
from apps.core.models import Sequence
from apps.notifications.models import NotificationType
from apps.notifications.services import notify

from .models import AuditFinding, RiskAssessment

# Default likelihood/impact when a finding is raised from a failed check with a configured severity.
SEVERITY_DEFAULTS = {"CRITICAL": (5, 4), "HIGH": (4, 3), "MEDIUM": (3, 2), "LOW": (2, 2)}

RISK_RULE_EXPLANATION = (
    "Risk score = likelihood (1–5) × impact (1–5). Severity is Critical when the score reaches the organisation's "
    "critical threshold, High at the high threshold, Medium at the medium threshold, otherwise Low. "
    "A reviewer or administrator may override the calculated severity with a recorded reason. "
    "AI suggestions never set severity."
)


def calculate_risk(organization, likelihood, impact):
    score = int(likelihood) * int(impact)
    return score, organization.settings.severity_for_score(score)


def risk_matrix(organization):
    s = organization.settings
    return {
        "critical_threshold": s.risk_critical_threshold,
        "high_threshold": s.risk_high_threshold,
        "medium_threshold": s.risk_medium_threshold,
        "explanation": RISK_RULE_EXPLANATION,
    }


def can_raise_finding(user, audit):
    if audit.status in Audit.EDITABLE_STATES and can_execute(user, audit):
        return True
    return audit.status in (Audit.Status.IN_PROGRESS, Audit.Status.REWORK_REQUIRED, Audit.Status.SUBMITTED,
                            Audit.Status.APPROVED) and can_review(user, audit)


def can_override_severity(user, finding):
    return user.role in ADMIN_ROLES or finding.audit.reviewer_id == user.id


def can_edit_finding(user, finding):
    audit = finding.audit
    if user.role in ADMIN_ROLES:
        return True
    if audit.reviewer_id == user.id:
        return True
    return can_execute(user, audit) and audit.status in Audit.EDITABLE_STATES


@transaction.atomic
def create_finding(user, data, request=None):
    audit = data["audit"]
    if not user.can(Cap.MANAGE_FINDINGS) or not can_raise_finding(user, audit):
        raise PermissionDenied("You cannot record findings for this audit in its current state.")
    question = data.get("question")
    if question is not None and question.section.version_id != audit.template_version_id:
        raise ValidationError({"question": ["Question is not part of this audit's checklist."]})
    response = None
    if question is not None:
        response = audit.responses.filter(question=question).first()
        data.setdefault("risk_category", question.risk_category)
        if "likelihood" not in data and "impact" not in data:
            data["likelihood"], data["impact"] = SEVERITY_DEFAULTS[question.failure_severity]
        data.setdefault("expected_requirement", question.guidance)

    likelihood = data.get("likelihood", 3)
    impact = data.get("impact", 3)
    score, severity = calculate_risk(audit.organization, likelihood, impact)
    finding = AuditFinding.objects.create(
        organization=audit.organization,
        reference=Sequence.next_reference(audit.organization, "FND"),
        department=audit.department,
        response=response,
        risk_score=score,
        severity=severity,
        created_by=user,
        **{**data, "likelihood": likelihood, "impact": impact},
    )
    RiskAssessment.objects.create(finding=finding, likelihood=likelihood, impact=impact, score=score,
                                  calculated_severity=severity, final_severity=severity,
                                  rationale="Initial assessment", assessed_by=user)
    if finding.owner_id:
        _notify_owner(finding)
    log_activity(user, "finding.created", finding, request=request,
                 changes={"audit": audit.reference, "severity": severity, "score": score})
    return finding


def _notify_owner(finding):
    notify(finding.owner, NotificationType.FINDING_ASSIGNED, f"Finding {finding.reference} assigned to you",
           f"{finding.get_severity_display()} risk: '{finding.title}' ({finding.department}).",
           link=f"/findings/{finding.id}", target=finding,
           dedupe_key=f"finding_assigned:{finding.id}:{finding.owner_id}")


@transaction.atomic
def update_finding(user, finding, data, request=None):
    finding = AuditFinding.objects.select_for_update().get(pk=finding.pk)
    if finding.status in (AuditFinding.Status.CLOSED, AuditFinding.Status.RISK_ACCEPTED):
        raise WorkflowError("Closed findings cannot be edited.")
    if not can_edit_finding(user, finding):
        raise PermissionDenied("You cannot edit this finding.")
    before = snapshot(finding)
    previous_owner = finding.owner_id
    for field, value in data.items():
        setattr(finding, field, value)
    finding.save()
    if "likelihood" in data or "impact" in data:
        _apply_assessment(user, finding, finding.likelihood, finding.impact, None, "Updated with finding edit")
    if finding.owner_id and finding.owner_id != previous_owner:
        _notify_owner(finding)
    changes = diff(before, snapshot(finding))
    if changes:
        log_activity(user, "finding.updated", finding, changes=changes, request=request)
    return finding


def _apply_assessment(user, finding, likelihood, impact, override_severity, rationale):
    score, calculated = calculate_risk(finding.organization, likelihood, impact)
    final = override_severity or calculated
    RiskAssessment.objects.create(finding=finding, likelihood=likelihood, impact=impact, score=score,
                                  calculated_severity=calculated, final_severity=final,
                                  is_override=bool(override_severity and override_severity != calculated),
                                  rationale=rationale, assessed_by=user)
    finding.likelihood, finding.impact, finding.risk_score = likelihood, impact, score
    finding.severity = final
    finding.severity_overridden = final != calculated
    finding.save(update_fields=["likelihood", "impact", "risk_score", "severity", "severity_overridden", "updated_at"])
    return finding


@transaction.atomic
def assess_risk(user, finding, likelihood, impact, override_severity=None, rationale="", request=None):
    finding = AuditFinding.objects.select_for_update().get(pk=finding.pk)
    if not can_edit_finding(user, finding):
        raise PermissionDenied("You cannot reassess this finding.")
    if override_severity:
        if not can_override_severity(user, finding):
            raise PermissionDenied("Only the reviewer or an administrator can override severity.")
        if not rationale.strip():
            raise ValidationError({"rationale": ["A reason is required to override the calculated severity."]})
    before = {"likelihood": finding.likelihood, "impact": finding.impact, "severity": finding.severity}
    _apply_assessment(user, finding, likelihood, impact, override_severity, rationale)
    log_activity(user, "finding.risk_assessed", finding, request=request, changes={
        "before": before,
        "after": {"likelihood": likelihood, "impact": impact, "severity": finding.severity},
        "override": finding.severity_overridden, "rationale": rationale,
    })
    return finding


@transaction.atomic
def close_finding(user, finding, notes, accept_risk=False, request=None):
    finding = AuditFinding.objects.select_for_update().get(pk=finding.pk)
    if finding.status in (AuditFinding.Status.CLOSED, AuditFinding.Status.RISK_ACCEPTED):
        raise WorkflowError("Finding is already closed.")
    if not (user.role in ADMIN_ROLES or finding.audit.reviewer_id == user.id):
        raise PermissionDenied("Only the reviewer or an administrator can close findings.")
    if not (notes or "").strip():
        raise ValidationError({"notes": ["Closure notes are required."]})
    if accept_risk and user.role not in ADMIN_ROLES:
        raise PermissionDenied("Only an administrator can accept a risk.")
    if not accept_risk and finding.actions.exclude(status="CLOSED").exists():
        raise WorkflowError("All corrective actions must be closed before the finding can be closed.")
    previous = finding.status
    finding.status = AuditFinding.Status.RISK_ACCEPTED if accept_risk else AuditFinding.Status.CLOSED
    finding.closed_at = timezone.now()
    finding.closed_by = user
    finding.closure_notes = notes
    finding.save(update_fields=["status", "closed_at", "closed_by", "closure_notes", "updated_at"])
    log_activity(user, "finding.risk_accepted" if accept_risk else "finding.closed", finding, request=request,
                 changes={"status": {"from": previous, "to": finding.status}, "notes": notes})
    return finding


@transaction.atomic
def reopen_finding(user, finding, notes, request=None):
    finding = AuditFinding.objects.select_for_update().get(pk=finding.pk)
    if finding.status not in (AuditFinding.Status.CLOSED, AuditFinding.Status.RISK_ACCEPTED):
        raise WorkflowError("Only closed findings can be reopened.")
    if not (user.role in ADMIN_ROLES or finding.audit.reviewer_id == user.id):
        raise PermissionDenied("Only the reviewer or an administrator can reopen findings.")
    if not (notes or "").strip():
        raise ValidationError({"notes": ["A reason is required."]})
    previous = finding.status
    finding.status = AuditFinding.Status.OPEN
    finding.closed_at = None
    finding.closed_by = None
    finding.save(update_fields=["status", "closed_at", "closed_by", "updated_at"])
    refresh_status_from_actions(finding)
    log_activity(user, "finding.reopened", finding, request=request,
                 changes={"status": {"from": previous, "to": finding.status}, "notes": notes})
    return finding


def refresh_status_from_actions(finding):
    """Derive OPEN / IN_PROGRESS / RESOLVED from the finding's corrective actions."""
    if finding.status not in AuditFinding.OPEN_STATES:
        return finding
    statuses = list(finding.actions.values_list("status", flat=True))
    if statuses and all(s == "CLOSED" for s in statuses):
        new = AuditFinding.Status.RESOLVED
    elif any(s != "OPEN" for s in statuses):
        new = AuditFinding.Status.IN_PROGRESS
    else:
        new = AuditFinding.Status.OPEN
    if new != finding.status:
        finding.status = new
        finding.save(update_fields=["status", "updated_at"])
    return finding
