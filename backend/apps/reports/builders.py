"""
Report definitions. Every report produces the same structure so that the
JSON preview, PDF and Excel exporters can render any of them:

{key, title, organization, generated_at, generated_by, filters[], summary[], chart|None, sections[]}
"""
from django.db.models import Count
from django.utils import timezone

from apps.corrective_actions.models import CorrectiveAction
from apps.core.scoping import visible_departments

from . import metrics
from .filters import actions_qs, audits_qs, describe_filters, findings_qs

PREVIEW_LIMIT = 500
EXPORT_LIMIT = 10000


def _d(value):
    return value.isoformat() if value else ""


def _name(user):
    return (user.full_name or user.email) if user else ""


def _pct(value):
    return f"{value:.1f}%" if value is not None else "—"


def col(*pairs):
    return [{"key": k, "label": label} for k, label in pairs]


AUDIT_COLUMNS = col(("reference", "Reference"), ("title", "Title"), ("department", "Department"),
                    ("audit_type", "Type"), ("status", "Status"), ("lead_auditor", "Lead auditor"),
                    ("reviewer", "Reviewer"), ("planned_start_date", "Planned start"), ("due_date", "Due"),
                    ("compliance_score", "Score %"), ("failed_checks", "Failed checks"), ("findings", "Findings"),
                    ("overdue", "Overdue"))
FINDING_COLUMNS = col(("reference", "Reference"), ("audit", "Audit"), ("department", "Department"),
                      ("title", "Finding"), ("severity", "Severity"), ("risk_score", "Risk score"),
                      ("status", "Status"), ("owner", "Owner"), ("target_date", "Target date"),
                      ("created", "Raised"))
ACTION_COLUMNS = col(("reference", "Reference"), ("finding", "Finding"), ("department", "Department"),
                     ("title", "Action"), ("action_type", "Type"), ("owner", "Owner"), ("priority", "Priority"),
                     ("status", "Status"), ("progress", "Progress %"), ("due_date", "Due"), ("overdue", "Overdue"),
                     ("verified_by", "Verified by"))


def audit_rows(qs, limit):
    rows = []
    for a in qs.annotate(n_findings=Count("findings", distinct=True)).order_by("due_date", "reference")[:limit]:
        rows.append({
            "reference": a.reference, "title": a.title, "department": a.department.name,
            "audit_type": a.get_audit_type_display(), "status": a.get_status_display(),
            "lead_auditor": _name(a.lead_auditor), "reviewer": _name(a.reviewer),
            "planned_start_date": _d(a.planned_start_date), "due_date": _d(a.due_date),
            "compliance_score": float(a.compliance_score) if a.compliance_score is not None else None,
            "failed_checks": a.non_compliant_count, "findings": a.n_findings,
            "overdue": "Yes" if a.is_overdue else "No",
        })
    return rows


def finding_rows(qs, limit):
    return [{
        "reference": f.reference, "audit": f.audit.reference, "department": f.department.name, "title": f.title,
        "severity": f.get_severity_display(), "risk_score": f.risk_score, "status": f.get_status_display(),
        "owner": _name(f.owner), "target_date": _d(f.target_date), "created": _d(f.created_at.date()),
    } for f in qs.order_by("-risk_score", "reference")[:limit]]


def action_rows(qs, limit):
    return [{
        "reference": a.reference, "finding": a.finding.reference, "department": a.department.name,
        "title": a.title, "action_type": a.get_action_type_display(), "owner": _name(a.owner),
        "priority": a.get_priority_display(), "status": a.get_status_display(), "progress": a.progress,
        "due_date": _d(a.due_date), "overdue": "Yes" if a.is_overdue else "No", "verified_by": _name(a.verified_by),
    } for a in qs.order_by("due_date", "reference")[:limit]]


def _summary_items(s):
    return [
        {"label": "Total audits", "value": s["total_audits"]},
        {"label": "Completed / approved", "value": s["completed_audits"]},
        {"label": "In progress", "value": s["in_progress_audits"]},
        {"label": "Awaiting review", "value": s["awaiting_review_audits"]},
        {"label": "Overdue audits", "value": s["overdue_audits"]},
        {"label": "Compliance score", "value": _pct(s["compliance_score"])},
        {"label": "Open findings", "value": s["open_findings"]},
        {"label": "Critical / high open findings", "value": s["critical_high_findings"]},
        {"label": "Open actions", "value": s["open_actions"]},
        {"label": "Overdue actions", "value": s["overdue_actions"]},
    ]


