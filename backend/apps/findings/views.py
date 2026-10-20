import django_filters
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.activity_logs.models import AuditActivityLog
from apps.activity_logs.serializers import ActivityLogSerializer
from apps.audit_templates.models import Severity
from apps.audits import services as audit_services
from apps.audits.serializers import EvidenceSerializer, EvidenceUploadSerializer
from apps.core.exceptions import WorkflowError
from apps.core.permissions import ReadOnlyForExecutives
from apps.core.scoping import visible_findings

from . import services
from .models import AuditFinding
from .serializers import (
    AssessRiskSerializer,
    CloseFindingSerializer,
    FindingDetailSerializer,
    FindingSerializer,
    FindingWriteSerializer,
    NotesSerializer,
)


class FindingFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=AuditFinding.Status.choices)
    severity = django_filters.MultipleChoiceFilter(choices=Severity.choices)
    open = django_filters.BooleanFilter(method="filter_open")
    overdue = django_filters.BooleanFilter(method="filter_overdue")
    created_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    created_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = AuditFinding
        fields = ["audit", "department", "status", "severity", "owner", "risk_category", "question"]

    def filter_open(self, qs, name, value):
        return qs.filter(status__in=AuditFinding.OPEN_STATES) if value else qs.exclude(
            status__in=AuditFinding.OPEN_STATES)

    def filter_overdue(self, qs, name, value):
        cond = Q(target_date__lt=timezone.localdate(), status__in=["OPEN", "IN_PROGRESS"])
        return qs.filter(cond) if value else qs.exclude(cond)


class FindingViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                     mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Audit findings with transparent risk scoring. Findings are never deleted (audit trail)."""

    permission_classes = [ReadOnlyForExecutives]
    filterset_class = FindingFilter
    search_fields = ["reference", "title", "description", "audit__reference", "department__name"]
    ordering_fields = ["created_at", "risk_score", "severity", "target_date", "reference", "status"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return visible_findings(self.request.user).select_related(
            "audit", "department", "question", "owner", "created_by", "closed_by"
        ).annotate(
            actions_count=Count("actions", distinct=True),
            open_actions_count=Count("actions", filter=~Q(actions__status="CLOSED"), distinct=True),
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return FindingWriteSerializer
        if self.action == "list":
            return FindingSerializer
        return FindingDetailSerializer

    def _detail(self, finding, http_status=status.HTTP_200_OK):
        finding = self.get_queryset().prefetch_related("risk_assessments__assessed_by", "evidence__uploaded_by").get(
            pk=finding.pk)
        return Response(FindingDetailSerializer(finding, context=self.get_serializer_context()).data,
                        status=http_status)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        finding = services.create_finding(request.user, dict(serializer.validated_data), request=request)
        return self._detail(finding, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        finding = self.get_object()
        serializer = self.get_serializer(finding, data=request.data, partial=kwargs.get("partial", False))
        serializer.is_valid(raise_exception=True)
        finding = services.update_finding(request.user, finding, dict(serializer.validated_data), request=request)
        return self._detail(finding)

    @action(detail=True, methods=["post"])
    def assess(self, request, pk=None):
        payload = AssessRiskSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        d = payload.validated_data
        finding = services.assess_risk(request.user, self.get_object(), d["likelihood"], d["impact"],
                                       d.get("override_severity") or None, d.get("rationale", ""), request=request)
        return self._detail(finding)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        payload = CloseFindingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        finding = services.close_finding(request.user, self.get_object(), payload.validated_data["notes"],
                                         payload.validated_data["accept_risk"], request=request)
        return self._detail(finding)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        payload = NotesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.reopen_finding(request.user, self.get_object(),
                                                    payload.validated_data["notes"], request=request))

    @action(detail=True, methods=["get", "post"], parser_classes=[MultiPartParser, FormParser])
    def evidence(self, request, pk=None):
        finding = self.get_object()
        if request.method == "GET":
            return Response(EvidenceSerializer(finding.evidence.select_related("uploaded_by"), many=True).data)
        if finding.status not in AuditFinding.OPEN_STATES:
            raise WorkflowError("Evidence cannot be added to a closed finding.")
        payload = EvidenceUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        evidence = audit_services.add_evidence(
            request.user, finding.audit, payload.validated_data["file"], finding_id=finding.id,
            response_id=finding.response_id, description=payload.validated_data.get("description", ""),
            request=request,
        )
        return Response(EvidenceSerializer(evidence).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        finding = self.get_object()
        logs = AuditActivityLog.objects.filter(
            organization_id=request.user.organization_id, object_type="findings.auditfinding",
            object_id=str(finding.id),
        ).select_related("actor")[:200]
        return Response(ActivityLogSerializer(logs, many=True).data)

    @action(detail=False, methods=["get"], url_path="risk-matrix", pagination_class=None)
    def risk_matrix(self, request):
        return Response(services.risk_matrix(request.user.organization))
