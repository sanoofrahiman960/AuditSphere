"""Common report / dashboard filters parsed from query parameters."""
from rest_framework import serializers

from apps.audit_templates.models import Severity
from apps.audits.models import Audit
from apps.corrective_actions.models import CorrectiveAction
from apps.core.scoping import visible_actions, visible_audits, visible_findings
from apps.findings.models import AuditFinding


class ReportFilterSerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    department = serializers.IntegerField(required=False, min_value=1)
    audit_type = serializers.ChoiceField(choices=Audit.AuditType.choices, required=False)
    status = serializers.CharField(required=False, max_length=30)
    severity = serializers.ChoiceField(choices=Severity.choices, required=False)
    auditor = serializers.IntegerField(required=False, min_value=1)
    owner = serializers.IntegerField(required=False, min_value=1)
    period = serializers.ChoiceField(choices=[("month", "Monthly"), ("quarter", "Quarterly")], required=False,
                                     default="month")

    def validate(self, attrs):
        if attrs.get("date_from") and attrs.get("date_to") and attrs["date_from"] > attrs["date_to"]:
            raise serializers.ValidationError({"date_to": ["End date must be after start date."]})
        return attrs


def parse_filters(request):
    serializer = ReportFilterSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def describe_filters(filters, user):
    """Human-readable filter list for report headers."""
    from apps.accounts.models import User
    from apps.departments.models import Department

    labels = []
    if filters.get("date_from") or filters.get("date_to"):
        labels.append(("Date range", f"{filters.get('date_from') or '…'} to {filters.get('date_to') or '…'}"))
    if filters.get("department"):
        dept = Department.objects.filter(id=filters["department"], organization_id=user.organization_id).first()
        labels.append(("Department", dept.name if dept else "—"))
    if filters.get("audit_type"):
        labels.append(("Audit type", Audit.AuditType(filters["audit_type"]).label))
    if filters.get("status"):
        labels.append(("Status", filters["status"].replace("_", " ").title()))
    if filters.get("severity"):
        labels.append(("Risk severity", Severity(filters["severity"]).label))
    for key, label in (("auditor", "Auditor"), ("owner", "Action owner")):
        if filters.get(key):
            person = User.objects.filter(id=filters[key], organization_id=user.organization_id).first()
            labels.append((label, str(person) if person else "—"))
    return labels or [("Filters", "None (all records you are authorised to see)")]


def audits_qs(user, f):
    qs = visible_audits(user).select_related("department", "lead_auditor", "reviewer", "template_version__template")
    if f.get("date_from"):
        qs = qs.filter(due_date__gte=f["date_from"])
    if f.get("date_to"):
        qs = qs.filter(planned_start_date__lte=f["date_to"])
    if f.get("department"):
        qs = qs.filter(department_id=f["department"])
    if f.get("audit_type"):
        qs = qs.filter(audit_type=f["audit_type"])
    if f.get("status") and f["status"] in Audit.Status.values:
        qs = qs.filter(status=f["status"])
    if f.get("auditor"):
        qs = qs.filter(lead_auditor_id=f["auditor"])
    return qs


def findings_qs(user, f):
    qs = visible_findings(user).select_related("audit", "department", "owner")
    if f.get("date_from"):
        qs = qs.filter(created_at__date__gte=f["date_from"])
    if f.get("date_to"):
        qs = qs.filter(created_at__date__lte=f["date_to"])
    if f.get("department"):
        qs = qs.filter(department_id=f["department"])
    if f.get("audit_type"):
        qs = qs.filter(audit__audit_type=f["audit_type"])
    if f.get("severity"):
        qs = qs.filter(severity=f["severity"])
    if f.get("status") and f["status"] in AuditFinding.Status.values:
        qs = qs.filter(status=f["status"])
    if f.get("auditor"):
        qs = qs.filter(audit__lead_auditor_id=f["auditor"])
    if f.get("owner"):
        qs = qs.filter(owner_id=f["owner"])
    return qs


def actions_qs(user, f):
    qs = visible_actions(user).select_related("finding", "department", "owner", "verified_by")
    if f.get("date_from"):
        qs = qs.filter(due_date__gte=f["date_from"])
    if f.get("date_to"):
        qs = qs.filter(due_date__lte=f["date_to"])
    if f.get("department"):
        qs = qs.filter(department_id=f["department"])
    if f.get("audit_type"):
        qs = qs.filter(finding__audit__audit_type=f["audit_type"])
    if f.get("severity"):
        qs = qs.filter(finding__severity=f["severity"])
    if f.get("status") and f["status"] in CorrectiveAction.Status.values:
        qs = qs.filter(status=f["status"])
    if f.get("auditor"):
        qs = qs.filter(finding__audit__lead_auditor_id=f["auditor"])
    if f.get("owner"):
        qs = qs.filter(owner_id=f["owner"])
    return qs
