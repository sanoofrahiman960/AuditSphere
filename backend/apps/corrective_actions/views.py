import django_filters
from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.activity_logs.services import log_activity
from apps.audit_templates.models import Severity
from apps.audits.models import Priority
from apps.core.files import stream_file
from apps.core.permissions import IsOrgMember, ReadOnlyForExecutives
from apps.core.scoping import visible_actions

from . import services
from .models import ActionEvidence, CorrectiveAction
from .serializers import (
    ActionCommentSerializer,
    ActionEvidenceSerializer,
    ActionNotesSerializer,
    CorrectiveActionDetailSerializer,
    CorrectiveActionSerializer,
    CorrectiveActionWriteSerializer,
    EvidenceUploadSerializer,
    SubmitVerificationSerializer,
    VerifySerializer,
)


class ActionFilter(django_filters.FilterSet):
    status = django_filters.MultipleChoiceFilter(choices=CorrectiveAction.Status.choices)
    priority = django_filters.MultipleChoiceFilter(choices=Priority.choices)
    severity = django_filters.MultipleChoiceFilter(field_name="finding__severity", choices=Severity.choices)
    overdue = django_filters.BooleanFilter(method="filter_overdue")
    open = django_filters.BooleanFilter(method="filter_open")
    mine = django_filters.BooleanFilter(method="filter_mine")
    due_from = django_filters.DateFilter(field_name="due_date", lookup_expr="gte")
    due_to = django_filters.DateFilter(field_name="due_date", lookup_expr="lte")
    audit = django_filters.NumberFilter(field_name="finding__audit_id")

    class Meta:
        model = CorrectiveAction
        fields = ["finding", "department", "owner", "status", "priority", "action_type", "audit"]

    def filter_overdue(self, qs, name, value):
        cond = Q(due_date__lt=timezone.localdate()) & ~Q(status=CorrectiveAction.Status.CLOSED)
        return qs.filter(cond) if value else qs.exclude(cond)

    def filter_open(self, qs, name, value):
        cond = ~Q(status=CorrectiveAction.Status.CLOSED)
        return qs.filter(cond) if value else qs.exclude(cond)

    def filter_mine(self, qs, name, value):
        return qs.filter(owner=self.request.user) if value else qs


class CorrectiveActionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                              mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Corrective and preventive actions. Every transition is recorded; actions are never deleted."""

    permission_classes = [ReadOnlyForExecutives]
    filterset_class = ActionFilter
    search_fields = ["reference", "title", "description", "finding__reference", "owner__email",
                     "owner__first_name", "owner__last_name"]
    ordering_fields = ["due_date", "created_at", "priority", "status", "reference", "progress"]
    ordering = ["due_date", "-id"]

    def get_queryset(self):
        return visible_actions(self.request.user).select_related(
            "finding__audit", "department", "owner", "verified_by", "created_by"
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return CorrectiveActionWriteSerializer
        if self.action == "list":
            return CorrectiveActionSerializer
        return CorrectiveActionDetailSerializer

    def _detail(self, action_obj, http_status=status.HTTP_200_OK):
        obj = self.get_queryset().prefetch_related(
            "comments__author", "evidence__uploaded_by", "status_changes__changed_by"
        ).get(pk=action_obj.pk)
        return Response(CorrectiveActionDetailSerializer(obj, context=self.get_serializer_context()).data,
                        status=http_status)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("progress", None)
        data.pop("resolution_notes", None)
        return self._detail(services.create_action(request.user, data, request=request), status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        serializer = self.get_serializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return self._detail(services.update_action(request.user, obj, dict(serializer.validated_data),
                                                   request=request))

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self._detail(services.start(request.user, self.get_object(), request=request))

    @action(detail=True, methods=["post"], url_path="submit-verification")
    def submit_verification(self, request, pk=None):
        payload = SubmitVerificationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.submit_for_verification(
            request.user, self.get_object(), payload.validated_data.get("resolution_notes", ""), request=request))

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        payload = VerifySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.verify(request.user, self.get_object(), payload.validated_data["approved"],
                                            payload.validated_data.get("notes", ""), request=request))

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        payload = ActionNotesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self._detail(services.reopen(request.user, self.get_object(), payload.validated_data["notes"],
                                            request=request))

    @action(detail=True, methods=["get", "post"], permission_classes=[IsOrgMember])
    def comments(self, request, pk=None):
        obj = self.get_object()
        if request.method == "GET":
            return Response(ActionCommentSerializer(obj.comments.select_related("author"), many=True).data)
        serializer = ActionCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = services.add_comment(request.user, obj, serializer.validated_data["body"], request=request)
        return Response(ActionCommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], parser_classes=[MultiPartParser, FormParser])
    def evidence(self, request, pk=None):
        obj = self.get_object()
        if request.method == "GET":
            return Response(ActionEvidenceSerializer(obj.evidence.select_related("uploaded_by"), many=True).data)
        payload = EvidenceUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        evidence = services.add_evidence(request.user, obj, payload.validated_data["file"],
                                         payload.validated_data.get("description", ""), request=request)
        return Response(ActionEvidenceSerializer(evidence).data, status=status.HTTP_201_CREATED)


class ActionEvidenceViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ActionEvidenceSerializer
    permission_classes = [IsOrgMember]

    def get_queryset(self):
        return ActionEvidence.objects.filter(
            organization_id=self.request.user.organization_id,
            action_id__in=visible_actions(self.request.user).values("id"),
        ).select_related("action", "uploaded_by")

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        evidence = self.get_object()
        log_activity(request.user, "action.evidence_downloaded", evidence.action, request=request,
                     changes={"evidence_id": evidence.id, "file": evidence.original_name})
        return stream_file(evidence.file, evidence.original_name, evidence.content_type)