# --------------------------------------------------------------------------- builders

def build_audits(user, f, limit):
    audits = audits_qs(user, f)
    findings = findings_qs(user, {}).filter(audit__in=audits.values("id"))
    if f.get("severity"):
        findings = findings.filter(severity=f["severity"])
    actions = actions_qs(user, {}).filter(finding__in=findings.values("id"))
    if f.get("owner"):
        actions = actions.filter(owner_id=f["owner"])
    s = metrics.summary(audits, findings, actions)
    dist = [d for d in metrics.status_distribution(audits) if d["count"]]
    return {
        "summary": _summary_items(s),
        "chart": {"title": "Audits by status", "type": "bar", "labels": [d["label"] for d in dist],
                  "series": [{"name": "Audits", "values": [d["count"] for d in dist]}]},
        "sections": [
            {"title": "Audits", "columns": AUDIT_COLUMNS, "rows": audit_rows(audits, limit)},
            {"title": "Findings and risk levels", "columns": FINDING_COLUMNS, "rows": finding_rows(findings, limit)},
            {"title": "Corrective actions", "columns": ACTION_COLUMNS, "rows": action_rows(actions, limit)},
        ],
    }


DEPT_COLUMNS = col(("department", "Department"), ("total_audits", "Audits"), ("completed_audits", "Completed"),
                   ("compliance_score", "Score %"), ("failed_checks", "Failed checks"),
                   ("open_findings", "Open findings"), ("critical_findings", "Critical"), ("high_findings", "High"),
                   ("open_actions", "Open actions"), ("overdue_actions", "Overdue actions"))


def _departments(user, f):
    depts = visible_departments(user)
    if f.get("department"):
        depts = depts.filter(id=f["department"])
    return depts


def build_department_compliance(user, f, limit):
    audits, findings, actions = audits_qs(user, f), findings_qs(user, f), actions_qs(user, f)
    rows = metrics.department_breakdown(_departments(user, f), audits, findings, actions)
    scored = [r for r in rows if r["compliance_score"] is not None]
    target = user.organization.settings.compliance_target
    return {
        "summary": [
            {"label": "Departments", "value": len(rows)},
            {"label": "Overall compliance", "value": _pct(metrics.summary(audits, findings, actions)["compliance_score"])},
            {"label": "Compliance target", "value": f"{target}%"},
            {"label": "Departments below target", "value": sum(1 for r in scored if r["compliance_score"] < target)},
        ],
        "chart": {"title": "Compliance score by department", "type": "bar",
                  "labels": [r["department"] for r in scored],
                  "series": [{"name": "Score %", "values": [r["compliance_score"] for r in scored]}]},
        "sections": [{"title": "Department compliance", "columns": DEPT_COLUMNS, "rows": rows[:limit]}],
    }


def build_findings(user, f, limit):
    findings = findings_qs(user, f)
    dist = metrics.risk_distribution(findings)
    open_f = metrics.open_findings(findings)
    by_category = list(findings.values("risk_category").annotate(n=Count("id")).order_by("-n"))
    return {
        "summary": [
            {"label": "Findings", "value": findings.count()},
            {"label": "Open", "value": open_f.count()},
            *[{"label": f"{d['label']} (open / total)", "value": f"{d['open']} / {d['total']}"} for d in dist],
        ],
        "chart": {"title": "Findings by severity", "type": "bar", "labels": [d["label"] for d in dist],
                  "series": [{"name": "Open", "values": [d["open"] for d in dist]},
                             {"name": "Total", "values": [d["total"] for d in dist]}]},
        "sections": [
            {"title": "Findings", "columns": FINDING_COLUMNS, "rows": finding_rows(findings, limit)},
            {"title": "Findings by risk category", "columns": col(("category", "Risk category"), ("count", "Findings")),
             "rows": [{"category": r["risk_category"].title(), "count": r["n"]} for r in by_category]},
        ],
    }


