from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import UserSummarySerializer
from apps.audit_templates.models import AuditQuestion, Severity
from apps.audits.models import Audit
from apps.audits.serializers import DepartmentRefSerializer, EvidenceSerializer
from apps.core.scoping import visible_audits

from . import services
from .models import AuditFinding, RiskAssessment


class AuditRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Audit
        fields = ["id", "reference", "title", "status", "reviewer"]


class RiskAssessmentSerializer(serializers.ModelSerializer):
    assessed_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = RiskAssessment
        fields = ["id", "likelihood", "impact", "score", "calculated_severity", "final_severity", "is_override",
                  "rationale", "assessed_by", "created_at"]


class FindingSerializer(serializers.ModelSerializer):
    audit = AuditRefSerializer(read_only=True)
    department = DepartmentRefSerializer(read_only=True)
    question = serializers.SerializerMethodField()
    owner = UserSummarySerializer(read_only=True)
    created_by = UserSummarySerializer(read_only=True)
    closed_by = UserSummarySerializer(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    actions_count = serializers.IntegerField(read_only=True, default=0)
    open_actions_count = serializers.IntegerField(read_only=True, default=0)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = AuditFinding
        fields = [
            "id", "reference", "audit", "department", "question", "title", "description", "expected_requirement",
            "observed_condition", "root_cause", "business_impact", "risk_category", "likelihood", "impact",
            "risk_score", "severity", "severity_overridden", "owner", "recommended_action", "target_date", "status",
            "status_display", "closed_at", "closed_by", "closure_notes", "created_by", "created_at", "updated_at",
            "actions_count", "open_actions_count", "is_overdue",
        ]

    def get_question(self, obj):
        if not obj.question_id:
            return None
        return {"id": obj.question_id, "code": obj.question.code, "text": obj.question.text}

    def get_is_overdue(self, obj):
        return bool(obj.target_date and obj.status in (AuditFinding.Status.OPEN, AuditFinding.Status.IN_PROGRESS)
                    and obj.target_date < timezone.localdate())


class FindingDetailSerializer(FindingSerializer):
    risk_assessments = RiskAssessmentSerializer(many=True, read_only=True)
    evidence = EvidenceSerializer(many=True, read_only=True)
    actions = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta(FindingSerializer.Meta):
        fields = FindingSerializer.Meta.fields + ["risk_assessments", "evidence", "actions", "permissions"]

    def get_actions(self, obj):
        from apps.corrective_actions.serializers import CorrectiveActionSerializer

        return CorrectiveActionSerializer(obj.actions.select_related("owner", "department", "finding"), many=True,
                                          context=self.context).data

    def get_permissions(self, obj):
        from apps.corrective_actions.services import can_manage

        user = self.context["request"].user
        is_open = obj.status in AuditFinding.OPEN_STATES
        is_admin = user.role in ("SUPER_ADMIN", "AUDIT_ADMIN")
        closer = is_admin or obj.audit.reviewer_id == user.id
        audit_open = obj.audit.status not in (Audit.Status.COMPLETED, Audit.Status.CANCELLED)
        return {
            "can_edit": is_open and services.can_edit_finding(user, obj),
            "can_override_severity": is_open and services.can_override_severity(user, obj),
            "can_close": is_open and closer,
            "can_accept_risk": is_open and is_admin,
            "can_reopen": not is_open and closer,
            "can_add_action": is_open and can_manage(user, obj.department_id),
            "can_upload_evidence": is_open and audit_open and services.can_edit_finding(user, obj),
        }


class FindingWriteSerializer(serializers.ModelSerializer):
    audit = serializers.PrimaryKeyRelatedField(queryset=Audit.objects.none())
    question = serializers.PrimaryKeyRelatedField(queryset=AuditQuestion.objects.all(), allow_null=True,
                                                  required=False)
    owner = serializers.PrimaryKeyRelatedField(queryset=User.objects.none(), allow_null=True, required=False)
    likelihood = serializers.IntegerField(min_value=1, max_value=5, required=False)
    impact = serializers.IntegerField(min_value=1, max_value=5, required=False)

    class Meta:
        model = AuditFinding
        fields = [
            "id", "audit", "question", "title", "description", "expected_requirement", "observed_condition",
            "root_cause", "business_impact", "risk_category", "likelihood", "impact", "owner", "recommended_action",
            "target_date",
        ]
        read_only_fields = ["id"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        user = self.context["request"].user
        self.fields["audit"].queryset = visible_audits(user)
        self.fields["owner"].queryset = User.objects.filter(organization_id=user.organization_id, is_active=True)
        if self.instance is not None:
            self.fields["audit"].read_only = True
            self.fields["question"].read_only = True


class AssessRiskSerializer(serializers.Serializer):
    likelihood = serializers.IntegerField(min_value=1, max_value=5)
    impact = serializers.IntegerField(min_value=1, max_value=5)
    override_severity = serializers.ChoiceField(choices=Severity.choices, required=False, allow_blank=True,
                                                allow_null=True)
    rationale = serializers.CharField(required=False, allow_blank=True)


class CloseFindingSerializer(serializers.Serializer):
    notes = serializers.CharField()
    accept_risk = serializers.BooleanField(default=False)


class NotesSerializer(serializers.Serializer):
    notes = serializers.CharField()
