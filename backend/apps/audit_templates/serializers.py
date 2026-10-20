from rest_framework import serializers

from apps.accounts.serializers import UserSummarySerializer
from apps.departments.models import Department

from .models import AuditCategory, AuditQuestion, AuditSection, AuditTemplate, AuditTemplateVersion


class AuditCategorySerializer(serializers.ModelSerializer):
    template_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = AuditCategory
        fields = ["id", "name", "description", "is_active", "template_count", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_name(self, value):
        qs = AuditCategory.objects.filter(organization_id=self.context["request"].user.organization_id,
                                          name__iexact=value.strip())
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A category with this name already exists.")
        return value.strip()


class AuditQuestionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    is_scored = serializers.BooleanField(read_only=True)

    class Meta:
        model = AuditQuestion
        fields = [
            "id", "code", "text", "guidance", "response_type", "is_mandatory", "evidence_required", "weight",
            "risk_category", "failure_severity", "requires_corrective_action", "rating_max",
            "rating_pass_threshold", "numeric_min", "numeric_max", "order", "is_scored",
        ]

    def validate(self, attrs):
        rating_max = attrs.get("rating_max", 5)
        threshold = attrs.get("rating_pass_threshold", 3)
        if attrs.get("response_type") == AuditQuestion.ResponseType.RATING and not 1 <= threshold <= rating_max:
            raise serializers.ValidationError({"rating_pass_threshold": ["Must be between 1 and the scale maximum."]})
        low, high = attrs.get("numeric_min"), attrs.get("numeric_max")
        if low is not None and high is not None and low > high:
            raise serializers.ValidationError({"numeric_max": ["Maximum must be greater than minimum."]})
        return attrs


class AuditSectionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    questions = AuditQuestionSerializer(many=True, required=False)

    class Meta:
        model = AuditSection
        fields = ["id", "title", "description", "order", "questions"]


class VersionSummarySerializer(serializers.ModelSerializer):
    question_count = serializers.SerializerMethodField()
    audit_count = serializers.SerializerMethodField()
    created_by = UserSummarySerializer(read_only=True)
    approved_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = AuditTemplateVersion
        fields = ["id", "version", "status", "applicable_standard", "scoring_method", "change_notes",
                  "question_count", "audit_count", "created_by", "approved_by", "approved_at", "created_at"]

    def get_question_count(self, obj):
        return AuditQuestion.objects.filter(section__version=obj).count()

    def get_audit_count(self, obj):
        return obj.audits.count()


class AuditTemplateVersionSerializer(serializers.ModelSerializer):
    """Full version with structure. Writable (metadata + sections) while the version is an unused draft."""

    sections = AuditSectionSerializer(many=True, required=False)
    template_name = serializers.CharField(source="template.name", read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    audit_count = serializers.SerializerMethodField()
    created_by = UserSummarySerializer(read_only=True)
    approved_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = AuditTemplateVersion
        fields = [
            "id", "template", "template_name", "version", "status", "applicable_standard", "scoring_method",
            "change_notes", "is_editable", "audit_count", "created_by", "approved_by", "approved_at", "created_at",
            "updated_at", "sections",
        ]
        read_only_fields = ["id", "template", "version", "status", "approved_at", "created_at", "updated_at"]

    def get_audit_count(self, obj):
        return obj.audits.count()


class AuditTemplateSerializer(serializers.ModelSerializer):
    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.none(), allow_null=True,
                                                    required=False)
    category = serializers.PrimaryKeyRelatedField(queryset=AuditCategory.objects.none(), allow_null=True,
                                                  required=False)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    latest_version = serializers.SerializerMethodField()
    current_version = serializers.SerializerMethodField()
    version_count = serializers.IntegerField(read_only=True)
    # Write-only: initial version content on create.
    applicable_standard = serializers.CharField(write_only=True, required=False, allow_blank=True)
    scoring_method = serializers.ChoiceField(choices=AuditTemplateVersion.ScoringMethod.choices, write_only=True,
                                             required=False)
    sections = AuditSectionSerializer(many=True, write_only=True, required=False)

    class Meta:
        model = AuditTemplate
        fields = [
            "id", "name", "description", "department", "department_name", "category", "category_name", "is_active",
            "latest_version", "current_version", "version_count", "created_at", "updated_at",
            "applicable_standard", "scoring_method", "sections",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            org_id = request.user.organization_id
            self.fields["department"].queryset = Department.objects.filter(organization_id=org_id)
            self.fields["category"].queryset = AuditCategory.objects.filter(organization_id=org_id)

    def _version(self, version):
        if version is None:
            return None
        return {"id": version.id, "version": version.version, "status": version.status,
                "applicable_standard": version.applicable_standard}

    def get_latest_version(self, obj):
        return self._version(obj.latest_version)

    def get_current_version(self, obj):
        return self._version(obj.current_approved_version)

    def validate_name(self, value):
        qs = AuditTemplate.objects.filter(organization_id=self.context["request"].user.organization_id,
                                          name__iexact=value.strip())
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A template with this name already exists.")
        return value.strip()
