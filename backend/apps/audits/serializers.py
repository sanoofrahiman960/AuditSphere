from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.roles import CAPABILITIES, Cap
from apps.accounts.serializers import UserSummarySerializer
from apps.audit_templates.models import AuditTemplateVersion
from apps.departments.models import Department

from . import services
from .models import Audit, AuditAssignment, AuditEvidence, AuditResponse, ReviewComment, ReviewDecision


class DepartmentRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name"]


class AuditListSerializer(serializers.ModelSerializer):
    department = DepartmentRefSerializer(read_only=True)
    template = serializers.SerializerMethodField()
    lead_auditor = UserSummarySerializer(read_only=True)
    reviewer = UserSummarySerializer(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    completion_percentage = serializers.IntegerField(read_only=True)
    findings_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Audit
        fields = [
            "id", "reference", "title", "department", "template", "audit_type", "priority", "status",
            "status_display", "planned_start_date", "due_date", "lead_auditor", "reviewer", "compliance_score",
            "completion_percentage", "is_overdue", "findings_count", "created_at",
        ]

    def get_template(self, obj):
        v = obj.template_version
        return {"id": v.template_id, "name": v.template.name, "version_id": v.id, "version": v.version}


class AssignmentSerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)

    class Meta:
        model = AuditAssignment
        fields = ["id", "user", "assignment_role", "is_active", "created_at", "ended_at"]


class AuditDetailSerializer(AuditListSerializer):
    department_contact = UserSummarySerializer(read_only=True)
    team = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    created_by = UserSummarySerializer(read_only=True)

    class Meta(AuditListSerializer.Meta):
        fields = AuditListSerializer.Meta.fields + [
            "period_start", "period_end", "department_contact", "scope", "objectives", "overall_summary",
            "overall_recommendation", "started_at", "submitted_at", "approved_at", "completed_at", "cancelled_at",
            "status_reason", "total_questions", "answered_count", "mandatory_unanswered_count", "compliant_count",
            "non_compliant_count", "not_applicable_count", "team", "permissions", "created_by", "updated_at",
        ]

    def get_team(self, obj):
        return AssignmentSerializer(obj.assignments.filter(is_active=True).select_related("user"), many=True).data

    def get_permissions(self, obj):
        user = self.context["request"].user
        S = Audit.Status
        manage = user.can(Cap.MANAGE_AUDITS)
        execute = services.can_execute(user, obj)
        review = services.can_review(user, obj)
        return {
            "can_edit": manage and obj.status not in (S.COMPLETED, S.CANCELLED),
            "can_delete": manage and obj.status == S.DRAFT,
            "can_schedule": manage and obj.status == S.DRAFT,
            "can_start": execute and obj.status in (S.SCHEDULED, S.REWORK_REQUIRED),
            "can_execute": execute and obj.status in Audit.EDITABLE_STATES,
            "can_submit": execute and obj.status == S.IN_PROGRESS,
            "can_review": review and obj.status == S.SUBMITTED,
            "can_complete": (review or manage) and obj.status == S.APPROVED,
            "can_cancel": manage and obj.status in (S.DRAFT, S.SCHEDULED, S.IN_PROGRESS, S.REWORK_REQUIRED,
                                                    S.SUBMITTED),
            "can_reopen": manage and obj.status in (S.APPROVED, S.COMPLETED, S.CANCELLED),
            "can_raise_findings": user.can(Cap.MANAGE_FINDINGS) and (
                (execute and obj.status in Audit.EDITABLE_STATES)
                or (review and obj.status in (S.IN_PROGRESS, S.REWORK_REQUIRED, S.SUBMITTED, S.APPROVED))
            ),
            "can_upload_evidence": (execute or review) and obj.status not in (S.COMPLETED, S.CANCELLED),
            "can_add_review_comments": review and obj.status == S.SUBMITTED,
            "can_resolve_review_comments": execute and obj.status in Audit.EDITABLE_STATES,
        }


