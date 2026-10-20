from rest_framework import serializers

from .models import Organization, OrganizationSettings


class OrganizationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrganizationSettings
        fields = [
            "risk_critical_threshold", "risk_high_threshold", "risk_medium_threshold", "compliance_target",
            "audit_reminder_days", "action_reminder_days", "overdue_reminder_interval_days",
            "allow_self_verification", "email_notifications_enabled", "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def _validate_days(self, value):
        if not isinstance(value, list) or not all(isinstance(d, int) and 0 <= d <= 365 for d in value):
            raise serializers.ValidationError("Provide a list of whole days between 0 and 365, e.g. [7, 3, 1].")
        return sorted(set(value), reverse=True)

    def validate_audit_reminder_days(self, value):
        return self._validate_days(value)

    def validate_action_reminder_days(self, value):
        return self._validate_days(value)

    def validate(self, attrs):
        inst = self.instance
        critical = attrs.get("risk_critical_threshold", inst.risk_critical_threshold if inst else 20)
        high = attrs.get("risk_high_threshold", inst.risk_high_threshold if inst else 12)
        medium = attrs.get("risk_medium_threshold", inst.risk_medium_threshold if inst else 6)
        if not critical > high > medium >= 1:
            raise serializers.ValidationError(
                {"risk_high_threshold": ["Thresholds must satisfy critical > high > medium ≥ 1."]}
            )
        return attrs


class OrganizationSerializer(serializers.ModelSerializer):
    settings = OrganizationSettingsSerializer(read_only=True)

    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "is_active", "settings", "created_at"]
        read_only_fields = ["id", "slug", "is_active", "settings", "created_at"]
