import django_filters
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.roles import Cap
from apps.core.permissions import capability_required

from .models import AuditActivityLog
from .serializers import ActivityLogSerializer
from .services import verify_chain


class ActivityLogFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    action = django_filters.CharFilter(field_name="action", lookup_expr="istartswith")

    class Meta:
        model = AuditActivityLog
        fields = ["actor", "object_type", "object_id", "action"]


class ActivityLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only, searchable activity history. There are no write endpoints."""

    serializer_class = ActivityLogSerializer
    permission_classes = [capability_required(Cap.VIEW_ACTIVITY_LOGS, read_capability=Cap.VIEW_ACTIVITY_LOGS)]
    filterset_class = ActivityLogFilter
    search_fields = ["action", "object_repr", "actor_email", "object_type"]
    ordering_fields = ["created_at", "action"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        return AuditActivityLog.objects.filter(organization_id=self.request.user.organization_id).select_related(
            "actor")

    @action(detail=False, methods=["get"], url_path="verify-integrity")
    def verify_integrity(self, request):
        broken = verify_chain(request.user.organization)
        return Response({"intact": not broken, "broken_entry_ids": broken[:100],
                         "checked": self.get_queryset().count()})
