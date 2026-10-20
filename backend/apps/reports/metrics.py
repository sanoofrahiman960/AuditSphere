"""Dashboard and report metrics. All inputs are already-scoped querysets."""
from collections import OrderedDict
from datetime import date

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from apps.audit_templates.models import Severity
from apps.audits.models import Audit
from apps.audits.scoring import aggregate_score, percentage
from apps.corrective_actions.models import CorrectiveAction
from apps.findings.models import AuditFinding

S = Audit.Status
SCORED_STATES = (S.APPROVED, S.COMPLETED)
OPEN_AUDIT_STATES = (S.SCHEDULED, S.IN_PROGRESS, S.REWORK_REQUIRED, S.SUBMITTED)
SEVERITY_ORDER = [Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW]


def _f(value):
    return float(value) if value is not None else None


def overdue_audits(audits):
    return audits.exclude(status__in=Audit.CLOSED_STATES).exclude(status=S.DRAFT).filter(
        due_date__lt=timezone.localdate()
    )


def open_actions(actions):
    return actions.exclude(status=CorrectiveAction.Status.CLOSED)


def overdue_actions(actions):
    return open_actions(actions).filter(due_date__lt=timezone.localdate())


def open_findings(findings):
    return findings.filter(status__in=AuditFinding.OPEN_STATES)


def summary(audits, findings, actions, compliance_target=None):
    counts = dict(audits.values_list("status").annotate(n=Count("id")))
    scored = audits.filter(status__in=SCORED_STATES)
    open_f = open_findings(findings)
    return {
        "total_audits": sum(counts.values()),
        "draft_audits": counts.get(S.DRAFT, 0),
        "scheduled_audits": counts.get(S.SCHEDULED, 0),
        "in_progress_audits": counts.get(S.IN_PROGRESS, 0) + counts.get(S.REWORK_REQUIRED, 0),
        "awaiting_review_audits": counts.get(S.SUBMITTED, 0),
        "completed_audits": counts.get(S.APPROVED, 0) + counts.get(S.COMPLETED, 0),
        "cancelled_audits": counts.get(S.CANCELLED, 0),
        "overdue_audits": overdue_audits(audits).count(),
        "open_findings": open_f.count(),
        "critical_high_findings": open_f.filter(severity__in=[Severity.CRITICAL, Severity.HIGH]).count(),
        "open_actions": open_actions(actions).count(),
        "overdue_actions": overdue_actions(actions).count(),
        "failed_checks": scored.aggregate(n=Sum("non_compliant_count"))["n"] or 0,
        "compliance_score": _f(aggregate_score(scored)),
        "compliance_target": compliance_target,
    }


def status_distribution(audits):
    counts = dict(audits.values_list("status").annotate(n=Count("id")))
    return [{"status": value, "label": label, "count": counts.get(value, 0)} for value, label in S.choices]


def risk_distribution(findings):
    open_counts = dict(open_findings(findings).values_list("severity").annotate(n=Count("id")))
    all_counts = dict(findings.values_list("severity").annotate(n=Count("id")))
    return [
        {"severity": sev.value, "label": sev.label, "open": open_counts.get(sev, 0), "total": all_counts.get(sev, 0)}
        for sev in SEVERITY_ORDER
    ]


def department_breakdown(departments, audits, findings, actions):
    """One row per department: scores, audit counts, risk and action position."""
    today = timezone.localdate()
    audit_rows = {
        row["department_id"]: row
        for row in audits.values("department_id").annotate(
            total=Count("id"),
            completed=Count("id", filter=Q(status__in=SCORED_STATES)),
            open=Count("id", filter=Q(status__in=OPEN_AUDIT_STATES)),
            overdue=Count("id", filter=Q(status__in=OPEN_AUDIT_STATES, due_date__lt=today)),
            num=Sum("score_numerator", filter=Q(status__in=SCORED_STATES)),
            den=Sum("score_denominator", filter=Q(status__in=SCORED_STATES)),
            failed=Sum("non_compliant_count", filter=Q(status__in=SCORED_STATES)),
        )
    }
    finding_rows = {
        row["department_id"]: row
        for row in findings.values("department_id").annotate(
            open=Count("id", filter=Q(status__in=AuditFinding.OPEN_STATES)),
            critical=Count("id", filter=Q(status__in=AuditFinding.OPEN_STATES, severity=Severity.CRITICAL)),
            high=Count("id", filter=Q(status__in=AuditFinding.OPEN_STATES, severity=Severity.HIGH)),
            total=Count("id"),
        )
    }
    action_rows = {
        row["department_id"]: row
        for row in actions.values("department_id").annotate(
            open=Count("id", filter=~Q(status=CorrectiveAction.Status.CLOSED)),
            overdue=Count("id", filter=~Q(status=CorrectiveAction.Status.CLOSED) & Q(due_date__lt=today)),
            closed=Count("id", filter=Q(status=CorrectiveAction.Status.CLOSED)),
        )
    }
    rows = []
    for dept in departments:
        a = audit_rows.get(dept.id, {})
        fr = finding_rows.get(dept.id, {})
        ac = action_rows.get(dept.id, {})
        rows.append({
            "department_id": dept.id,
            "department": dept.name,
            "is_active": dept.is_active,
            "total_audits": a.get("total", 0),
            "completed_audits": a.get("completed", 0),
            "open_audits": a.get("open", 0),
            "overdue_audits": a.get("overdue", 0),
            "compliance_score": _f(percentage(a.get("num") or 0, a.get("den") or 0)),
            "failed_checks": a.get("failed") or 0,
            "total_findings": fr.get("total", 0),
            "open_findings": fr.get("open", 0),
            "critical_findings": fr.get("critical", 0),
            "high_findings": fr.get("high", 0),
            "open_actions": ac.get("open", 0),
            "overdue_actions": ac.get("overdue", 0),
            "closed_actions": ac.get("closed", 0),
        })
    return rows


