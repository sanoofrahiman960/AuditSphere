import logging

from django.conf import settings
from django.db import connection
from django.db.models import Q
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsOrgMember
from .scoping import visible_actions, visible_audits, visible_departments, visible_findings

logger = logging.getLogger("auditsphere")


class HealthView(APIView):
    """Liveness: the process is up."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get(self, request):
        return Response({"status": "ok"})


class ReadinessView(APIView):
    """Readiness: database (and broker, when configured) reachable."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get(self, request):
        checks = {}
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            checks["database"] = "ok"
        except Exception as exc:  # pragma: no cover
            logger.error("Readiness DB check failed: %s", exc)
            checks["database"] = "error"
        if settings.CELERY_BROKER_URL:
            try:
                from config.celery import app

                with app.connection_for_write() as conn:
                    conn.ensure_connection(max_retries=1, timeout=2)
                checks["broker"] = "ok"
            except Exception as exc:  # pragma: no cover
                logger.error("Readiness broker check failed: %s", exc)
                checks["broker"] = "error"
        healthy = all(v == "ok" for v in checks.values())
        return Response({"status": "ok" if healthy else "degraded", "checks": checks}, status=200 if healthy else 503)


class GlobalSearchView(APIView):
    """Search across the records the caller is allowed to see."""

    permission_classes = [IsOrgMember]

    def get(self, request):
        from apps.audit_templates.models import AuditTemplate

        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"query": q, "results": []})
        user = request.user
        results = []
        for a in visible_audits(user).filter(Q(reference__icontains=q) | Q(title__icontains=q)).select_related(
                "department")[:6]:
            results.append({"type": "audit", "id": a.id, "title": f"{a.reference} · {a.title}",
                            "subtitle": f"{a.department.name} · {a.get_status_display()}", "link": f"/audits/{a.id}"})
        for f in visible_findings(user).filter(Q(reference__icontains=q) | Q(title__icontains=q)).select_related(
                "department")[:6]:
            results.append({"type": "finding", "id": f.id, "title": f"{f.reference} · {f.title}",
                            "subtitle": f"{f.department.name} · {f.get_severity_display()}",
                            "link": f"/findings/{f.id}"})
        for c in visible_actions(user).filter(Q(reference__icontains=q) | Q(title__icontains=q)).select_related(
                "owner")[:6]:
            results.append({"type": "action", "id": c.id, "title": f"{c.reference} · {c.title}",
                            "subtitle": f"{c.owner} · {c.get_status_display()}", "link": f"/actions/{c.id}"})
        for d in visible_departments(user).filter(name__icontains=q)[:4]:
            results.append({"type": "department", "id": d.id, "title": d.name,
                            "subtitle": "Department" + ("" if d.is_active else " (inactive)"),
                            "link": f"/departments/{d.id}"})
        for t in AuditTemplate.objects.filter(organization_id=user.organization_id, name__icontains=q)[:4]:
            results.append({"type": "template", "id": t.id, "title": t.name, "subtitle": "Audit template",
                            "link": f"/templates/{t.id}"})
        return Response({"query": q, "results": results})
