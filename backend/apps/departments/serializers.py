from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import UserSummarySerializer

from .models import Department, DepartmentMembership


class DepartmentSerializer(serializers.ModelSerializer):
    manager = serializers.PrimaryKeyRelatedField(queryset=User.objects.none(), allow_null=True, required=False)
    manager_detail = UserSummarySerializer(source="manager", read_only=True)
    member_count = serializers.IntegerField(read_only=True)
    open_findings = serializers.IntegerField(read_only=True)
    audit_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = [
            "id", "name", "code", "description", "manager", "manager_detail", "is_active", "member_count",
            "audit_count", "open_findings", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_active", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["manager"].queryset = User.objects.filter(
                organization_id=request.user.organization_id, is_active=True
            )

    def validate_name(self, value):
        org_id = self.context["request"].user.organization_id
        qs = Department.objects.filter(organization_id=org_id, name__iexact=value.strip())
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A department with this name already exists.")
        return value.strip()


class DepartmentMembershipSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.none())
    user_detail = UserSummarySerializer(source="user", read_only=True)

    class Meta:
        model = DepartmentMembership
        fields = ["id", "user", "user_detail", "member_role", "is_active", "created_at"]
        read_only_fields = ["id", "is_active", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["user"].queryset = User.objects.filter(organization_id=request.user.organization_id)
