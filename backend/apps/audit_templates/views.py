from django.db import transaction
from django.db.models import Count, Prefetch
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.roles import Cap
from apps.activity_logs.services import diff, log_activity, snapshot
from apps.core.exceptions import WorkflowError
from apps.core.permissions import capability_required

from . import services
from .models import AuditCategory, AuditQuestion, AuditSection, AuditTemplate, AuditTemplateVersion
from .serializers import (
    AuditCategorySerializer,
    AuditTemplateSerializer,
    AuditTemplateVersionSerializer,
    VersionSummarySerializer,
)

TemplatePermission = capability_required(Cap.MANAGE_TEMPLATES)


class AuditCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = AuditCategorySerializer
    permission_classes = [TemplatePermission]
    filterset_fields = ["is_active"]
    search_fields = ["name"]

    def get_queryset(self):
        return AuditCategory.objects.filter(organization_id=self.request.user.organization_id).annotate(
            template_count=Count("templates")
        ).order_by("name")

    def perform_create(self, serializer):
        category = serializer.save(organization=self.request.user.organization)
        log_activity(self.request.user, "category.created", category, request=self.request)

    def perform_update(self, serializer):
        category = serializer.save()
        log_activity(self.request.user, "category.updated", category, request=self.request)

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        category.is_active = False
        category.save(update_fields=["is_active", "updated_at"])
        log_activity(request.user, "category.deactivated", category, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class NewVersionSerializer(serializers.Serializer):
    source_version = serializers.IntegerField(required=False)
    change_notes = serializers.CharField(required=False, allow_blank=True)


class DuplicateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)


class AuditTemplateViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                           mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Reusable checklists. Every org member can read; administrators manage."""

    serializer_class = AuditTemplateSerializer
    permission_classes = [TemplatePermission]
    filterset_fields = ["department", "category", "is_active"]
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at", "updated_at"]

    def get_queryset(self):
        return AuditTemplate.objects.filter(organization_id=self.request.user.organization_id).select_related(
            "department", "category"
        ).annotate(version_count=Count("versions")).order_by("name")

    def perform_create(self, serializer):
        data = dict(serializer.validated_data)
        sections = data.pop("sections", [])
        version_data = {k: data.pop(k) for k in ("applicable_standard", "scoring_method") if k in data}
        serializer.instance = services.create_template(self.request.user, data, version_data, sections,
                                                       request=self.request)

    @transaction.atomic
    def perform_update(self, serializer):
        for write_only in ("sections", "applicable_standard", "scoring_method"):
            serializer.validated_data.pop(write_only, None)
        before = snapshot(serializer.instance)
        template = serializer.save()
        changes = diff(before, snapshot(template))
        if changes:
            log_activity(self.request.user, "template.updated", template, changes=changes, request=self.request)

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        response.data = self.get_serializer(self.get_queryset().get(pk=response.data["id"])).data
        return response

    @action(detail=True, methods=["get", "post"])
    def versions(self, request, pk=None):
        template = self.get_object()
        if request.method == "GET":
            return Response(VersionSummarySerializer(template.versions.all(), many=True).data)
        payload = NewVersionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        source = None
        if payload.validated_data.get("source_version"):
            source = template.versions.filter(id=payload.validated_data["source_version"]).first()
            if source is None:
                raise serializers.ValidationError({"source_version": ["Version not found for this template."]})
        if template.versions.filter(status=AuditTemplateVersion.Status.DRAFT).exists():
            raise WorkflowError("This template already has a draft version. Edit or approve it first.")
        version = services.new_version(request.user, template, source, payload.validated_data.get("change_notes", ""),
                                       request=request)
        return Response(AuditTemplateVersionSerializer(_with_structure(version)).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        template = self.get_object()
        payload = DuplicateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        name = payload.validated_data["name"].strip()
        if AuditTemplate.objects.filter(organization_id=request.user.organization_id, name__iexact=name).exists():
            raise serializers.ValidationError({"name": ["A template with this name already exists."]})
        copy = services.duplicate_template(request.user, template, name, request=request)
        return Response(self.get_serializer(self.get_queryset().get(pk=copy.pk)).data, status=status.HTTP_201_CREATED)


def _with_structure(version):
    return AuditTemplateVersion.objects.select_related("template", "created_by", "approved_by").prefetch_related(
        Prefetch("sections", queryset=AuditSection.objects.prefetch_related(
            Prefetch("questions", queryset=AuditQuestion.objects.order_by("order", "id"))
        ).order_by("order", "id"))
    ).get(pk=version.pk)


class AuditTemplateVersionViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """A template version with its sections and questions. Editable only while an unused draft."""

    serializer_class = AuditTemplateVersionSerializer
    permission_classes = [TemplatePermission]

    def get_queryset(self):
        return AuditTemplateVersion.objects.filter(
            template__organization_id=self.request.user.organization_id
        ).select_related("template", "created_by", "approved_by").prefetch_related(
            Prefetch("sections", queryset=AuditSection.objects.prefetch_related(
                Prefetch("questions", queryset=AuditQuestion.objects.order_by("order", "id"))
            ).order_by("order", "id"))
        )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        version = self.get_object()
        if not version.is_editable:
            raise WorkflowError("Only unused draft versions can be edited. Create a new version instead.")
        serializer = self.get_serializer(version, data=request.data, partial=kwargs.get("partial", False))
        serializer.is_valid(raise_exception=True)
        sections = serializer.validated_data.pop("sections", None)
        for field, value in serializer.validated_data.items():
            setattr(version, field, value)
        version.save()
        if sections is not None:
            services.write_structure(version, sections)
        log_activity(request.user, "template.version_edited", version.template, request=request,
                     changes={"version": version.version, "sections": len(sections) if sections is not None else None})
        return Response(self.get_serializer(_with_structure(version)).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        version = services.approve_version(request.user, self.get_object(), request=request)
        return Response(self.get_serializer(_with_structure(version)).data)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        version = services.archive_version(request.user, self.get_object(), request=request)
        return Response(self.get_serializer(_with_structure(version)).data)
