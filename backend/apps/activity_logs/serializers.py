from rest_framework import serializers

from .models import AuditActivityLog


class ActivityLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditActivityLog
        fields = ["id", "created_at", "actor", "actor_email", "actor_name", "action", "object_type", "object_id",
                  "object_repr", "changes", "ip_address", "request_id", "hash"]
        read_only_fields = fields

    def get_actor_name(self, obj):
        return obj.actor.full_name if obj.actor_id and obj.actor else obj.actor_email
