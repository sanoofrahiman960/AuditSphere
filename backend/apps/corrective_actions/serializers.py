from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import UserSummarySerializer
from apps.audits.models import Priority
from apps.audits.serializers import DepartmentRefSerializer
from apps.core.scoping import visible_findings
from apps.findings.models import AuditFinding

from . import services
from .models import ActionComment, ActionEvidence, ActionStatusChange, CorrectiveAction


class FindingRefSerializer(serializers.ModelSerializer):
    audit_id = serializers.IntegerField(read_only=True)
    audit_reference = serializers.CharField(source="audit.reference", read_only=True)

    class Meta:
        model = AuditFinding
        fields = ["id", "reference", "title", "severity", "status", "audit_id", "audit_reference"]


class CorrectiveActionSerializer(serializers.ModelSerializer):
    finding = FindingRefSerializer(read_only=True)
    department = DepartmentRefSerializer(read_only=True)
    owner = UserSummarySerializer(read_only=True)
    verified_by = UserSummarySerializer(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = CorrectiveAction
        fields = [
            "id", "reference", "finding", "department", "action_type", "title", "description", "owner", "due_date",
            "priority", "status", "status_display", "progress", "resolution_notes", "verification_result",
            "verification_notes", "verified_by", "verified_at", "submitted_at", "closed_at", "is_overdue",
            "created_at", "updated_at",
        ]


class ActionCommentSerializer(serializers.ModelSerializer):
    author = UserSummarySerializer(read_only=True)

    class Meta:
        model = ActionComment
        fields = ["id", "body", "author", "created_at"]
        read_only_fields = ["id", "author", "created_at"]


class ActionEvidenceSerializer(serializers.ModelSerializer):
    uploaded_by = UserSummarySerializer(read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ActionEvidence
        fields = ["id", "original_name", "content_type", "size", "sha256", "description", "uploaded_by",
                  "created_at", "download_url"]

    def get_download_url(self, obj):
        return f"/api/action-evidence/{obj.id}/download/"


class StatusChangeSerializer(serializers.ModelSerializer):
    changed_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = ActionStatusChange
        fields = ["id", "from_status", "to_status", "changed_by", "note", "created_at"]


class CorrectiveActionDetailSerializer(CorrectiveActionSerializer):
    comments = ActionCommentSerializer(many=True, read_only=True)
    evidence = ActionEvidenceSerializer(many=True, read_only=True)
    status_changes = StatusChangeSerializer(many=True, read_only=True)
    created_by = UserSummarySerializer(read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta(CorrectiveActionSerializer.Meta):
        fields = CorrectiveActionSerializer.Meta.fields + [
            "comments", "evidence", "status_changes", "created_by", "permissions",
        ]

    def get_permissions(self, obj):
        user = self.context["request"].user
        S = CorrectiveAction.Status
        manage = services.can_manage(user, obj)
        work = services.can_work_on(user, obj)
        reopener = user.can("verify_actions") and (
            user.role in ("SUPER_ADMIN", "AUDIT_ADMIN") or obj.finding.audit.reviewer_id == user.id)
        return {
            "can_edit": obj.status != S.CLOSED and (manage or obj.owner_id == user.id),
            "can_edit_all_fields": obj.status != S.CLOSED and manage,
            "can_start": work and obj.status in (S.OPEN, S.REWORK_REQUIRED),
            "can_submit_verification": work and obj.status in (S.OPEN, S.IN_PROGRESS, S.REWORK_REQUIRED),
            "can_verify": obj.status == S.PENDING_VERIFICATION and services.can_verify(user, obj),
            "can_reopen": obj.status == S.CLOSED and reopener,
            "can_comment": user.role != "EXECUTIVE",
            "can_upload_evidence": obj.status != S.CLOSED and work,
            "is_owner": obj.owner_id == user.id,
        }


class CorrectiveActionWriteSerializer(serializers.ModelSerializer):
    finding = serializers.PrimaryKeyRelatedField(queryset=AuditFinding.objects.none())
    owner = serializers.PrimaryKeyRelatedField(queryset=User.objects.none())
    priority = serializers.ChoiceField(choices=Priority.choices, required=False)

    class Meta:
        model = CorrectiveAction
        fields = ["id", "finding", "action_type", "title", "description", "owner", "due_date", "priority",
                  "progress", "resolution_notes"]
        read_only_fields = ["id"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        user = self.context["request"].user
        self.fields["finding"].queryset = visible_findings(user)
        self.fields["owner"].queryset = User.objects.filter(organization_id=user.organization_id, is_active=True)
        if self.instance is not None:
            self.fields["finding"].read_only = True


class VerifySerializer(serializers.Serializer):
    approved = serializers.BooleanField()
    notes = serializers.CharField(required=False, allow_blank=True)


class SubmitVerificationSerializer(serializers.Serializer):
    resolution_notes = serializers.CharField(required=False, allow_blank=True)


class ActionNotesSerializer(serializers.Serializer):
    notes = serializers.CharField()


class EvidenceUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    description = serializers.CharField(required=False, allow_blank=True, max_length=500)
