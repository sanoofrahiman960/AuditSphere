import django_filters
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.roles import Cap
from apps.activity_logs.models import AuditActivityLog
from apps.activity_logs.serializers import ActivityLogSerializer
from apps.activity_logs.services import log_activity
from apps.audit_templates.models import AuditQuestion, AuditSection
from apps.audit_templates.serializers import AuditQuestionSerializer
from apps.core.files import stream_file
from apps.core.permissions import IsOrgMember
from apps.core.scoping import visible_audits

from . import scoring, services
from .models import Audit, AuditEvidence, AuditResponse, Priority
from .serializers import (
    AuditDetailSerializer,
    AuditListSerializer,
    AuditWriteSerializer,
    CommentsSerializer,
    EvidenceSerializer,
    EvidenceUploadSerializer,
    ReasonSerializer,
    ResolveCommentSerializer,
    ResponseSerializer,
    ReviewCommentCreateSerializer,
    ReviewCommentSerializer,
    ReviewDecisionSerializer,
    SaveResponsesSerializer,
)


class AuditFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=Audit.Status.choices)
    priority = django_filters.MultipleChoiceFilter(choices=Priority.choices)
    due_from = django_filters.DateFilter(field_name="due_date", lookup_expr="gte")
    due_to = django_filters.DateFilter(field_name="due_date", lookup_expr="lte")
    planned_from = django_filters.DateFilter(field_name="planned_start_date", lookup_expr="gte")
    planned_to = django_filters.DateFilter(field_name="planned_start_date", lookup_expr="lte")
    overdue = django_filters.BooleanFilter(method="filter_overdue")
    mine = django_filters.BooleanFilter(method="filter_mine")
    template = django_filters.NumberFilter(field_name="template_version__template_id")

    class Meta:
        model = Audit
        fields = ["department", "status", "lead_auditor", "reviewer", "priority", "audit_type", "template"]

    def filter_overdue(self, qs, name, value):
        overdue_q = Q(due_date__lt=timezone.localdate()) & ~Q(status__in=Audit.CLOSED_STATES) & ~Q(status="DRAFT")
        return qs.filter(overdue_q) if value else qs.exclude(overdue_q)

    def filter_mine(self, qs, name, value):
        if not value:
            return qs
        user = self.request.user
        return qs.filter(Q(lead_auditor=user) | Q(reviewer=user) |
                         Q(assignments__user=user, assignments__is_active=True)).distinct()