def build_corrective_actions(user, f, limit):
    actions = actions_qs(user, f)
    counts = dict(actions.values_list("status").annotate(n=Count("id")))
    labels = [label for _, label in CorrectiveAction.Status.choices]
    values = [counts.get(value, 0) for value, _ in CorrectiveAction.Status.choices]
    return {
        "summary": [
            {"label": "Actions", "value": actions.count()},
            {"label": "Open", "value": metrics.open_actions(actions).count()},
            {"label": "Overdue", "value": metrics.overdue_actions(actions).count()},
            {"label": "Pending verification", "value": counts.get(CorrectiveAction.Status.PENDING_VERIFICATION, 0)},
            {"label": "Closed", "value": counts.get(CorrectiveAction.Status.CLOSED, 0)},
        ],
        "chart": {"title": "Actions by status", "type": "bar", "labels": labels,
                  "series": [{"name": "Actions", "values": values}]},
        "sections": [{"title": "Corrective and preventive actions", "columns": ACTION_COLUMNS,
                      "rows": action_rows(actions, limit)}],
    }


def build_overdue(user, f, limit):
    audits = metrics.overdue_audits(audits_qs(user, f))
    actions = metrics.overdue_actions(actions_qs(user, f))
    findings = findings_qs(user, f).filter(status__in=["OPEN", "IN_PROGRESS"],
                                           target_date__lt=timezone.localdate())
    return {
        "summary": [
            {"label": "Overdue audits", "value": audits.count()},
            {"label": "Overdue corrective actions", "value": actions.count()},
            {"label": "Findings past target date", "value": findings.count()},
        ],
        "chart": None,
        "sections": [
            {"title": "Overdue audits", "columns": AUDIT_COLUMNS, "rows": audit_rows(audits, limit)},
            {"title": "Overdue corrective actions", "columns": ACTION_COLUMNS, "rows": action_rows(actions, limit)},
            {"title": "Findings past target date", "columns": FINDING_COLUMNS, "rows": finding_rows(findings, limit)},
        ],
    }


def build_periodic(user, f, limit):
    period = f.get("period", "month")
    audits, findings = audits_qs(user, f), findings_qs(user, f)
    months = 24 if period == "quarter" else 12
    trend = metrics.completion_trend(audits, months=months, period=period, end=f.get("date_to"))
    raised = metrics.findings_by_period(findings, months=months, period=period)
    rows = [{**t, "findings_raised": raised.get(t["period"], {}).get("raised", 0),
             "critical_high": raised.get(t["period"], {}).get("critical_high", 0)} for t in trend]
    label = "Quarter" if period == "quarter" else "Month"
    return {
        "summary": [
            {"label": "Periods", "value": len(rows)},
            {"label": "Audits completed", "value": sum(r["completed"] for r in rows)},
            {"label": "Findings raised", "value": sum(r["findings_raised"] for r in rows)},
        ],
        "chart": {"title": f"Audits per {label.lower()}", "type": "bar", "labels": [r["period"] for r in rows],
                  "series": [{"name": "Due", "values": [r["due"] for r in rows]},
                             {"name": "Completed", "values": [r["completed"] for r in rows]}]},
        "sections": [{"title": f"{label}ly audit report", "columns": col(
            ("period", label), ("due", "Audits due"), ("completed", "Completed"), ("on_time", "On time"),
            ("on_time_rate", "On-time %"), ("compliance_score", "Score %"), ("findings_raised", "Findings raised"),
            ("critical_high", "Critical/high findings")), "rows": rows}],
    }


def build_auditor_workload(user, f, limit):
    rows = metrics.auditor_workload(audits_qs(user, f), findings_qs(user, f))
    return {
        "summary": [
            {"label": "Auditors", "value": len(rows)},
            {"label": "Open audits", "value": sum(r["open"] for r in rows)},
            {"label": "Overdue audits", "value": sum(r["overdue"] for r in rows)},
        ],
        "chart": {"title": "Open audits per auditor", "type": "bar", "labels": [r["auditor"] for r in rows],
                  "series": [{"name": "Open", "values": [r["open"] for r in rows]},
                             {"name": "Completed", "values": [r["completed"] for r in rows]}]},
        "sections": [{"title": "Auditor workload", "columns": col(
            ("auditor", "Auditor"), ("assigned", "Assigned"), ("open", "Open"), ("awaiting_review", "In review"),
            ("completed", "Completed"), ("overdue", "Overdue"), ("findings_raised", "Findings raised"),
            ("average_score", "Avg score %")), "rows": rows[:limit]}],
    }


