from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsOrgMember

from .models import Notification, NotificationPreference, NotificationType


class NotificationSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_notification_type_display", read_only=True)

    class Meta:
        model = Notification
        fields = ["id", "notification_type", "type_display", "title", "message", "link", "target_type", "target_id",
                  "is_read", "read_at", "email_status", "created_at"]
        read_only_fields = fields


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """The caller's own notifications."""

    serializer_class = NotificationSerializer
    permission_classes = [IsOrgMember]
    filterset_fields = ["is_read", "notification_type"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=["is_read", "read_at", "updated_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        updated = self.get_queryset().filter(is_read=False).update(is_read=True, read_at=timezone.now())
        return Response({"updated": updated})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"count": self.get_queryset().filter(is_read=False).count()})


class PreferenceItemSerializer(serializers.Serializer):
    notification_type = serializers.ChoiceField(choices=NotificationType.choices)
    in_app = serializers.BooleanField()
    email = serializers.BooleanField()


class NotificationPreferencesView(APIView):
    """GET the full preference matrix (defaults filled in); PUT a list to update it."""

    permission_classes = [IsOrgMember]

    def _matrix(self, user):
        stored = {p.notification_type: p for p in NotificationPreference.objects.filter(user=user)}
        return [
            {
                "notification_type": value,
                "label": label,
                "in_app": stored[value].in_app if value in stored else True,
                "email": stored[value].email if value in stored else True,
            }
            for value, label in NotificationType.choices
        ]

    def get(self, request):
        return Response(self._matrix(request.user))

    @transaction.atomic
    def put(self, request):
        serializer = PreferenceItemSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        for item in serializer.validated_data:
            NotificationPreference.objects.update_or_create(
                user=request.user, notification_type=item["notification_type"],
                defaults={"in_app": item["in_app"], "email": item["email"]},
            )
        return Response(self._matrix(request.user))
