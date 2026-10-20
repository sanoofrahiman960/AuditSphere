from django.http import Http404, HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.roles import Cap
from apps.activity_logs.models import AuditActivityLog
from apps.activity_logs.services import log_activity
from apps.audits.models import Audit
from apps.audits.scoring import SCORING_EXPLANATION
from apps.core.permissions import IsOrgMember, capability_required
from apps.core.scoping import visible_audits, visible_departments
from apps.findings.services import RISK_RULE_EXPLANATION

from . import metrics
from .builders import EXPORT_LIMIT, REPORTS, build_report, catalog
from .exporters import render_excel, render_pdf
from .filters import actions_qs, audits_qs, findings_qs, parse_filters


class DashboardView(APIView):
    permission_classes = [IsOrgMember]

    def scoped(self, request):
        f = parse_filters(request)
        return f, audits_qs(request.user, f), findings_qs(request.user, f), actions_qs(request.user, f)


class DashboardSummaryView(DashboardView):
    def get(self, request):
        f, audits, findings, actions = self.scoped(request)
        data = metrics.summary(audits, findings, actions, request.user.organization.settings.compliance_target)
        data["scoring_explanation"] = SCORING_EXPLANATION
        data["risk_explanation"] = RISK_RULE_EXPLANATION
        return Response(data)


class StatusDistributionView(DashboardView):
    def get(self, request):
        _, audits, _, _ = self.scoped(request)
        return Response(metrics.status_distribution(audits))


class RiskDistributionView(DashboardView):
    def get(self, request):
        _, _, findings, _ = self.scoped(request)
        return Response(metrics.risk_distribution(findings))


class DepartmentComplianceView(DashboardView):
    def get(self, request):
        f, audits, findings, actions = self.scoped(request)
        departments = visible_departments(request.user).filter(is_active=True)
        if f.get("department"):
            departments = departments.filter(id=f["department"])
        return Response(metrics.department_breakdown(departments, audits, findings, actions))


class MonthlyTrendView(DashboardView):
    def get(self, request):
        f, audits, _, _ = self.scoped(request)
        return Response(metrics.completion_trend(audits, months=12, period=f.get("period", "month")))


class UpcomingAuditsView(DashboardView):
    def get(self, request):
        today = timezone.localdate()
        qs = visible_audits(request.user).filter(
            status__in=[Audit.Status.SCHEDULED, Audit.Status.IN_PROGRESS, Audit.Status.REWORK_REQUIRED],
            due_date__gte=today,
        ).select_related("department", "lead_auditor").order_by("due_date")[:10]
        return Response([
            {"id": a.id, "reference": a.reference, "title": a.title, "department": a.department.name,
             "status": a.status, "planned_start_date": a.planned_start_date, "due_date": a.due_date,
             "days_left": (a.due_date - today).days, "completion_percentage": a.completion_percentage,
             "lead_auditor": a.lead_auditor.full_name if a.lead_auditor else None}
            for a in qs
        ])


class RecentActivityView(DashboardView):
    def get(self, request):
        user = request.user
        logs = AuditActivityLog.objects.filter(organization_id=user.organization_id).exclude(
            action__startswith="auth.")
        if not user.can(Cap.VIEW_ACTIVITY_LOGS):
            audit_ids = [str(i) for i in visible_audits(user).values_list("id", flat=True)[:2000]]
            logs = logs.filter(object_type="audits.audit", object_id__in=audit_ids)
        logs = logs.select_related("actor")[:15]
        return Response([
            {"id": log.id, "created_at": log.created_at, "actor": log.actor.full_name if log.actor else log.actor_email,
             "action": log.action, "object_type": log.object_type, "object_id": log.object_id,
             "object_repr": log.object_repr}
            for log in logs
        ])


class OverdueActionsView(DashboardView):
    def get(self, request):
        _, _, _, actions = self.scoped(request)
        today = timezone.localdate()
        qs = metrics.overdue_actions(actions).select_related("owner", "department", "finding").order_by("due_date")[:10]
        return Response([
            {"id": a.id, "reference": a.reference, "title": a.title, "department": a.department.name,
             "owner": a.owner.full_name, "due_date": a.due_date, "days_overdue": (today - a.due_date).days,
             "status": a.status, "priority": a.priority, "finding_severity": a.finding.severity}
            for a in qs
        ])