class AuditWriteSerializer(serializers.ModelSerializer):
    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.none())
    template_version = serializers.PrimaryKeyRelatedField(queryset=AuditTemplateVersion.objects.none())
    lead_auditor = serializers.PrimaryKeyRelatedField(queryset=User.objects.none(), allow_null=True, required=False)
    reviewer = serializers.PrimaryKeyRelatedField(queryset=User.objects.none(), allow_null=True, required=False)
    department_contact = serializers.PrimaryKeyRelatedField(queryset=User.objects.none(), allow_null=True,
                                                            required=False)
    team_member_ids = serializers.ListField(child=serializers.IntegerField(), required=False)

    class Meta:
        model = Audit
        fields = [
            "id", "title", "department", "template_version", "audit_type", "period_start", "period_end",
            "planned_start_date", "due_date", "lead_auditor", "reviewer", "department_contact", "scope",
            "objectives", "priority", "team_member_ids",
        ]
        read_only_fields = ["id"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        org_id = self.context["request"].user.organization_id
        users = User.objects.filter(organization_id=org_id, is_active=True)
        self.fields["department"].queryset = Department.objects.filter(organization_id=org_id, is_active=True)
        self.fields["template_version"].queryset = AuditTemplateVersion.objects.filter(
            template__organization_id=org_id
        ).select_related("template")
        for name in ("lead_auditor", "reviewer", "department_contact"):
            self.fields[name].queryset = users

    def validate(self, attrs):
        get = lambda name: attrs.get(name, getattr(self.instance, name, None))  # noqa: E731
        errors = {}
        if get("planned_start_date") and get("due_date") and get("due_date") < get("planned_start_date"):
            errors["due_date"] = ["Due date cannot be before the planned start date."]
        if get("period_start") and get("period_end") and get("period_end") < get("period_start"):
            errors["period_end"] = ["Period end cannot be before period start."]
        lead, reviewer = get("lead_auditor"), get("reviewer")
        if lead and lead.role not in CAPABILITIES[Cap.PERFORM_AUDITS]:
            errors["lead_auditor"] = ["This user's role cannot perform audits."]
        if reviewer and reviewer.role not in CAPABILITIES[Cap.REVIEW_AUDITS]:
            errors["reviewer"] = ["This user's role cannot review audits."]
        if lead and reviewer and lead.id == reviewer.id:
            errors["reviewer"] = ["The reviewer must be independent of the lead auditor."]
        team = attrs.get("team_member_ids") or []
        if reviewer and reviewer.id in team:
            errors["team_member_ids"] = ["The reviewer cannot also be on the audit team."]
        if team:
            valid = set(User.objects.filter(
                id__in=team, organization_id=self.context["request"].user.organization_id, is_active=True,
                role__in=CAPABILITIES[Cap.PERFORM_AUDITS],
            ).values_list("id", flat=True))
            if set(team) - valid:
                errors["team_member_ids"] = ["Team members must be active users who can perform audits."]
        version, department = get("template_version"), get("department")
        if version and department and version.template.department_id not in (None, department.id):
            errors["template_version"] = ["This template belongs to a different department."]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class EvidenceSerializer(serializers.ModelSerializer):
    uploaded_by = UserSummarySerializer(read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvidence
        fields = ["id", "audit", "response", "finding", "original_name", "content_type", "size", "sha256",
                  "description", "uploaded_by", "created_at", "download_url"]

    def get_download_url(self, obj):
        return f"/api/audit-evidence/{obj.id}/download/"


class ResponseSerializer(serializers.ModelSerializer):
    evidence = EvidenceSerializer(many=True, read_only=True)
    answered_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = AuditResponse
        fields = ["id", "question", "choice_value", "text_value", "number_value", "date_value", "rating_value",
                  "is_not_applicable", "manual_assessment", "compliance", "observation", "recommendation",
                  "risk_flagged", "answered_by", "updated_at", "evidence"]


class ResponseItemSerializer(serializers.Serializer):
    question_id = serializers.IntegerField()
    choice_value = serializers.ChoiceField(choices=AuditResponse.Choice.choices, required=False, allow_blank=True,
                                           allow_null=True)
    text_value = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    number_value = serializers.DecimalField(max_digits=14, decimal_places=4, required=False, allow_null=True)
    date_value = serializers.DateField(required=False, allow_null=True)
    rating_value = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=10)
    is_not_applicable = serializers.BooleanField(required=False)
    manual_assessment = serializers.ChoiceField(choices=["COMPLIANT", "NON_COMPLIANT"], required=False,
                                                allow_blank=True, allow_null=True)
    observation = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    recommendation = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    risk_flagged = serializers.BooleanField(required=False)


class SaveResponsesSerializer(serializers.Serializer):
    responses = ResponseItemSerializer(many=True, required=False)
    overall_summary = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    overall_recommendation = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class ReviewDecisionSerializer(serializers.ModelSerializer):
    reviewer = UserSummarySerializer(read_only=True)

    class Meta:
        model = ReviewDecision
        fields = ["id", "decision", "comments", "reviewer", "created_at"]


class ReviewCommentSerializer(serializers.ModelSerializer):
    author = UserSummarySerializer(read_only=True)
    resolved_by = UserSummarySerializer(read_only=True)
    question_code = serializers.CharField(source="question.code", read_only=True, default=None)

    class Meta:
        model = ReviewComment
        fields = ["id", "question", "question_code", "body", "author", "is_resolved", "resolution_note",
                  "resolved_by", "resolved_at", "created_at"]


class ReviewCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField()
    question_id = serializers.IntegerField(required=False, allow_null=True)


class ResolveCommentSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True)


class CommentsSerializer(serializers.Serializer):
    comments = serializers.CharField(required=False, allow_blank=True)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField()


class EvidenceUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    response_id = serializers.IntegerField(required=False, allow_null=True)
    finding_id = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(required=False, allow_blank=True, max_length=500)
