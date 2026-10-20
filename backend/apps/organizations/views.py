from django.db import transaction
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.roles import Cap
from apps.activity_logs.services import diff, log_activity, snapshot
from apps.core.permissions import IsOrgMember

from .serializers import OrganizationSerializer, OrganizationSettingsSerializer


class CurrentOrganizationView(APIView):
    """GET the caller's organisation (with settings); PATCH name/settings (Super Administrator)."""

    permission_classes = [IsOrgMember]

    def get(self, request):
        return Response(OrganizationSerializer(request.user.organization).data)

    @transaction.atomic
    def patch(self, request):
        if not request.user.can(Cap.MANAGE_SETTINGS):
            raise PermissionDenied("Only a Super Administrator can change organisation settings.")
        org = request.user.organization
        if "name" in request.data:
            serializer = OrganizationSerializer(org, data={"name": request.data["name"]}, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
        settings_data = request.data.get("settings")
        if settings_data:
            before = snapshot(org.settings)
            serializer = OrganizationSettingsSerializer(org.settings, data=settings_data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            log_activity(request.user, "organization.settings_changed", org, request=request,
                         changes=diff(before, snapshot(org.settings)))
        org.refresh_from_db()
        return Response(OrganizationSerializer(org).data)