class MyWorkView(APIView):
    """
    The caller's personal to-do list, derived from assignments rather than role:
    audits to perform, audits to review/complete, actions to verify, own actions, and
    overdue actions in departments they manage.
    """

    permission_classes = [IsOrgMember]
    LIMIT = 8

    def get(self, request):
        from apps.audits.models import AuditAssignment
        from apps.corrective_actions.models import CorrectiveAction
        from apps.corrective_actions.services import can_verify
        from apps.core.scoping import managed_department_ids, visible_actions

        user = request.user
        today = timezone.localdate()
        S = Audit.Status

        team_audit_ids = AuditAssignment.objects.filter(
            user=user, is_active=True, assignment_role__in=["LEAD_AUDITOR", "AUDITOR"]
        ).values("audit_id")
        to_perform = (visible_audits(user)
                      .filter(id__in=team_audit_ids, status__in=[S.SCHEDULED, S.IN_PROGRESS, S.REWORK_REQUIRED])
                      .select_related("department").order_by("due_date"))
        to_review = (visible_audits(user)
                     .filter(reviewer=user, status__in=[S.SUBMITTED, S.APPROVED])
                     .select_related("department", "lead_auditor").order_by("submitted_at"))

        to_verify = []
        if user.can(Cap.VERIFY_ACTIONS):
            pending = (visible_actions(user).filter(status=CorrectiveAction.Status.PENDING_VERIFICATION)
                       .select_related("finding__audit", "owner", "department", "organization__settings")
                       .order_by("submitted_at"))
            to_verify = [a for a in pending[:200] if can_verify(user, a)]

        mine = (CorrectiveAction.objects.filter(organization_id=user.organization_id, owner=user)
                .exclude(status=CorrectiveAction.Status.CLOSED).select_related("department").order_by("due_date"))

        managed = managed_department_ids(user)
        dept_overdue = (CorrectiveAction.objects.filter(organization_id=user.organization_id, department_id__in=managed,
                                                        due_date__lt=today)
                        .exclude(status=CorrectiveAction.Status.CLOSED)
                        .select_related("department", "owner").order_by("due_date")) if managed else None

        def audit_item(a, kind):
            return {"kind": kind, "id": a.id, "reference": a.reference, "title": a.title,
                    "department": a.department.name, "status": a.status, "due_date": a.due_date,
                    "days_left": (a.due_date - today).days, "completion_percentage": a.completion_percentage}

        def action_item(c, kind):
            return {"kind": kind, "id": c.id, "reference": c.reference, "title": c.title,
                    "department": c.department.name, "status": c.status, "due_date": c.due_date,
                    "days_left": (c.due_date - today).days, "owner": c.owner.full_name, "progress": c.progress}

        sections = [
            {"key": "perform", "title": "Audits to perform", "count": to_perform.count(),
             "items": [audit_item(a, "rework" if a.status == S.REWORK_REQUIRED else "audit")
                       for a in to_perform[:self.LIMIT]]},
            {"key": "review", "title": "Audits to review", "count": to_review.count(),
             "items": [audit_item(a, "complete" if a.status == S.APPROVED else "review")
                       for a in to_review[:self.LIMIT]]},
            {"key": "verify", "title": "Actions awaiting your verification", "count": len(to_verify),
             "items": [action_item(c, "verify") for c in to_verify[:self.LIMIT]]},
            {"key": "my_actions", "title": "My corrective actions", "count": mine.count(),
             "items": [action_item(c, "action") for c in mine[:self.LIMIT]]},
        ]
        if dept_overdue is not None:
            sections.append({"key": "department_overdue", "title": "Overdue actions in your departments",
                             "count": dept_overdue.count(),
                             "items": [action_item(c, "overdue") for c in dept_overdue[:self.LIMIT]]})
        return Response({"total": sum(s["count"] for s in sections), "sections": sections})


ReportPermission = capability_required(Cap.VIEW_REPORTS, read_capability=Cap.VIEW_REPORTS)


class ReportCatalogView(APIView):
    permission_classes = [ReportPermission]

    def get(self, request):
        return Response(catalog())


class ReportView(APIView):
    permission_classes = [ReportPermission]

    def get(self, request, key):
        if key not in REPORTS:
            raise Http404
        return Response(build_report(key, request.user, parse_filters(request)))


class ReportExportView(APIView):
    permission_classes = [ReportPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "export"

    def get(self, request, key, fmt):
        if key not in REPORTS or fmt not in ("pdf", "excel"):
            raise Http404
        filters = parse_filters(request)
        report = build_report(key, request.user, filters, limit=EXPORT_LIMIT)
        log_activity(request.user, "report.exported", organization=request.user.organization,
                     object_type="report", object_id=key, object_repr=report["title"], request=request,
                     changes={"format": fmt, "filters": report["filters"]})
        stamp = timezone.now().strftime("%Y%m%d-%H%M")
        if fmt == "pdf":
            content, mime, ext = render_pdf(report), "application/pdf", "pdf"
        else:
            content = render_excel(report)
            mime, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
        response = HttpResponse(content, content_type=mime)
        response["Content-Disposition"] = f'attachment; filename="{slugify(report["title"])}-{stamp}.{ext}"'
        response["Cache-Control"] = "private, no-store"
        return response