def _month_start(d):
    return date(d.year, d.month, 1)


def _shift_month(d, months):
    index = d.year * 12 + d.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def period_key(d, period):
    if period == "quarter":
        return f"{d.year}-Q{(d.month - 1) // 3 + 1}"
    return f"{d.year}-{d.month:02d}"


def completion_trend(audits, months=12, period="month", end=None):
    """Per period: audits due, audits completed (approved/completed), on-time completions, score."""
    end = _month_start(end or timezone.localdate())
    start = _shift_month(end, -(months - 1))
    buckets = OrderedDict()
    cursor = start
    while cursor <= end:
        key = period_key(cursor, period)
        buckets.setdefault(key, {"period": key, "due": 0, "completed": 0, "on_time": 0, "num": 0, "den": 0})
        cursor = _shift_month(cursor, 1)

    for d in audits.filter(due_date__gte=start).exclude(status=S.CANCELLED).values_list("due_date", flat=True):
        key = period_key(d, period)
        if key in buckets:
            buckets[key]["due"] += 1

    done = audits.filter(status__in=SCORED_STATES).exclude(approved_at__isnull=True).filter(
        approved_at__date__gte=start
    ).values_list("approved_at", "due_date", "score_numerator", "score_denominator")
    for approved_at, due, num, den in done:
        key = period_key(timezone.localtime(approved_at).date(), period)
        if key not in buckets:
            continue
        b = buckets[key]
        b["completed"] += 1
        b["on_time"] += 1 if timezone.localtime(approved_at).date() <= due else 0
        b["num"] += num or 0
        b["den"] += den or 0

    result = []
    for b in buckets.values():
        result.append({
            "period": b["period"],
            "due": b["due"],
            "completed": b["completed"],
            "on_time": b["on_time"],
            "on_time_rate": _f(percentage(b["on_time"], b["completed"])),
            "compliance_score": _f(percentage(b["num"], b["den"])),
        })
    return result


def findings_by_period(findings, months=12, period="month"):
    end = _month_start(timezone.localdate())
    start = _shift_month(end, -(months - 1))
    rows = (findings.filter(created_at__date__gte=start).annotate(m=TruncMonth("created_at"))
            .values("m", "severity").annotate(n=Count("id")))
    result = {}
    for row in rows:
        key = period_key(row["m"].date() if hasattr(row["m"], "date") else row["m"], period)
        bucket = result.setdefault(key, {"raised": 0, "critical_high": 0})
        bucket["raised"] += row["n"]
        if row["severity"] in (Severity.CRITICAL, Severity.HIGH):
            bucket["critical_high"] += row["n"]
    return result


def auditor_workload(audits, findings):
    today = timezone.localdate()
    rows = audits.exclude(lead_auditor__isnull=True).values(
        "lead_auditor_id", "lead_auditor__first_name", "lead_auditor__last_name", "lead_auditor__email"
    ).annotate(
        assigned=Count("id"),
        open=Count("id", filter=Q(status__in=OPEN_AUDIT_STATES)),
        awaiting_review=Count("id", filter=Q(status=S.SUBMITTED)),
        completed=Count("id", filter=Q(status__in=SCORED_STATES)),
        overdue=Count("id", filter=Q(status__in=OPEN_AUDIT_STATES, due_date__lt=today)),
        num=Sum("score_numerator", filter=Q(status__in=SCORED_STATES)),
        den=Sum("score_denominator", filter=Q(status__in=SCORED_STATES)),
    ).order_by("-open", "-assigned")
    raised = dict(findings.values_list("audit__lead_auditor_id").annotate(n=Count("id")))
    return [
        {
            "auditor_id": r["lead_auditor_id"],
            "auditor": f"{r['lead_auditor__first_name']} {r['lead_auditor__last_name']}".strip()
            or r["lead_auditor__email"],
            "assigned": r["assigned"],
            "open": r["open"],
            "awaiting_review": r["awaiting_review"],
            "completed": r["completed"],
            "overdue": r["overdue"],
            "findings_raised": raised.get(r["lead_auditor_id"], 0),
            "average_score": _f(percentage(r["num"] or 0, r["den"] or 0)),
        }
        for r in rows
    ]