def build_completion_trend(user, f, limit):
    rows = metrics.completion_trend(audits_qs(user, f), months=12, period=f.get("period", "month"),
                                    end=f.get("date_to"))
    completed = sum(r["completed"] for r in rows)
    on_time = sum(r["on_time"] for r in rows)
    return {
        "summary": [
            {"label": "Audits completed (12 months)", "value": completed},
            {"label": "Completed on time", "value": on_time},
            {"label": "On-time rate", "value": _pct(on_time * 100 / completed) if completed else "—"},
        ],
        "chart": {"title": "Audit completion trend", "type": "bar", "labels": [r["period"] for r in rows],
                  "series": [{"name": "Due", "values": [r["due"] for r in rows]},
                             {"name": "Completed", "values": [r["completed"] for r in rows]}]},
        "sections": [{"title": "Completion trend", "columns": col(
            ("period", "Period"), ("due", "Due"), ("completed", "Completed"), ("on_time", "On time"),
            ("on_time_rate", "On-time %"), ("compliance_score", "Score %")), "rows": rows}],
    }


def build_department_comparison(user, f, limit):
    audits, findings, actions = audits_qs(user, f), findings_qs(user, f), actions_qs(user, f)
    rows = metrics.department_breakdown(_departments(user, f), audits, findings, actions)
    for r in rows:
        r["action_closure_rate"] = (round(r["closed_actions"] * 100 / (r["closed_actions"] + r["open_actions"]), 1)
                                    if (r["closed_actions"] + r["open_actions"]) else None)
    rows.sort(key=lambda r: (r["compliance_score"] is None, -(r["compliance_score"] or 0)))
    return {
        "summary": [{"label": "Departments compared", "value": len(rows)}],
        "chart": {"title": "Open findings and overdue actions by department", "type": "bar",
                  "labels": [r["department"] for r in rows],
                  "series": [{"name": "Open findings", "values": [r["open_findings"] for r in rows]},
                             {"name": "Overdue actions", "values": [r["overdue_actions"] for r in rows]}]},
        "sections": [{"title": "Department comparison", "columns": DEPT_COLUMNS + col(
            ("open_audits", "Open audits"), ("overdue_audits", "Overdue audits"),
            ("action_closure_rate", "Action closure %")), "rows": rows[:limit]}],
    }


REPORTS = {
    "audits": ("Audit Summary Report", "Audits with their findings and corrective actions.", build_audits),
    "department-compliance": ("Department Compliance Report", "Compliance score and risk position per department.",
                              build_department_compliance),
    "findings": ("Findings and Risk Report", "Findings by severity, category and status.", build_findings),
    "corrective-actions": ("Corrective Action Status Report", "Status and progress of corrective actions.",
                           build_corrective_actions),
    "overdue": ("Overdue Items Report", "Overdue audits, actions and findings past target date.", build_overdue),
    "periodic": ("Monthly / Quarterly Audit Report", "Audit activity grouped by month or quarter.", build_periodic),
    "auditor-workload": ("Auditor Workload Report", "Assigned, open and completed audits per auditor.",
                         build_auditor_workload),
    "completion-trend": ("Audit Completion Trend", "Audits due versus completed, with on-time rate.",
                         build_completion_trend),
    "department-comparison": ("Department Comparison Report", "Side-by-side department performance.",
                              build_department_comparison),
}


def catalog():
    return [{"key": key, "title": title, "description": desc} for key, (title, desc, _) in REPORTS.items()]


def build_report(key, user, filters, limit=PREVIEW_LIMIT):
    title, _, builder = REPORTS[key]
    body = builder(user, filters, limit)
    return {
        "key": key,
        "title": title,
        "organization": user.organization.name,
        "generated_at": timezone.now().isoformat(),
        "generated_by": _name(user),
        "filters": [{"label": label, "value": value} for label, value in describe_filters(filters, user)],
        **body,
    }