class AuditViewSet(viewsets.ModelViewSet):
    """
    Audit planning, execution and review. Visibility comes from apps.core.scoping;
    planning (create/edit/delete/schedule/cancel/reopen) needs the manage_audits capability;
    execution and review rights are checked per audit in apps.audits.services.
    """

    permission_classes = [IsOrgMember]
    filterset_class = AuditFilter
    search_fields = ["reference", "title", "department__name", "scope"]
    ordering_fields = ["planned_start_date", "due_date", "reference", "status", "priority", "compliance_score",
                       "created_at", "title"]
    ordering = ["-planned_start_date", "-id"]

    def get_queryset(self):
        return visible_audits(self.request.user).select_related(
            "department", "template_version__template", "lead_auditor", "reviewer", "department_contact",
            "created_by",
        ).annotate(findings_count=Count("findings", distinct=True))

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return AuditWriteSerializer
        if self.action == "list":
            return AuditListSerializer
        return AuditDetailSerializer

    def _require_manage(self):
        if not self.request.user.can(Cap.MANAGE_AUDITS):
            raise PermissionDenied("Only audit administrators can plan audits.")

    def _detail(self, audit, http_status=status.HTTP_200_OK):
        audit = self.get_queryset().get(pk=audit.pk)
        return Response(AuditDetailSerializer(audit, context=self.get_serializer_context()).data, status=http_status)

    def create(self, request, *args, **kwargs):
        self._require_manage()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        audit = services.create_audit(request.user, dict(serializer.validated_data), request=request)
        return self._detail(audit, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        self._require_manage()
        audit = self.get_object()
        serializer = self.get_serializer(audit, data=request.data, partial=kwargs.get("partial", False))
        serializer.is_valid(raise_exception=True)
        audit = services.update_audit(request.user, audit, dict(serializer.validated_data), request=request)
        return self._detail(audit)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        self._require_manage()
        audit = self.get_object()
        if audit.status != Audit.Status.DRAFT:
            return Response({"detail": "Only draft audits can be deleted; cancel it instead.",
                             "code": "invalid_transition", "errors": None}, status=status.HTTP_409_CONFLICT)
        log_activity(request.user, "audit.deleted", audit, request=request, changes={"reference": audit.reference})
        audit.assignments.all().delete()
        audit.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ---- transitions -------------------------------------------------------------
    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None):
        self._require_manage()
        return self._detail(services.schedule(request.user, self.get_object(), request=request))

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self._detail(services.start(request.user, self.get_object(), request=request))

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        return self._detail(services.submit(request.user, self.get_object(), request=request))

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        payload = CommentsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.approve(request.user, self.get_object(),
                                             payload.validated_data.get("comments", ""), request=request))

    @action(detail=True, methods=["post"], url_path="request-rework")
    def request_rework(self, request, pk=None):
        payload = CommentsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.request_rework(request.user, self.get_object(),
                                                    payload.validated_data.get("comments", ""), request=request))

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return self._detail(services.complete(request.user, self.get_object(), request=request))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        self._require_manage()
        payload = ReasonSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.cancel(request.user, self.get_object(), payload.validated_data["reason"],
                                            request=request))

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        self._require_manage()
        payload = ReasonSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.reopen(request.user, self.get_object(), payload.validated_data["reason"],
                                            request=request))

    # ---- execution -----------------------------------------------------------------
    def _workspace(self, audit):
        audit = self.get_queryset().get(pk=audit.pk)
        responses = {
            r.question_id: r
            for r in AuditResponse.objects.filter(audit=audit).select_related("answered_by").prefetch_related(
                Prefetch("evidence", queryset=AuditEvidence.objects.select_related("uploaded_by"))
            )
        }
        finding_counts = dict(audit.findings.exclude(question__isnull=True).values_list("question_id")
                              .annotate(n=Count("id")))
        sections = []
        for section in AuditSection.objects.filter(version_id=audit.template_version_id).prefetch_related(
            Prefetch("questions", queryset=AuditQuestion.objects.order_by("order", "id"))
        ).order_by("order", "id"):
            questions = []
            for q in section.questions.all():
                data = AuditQuestionSerializer(q).data
                response = responses.get(q.id)
                data["response"] = ResponseSerializer(response).data if response else None
                data["findings_count"] = finding_counts.get(q.id, 0)
                questions.append(data)
            sections.append({"id": section.id, "title": section.title, "description": section.description,
                             "questions": questions})
        review_comments = audit.review_comments.select_related("author", "resolved_by", "question")
        return Response({
            "audit": AuditDetailSerializer(audit, context=self.get_serializer_context()).data,
            "sections": sections,
            "review_comments": ReviewCommentSerializer(review_comments, many=True).data,
            "issues": services.validation_issues(audit) if audit.status in Audit.EDITABLE_STATES else [],
            "scoring_explanation": scoring.SCORING_EXPLANATION,
            "template_version": {
                "id": audit.template_version_id,
                "version": audit.template_version.version,
                "name": audit.template_version.template.name,
                "applicable_standard": audit.template_version.applicable_standard,
                "scoring_method": audit.template_version.scoring_method,
            },
        })

    @action(detail=True, methods=["get"])
    def workspace(self, request, pk=None):
        return self._workspace(self.get_object())

    @action(detail=True, methods=["put", "post"])
    def responses(self, request, pk=None):
        payload = SaveResponsesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        audit = services.save_responses(request.user, self.get_object(), data.get("responses", []),
                                        overall={k: data.get(k) for k in ("overall_summary", "overall_recommendation")},
                                        request=request)
        return self._workspace(audit)

    @action(detail=True, methods=["get"])
    def validation(self, request, pk=None):
        audit = self.get_object()
        return Response({"issues": services.validation_issues(audit)})

    @action(detail=True, methods=["get", "post"], parser_classes=[MultiPartParser, FormParser])
    def evidence(self, request, pk=None):
        audit = self.get_object()
        if request.method == "GET":
            qs = audit.evidence.select_related("uploaded_by")
            return Response(EvidenceSerializer(qs, many=True).data)
        payload = EvidenceUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        d = payload.validated_data
        evidence = services.add_evidence(request.user, audit, d["file"], response_id=d.get("response_id"),
                                         finding_id=d.get("finding_id"), description=d.get("description", ""),
                                         request=request)
        return Response(EvidenceSerializer(evidence).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def reviews(self, request, pk=None):
        audit = self.get_object()
        return Response(ReviewDecisionSerializer(audit.review_decisions.select_related("reviewer"), many=True).data)

    @action(detail=True, methods=["get", "post"], url_path="review-comments")
    def review_comments(self, request, pk=None):
        audit = self.get_object()
        if request.method == "GET":
            qs = audit.review_comments.select_related("author", "resolved_by", "question")
            return Response(ReviewCommentSerializer(qs, many=True).data)
        payload = ReviewCommentCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        comment = services.add_review_comment(request.user, audit, payload.validated_data["body"],
                                              payload.validated_data.get("question_id"), request=request)
        return Response(ReviewCommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path=r"review-comments/(?P<comment_id>\d+)/resolve")
    def resolve_review_comment(self, request, pk=None, comment_id=None):
        audit = self.get_object()
        comment = audit.review_comments.filter(id=comment_id).first()
        if comment is None:
            return Response({"detail": "Comment not found.", "code": "not_found", "errors": None},
                            status=status.HTTP_404_NOT_FOUND)
        payload = ResolveCommentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        comment = services.resolve_review_comment(request.user, comment, payload.validated_data.get("note", ""),
                                                  request=request)
        return Response(ReviewCommentSerializer(comment).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        audit = self.get_object()
        logs = AuditActivityLog.objects.filter(
            organization_id=request.user.organization_id, object_type="audits.audit", object_id=str(audit.id)
        ).select_related("actor")[:200]
        return Response(ActivityLogSerializer(logs, many=True).data)

    @action(detail=False, methods=["get"], pagination_class=None)
    def calendar(self, request):
        """Lightweight events between ?start= and ?end= (inclusive), honouring the usual filters."""
        qs = self.filter_queryset(self.get_queryset())
        start, end = request.query_params.get("start"), request.query_params.get("end")
        if start:
            qs = qs.filter(due_date__gte=start)
        if end:
            qs = qs.filter(planned_start_date__lte=end)
        events = [
            {"id": a.id, "reference": a.reference, "title": a.title, "department": a.department.name,
             "status": a.status, "priority": a.priority, "planned_start_date": a.planned_start_date,
             "due_date": a.due_date, "is_overdue": a.is_overdue,
             "lead_auditor": a.lead_auditor.full_name if a.lead_auditor else None}
            for a in qs[:1000]
        ]
        return Response(events)


class AuditEvidenceViewSet(mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Evidence metadata, authorised download and removal (visibility follows the parent audit)."""

    serializer_class = EvidenceSerializer
    permission_classes = [IsOrgMember]

    def get_queryset(self):
        return AuditEvidence.objects.filter(
            organization_id=self.request.user.organization_id,
            audit_id__in=visible_audits(self.request.user).values("id"),
        ).select_related("audit", "uploaded_by")

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        evidence = self.get_object()
        log_activity(request.user, "evidence.downloaded", evidence.audit, request=request,
                     changes={"evidence_id": evidence.id, "file": evidence.original_name})
        return stream_file(evidence.file, evidence.original_name, evidence.content_type)

    def destroy(self, request, *args, **kwargs):
        services.delete_evidence(request.user, self.get_object(), request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
