from django.db import transaction
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.roles import Cap
from apps.activity_logs.services import log_activity
from apps.core.files import file_metadata, validate_upload
from apps.core.permissions import IsOrgMember, capability_required
from apps.core.scoping import visible_audits, visible_findings

from . import services
from .models import PolicyDocument


class PolicyDocumentSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)

    class Meta:
        model = PolicyDocument
        fields = ["id", "title", "description", "version_label", "department", "department_name", "file",
                  "original_name", "size", "is_approved", "status", "page_count", "chunk_count", "error",
                  "created_at"]
        read_only_fields = ["id", "original_name", "size", "status", "page_count", "chunk_count", "error",
                            "created_at"]

    def validate_department(self, value):
        if value and value.organization_id != self.context["request"].user.organization_id:
            raise serializers.ValidationError("Unknown department.")
        return value


class AIStatusView(APIView):
    permission_classes = [IsOrgMember]

    def get(self, request):
        return Response(services.status())


class PolicyDocumentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                            mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Approved policies / SOPs for retrieval. Managed by template administrators."""

    serializer_class = PolicyDocumentSerializer
    permission_classes = [capability_required(Cap.MANAGE_TEMPLATES, read_capability=Cap.USE_AI)]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    search_fields = ["title", "description"]
    filterset_fields = ["department", "is_approved", "status"]

    def get_queryset(self):
        return PolicyDocument.objects.filter(organization_id=self.request.user.organization_id).select_related(
            "department")

    @transaction.atomic
    def perform_create(self, serializer):
        uploaded = serializer.validated_data.pop("file")
        validate_upload(uploaded)
        if not uploaded.name.lower().endswith((".pdf", ".txt", ".md")):
            raise serializers.ValidationError({"file": ["Policy documents must be PDF, TXT or MD."]})
        doc = PolicyDocument(organization=self.request.user.organization, uploaded_by=self.request.user,
                             **serializer.validated_data, **file_metadata(uploaded))
        doc.file.save(uploaded.name, uploaded, save=False)
        doc.save()
        serializer.instance = doc
        log_activity(self.request.user, "ai.policy_uploaded", doc, request=self.request)

    def perform_update(self, serializer):
        serializer.validated_data.pop("file", None)
        doc = serializer.save()
        log_activity(self.request.user, "ai.policy_updated", doc, request=self.request,
                     changes={"is_approved": doc.is_approved})

    @action(detail=True, methods=["post"])
    def index(self, request, pk=None):
        doc = services.index_document(self.get_object())
        return Response(self.get_serializer(doc).data)


class AskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=2000)
    department = serializers.IntegerField(required=False, allow_null=True)


class AIBaseView(APIView):
    permission_classes = [capability_required(Cap.USE_AI, read_capability=Cap.USE_AI)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ai"


class PolicySearchView(AIBaseView):
    def post(self, request):
        payload = AskSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        result = services.answer_policy_question(request.user, payload.validated_data["question"],
                                                 payload.validated_data.get("department"))
        log_activity(request.user, "ai.policy_question", organization=request.user.organization,
                     object_type="ai", object_repr="policy search",
                     changes={"question": payload.validated_data["question"][:300],
                              "sources": [s["document_id"] for s in result["sources"]]}, request=request)
        return Response(result)


class AuditSummaryDraftView(AIBaseView):
    def post(self, request, audit_id):
        audit = visible_audits(request.user).select_related("department").filter(id=audit_id).first()
        if audit is None:
            return Response({"detail": "Not found.", "code": "not_found", "errors": None},
                            status=status.HTTP_404_NOT_FOUND)
        result = services.draft_audit_summary(audit)
        log_activity(request.user, "ai.summary_drafted", audit, request=request)
        return Response(result)


class ActionRecommendationDraftView(AIBaseView):
    def post(self, request, finding_id):
        finding = visible_findings(request.user).select_related("department").filter(id=finding_id).first()
        if finding is None:
            return Response({"detail": "Not found.", "code": "not_found", "errors": None},
                            status=status.HTTP_404_NOT_FOUND)
        result = services.draft_action_recommendation(finding)
        log_activity(request.user, "ai.recommendation_drafted", finding, request=request)
        return Response(result)
