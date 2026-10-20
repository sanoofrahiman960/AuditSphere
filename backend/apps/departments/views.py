from django.db import transaction
from django.db.models import Count, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.roles import Cap
from apps.activity_logs.services import diff, log_activity, snapshot
from apps.core.permissions import capability_required
from apps.core.scoping import visible_actions, visible_audits, visible_departments, visible_findings
from apps.findings.models import AuditFinding
from apps.reports import metrics

from .models import Department, DepartmentMembership
from .serializers import DepartmentMembershipSerializer, DepartmentSerializer


class DepartmentViewSet(viewsets.ModelViewSet):
    """
    Departments. Administrators create/edit/deactivate; other users see the
    departments they belong to or manage. DELETE deactivates (records are kept).
    """

    serializer_class = DepartmentSerializer
    permission_classes = [capability_required(Cap.MANAGE_DEPARTMENTS)]
    filterset_fields = ["is_active", "manager"]
    search_fields = ["name", "code", "description"]
    ordering_fields = ["name", "created_at"]

    def get_queryset(self):
        return visible_departments(self.request.user).select_related("manager").annotate(
            member_count=Count("memberships", filter=Q(memberships__is_active=True), distinct=True),
            audit_count=Count("audits", distinct=True),
            open_findings=Count("findings", filter=Q(findings__status__in=AuditFinding.OPEN_STATES), distinct=True),
        ).order_by("name")

    @transaction.atomic
    def perform_create(self, serializer):
        dept = serializer.save(organization=self.request.user.organization)
        if dept.manager_id:
            DepartmentMembership.objects.update_or_create(
                department=dept, user=dept.manager,
                defaults={"member_role": DepartmentMembership.MemberRole.MANAGER, "is_active": True},
            )
        log_activity(self.request.user, "department.created", dept, request=self.request,
                     changes={"name": dept.name, "manager": dept.manager_id})

    @transaction.atomic
    def perform_update(self, serializer):
        before = snapshot(serializer.instance)
        dept = serializer.save()
        if dept.manager_id:
            DepartmentMembership.objects.update_or_create(
                department=dept, user=dept.manager,
                defaults={"member_role": DepartmentMembership.MemberRole.MANAGER, "is_active": True},
            )
        changes = diff(before, snapshot(dept))
        if changes:
            log_activity(self.request.user, "department.updated", dept, changes=changes, request=self.request)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        dept = self.get_object()
        if dept.is_active:
            dept.is_active = False
            dept.save(update_fields=["is_active", "updated_at"])
            log_activity(request.user, "department.deactivated", dept, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def activate(self, request, pk=None):
        dept = self.get_object()
        if not dept.is_active:
            dept.is_active = True
            dept.save(update_fields=["is_active", "updated_at"])
            log_activity(request.user, "department.activated", dept, request=request)
        return Response(self.get_serializer(self.get_queryset().get(pk=dept.pk)).data)

    @action(detail=True, methods=["get", "post"])
    def members(self, request, pk=None):
        dept = self.get_object()
        if request.method == "GET":
            memberships = dept.memberships.filter(is_active=True).select_related("user")
            return Response(DepartmentMembershipSerializer(memberships, many=True, context={"request": request}).data)
        serializer = DepartmentMembershipSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            membership, _ = DepartmentMembership.objects.update_or_create(
                department=dept, user=serializer.validated_data["user"],
                defaults={"member_role": serializer.validated_data.get("member_role", "MEMBER"), "is_active": True},
            )
            log_activity(request.user, "department.member_added", dept, request=request,
                         changes={"user": membership.user.email, "member_role": membership.member_role})
        return Response(DepartmentMembershipSerializer(membership, context={"request": request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"members/(?P<membership_id>\d+)")
    @transaction.atomic
    def remove_member(self, request, pk=None, membership_id=None):
        dept = self.get_object()
        membership = dept.memberships.filter(id=membership_id, is_active=True).select_related("user").first()
        if membership is None:
            return Response({"detail": "Membership not found.", "code": "not_found", "errors": None},
                            status=status.HTTP_404_NOT_FOUND)
        membership.is_active = False
        membership.save(update_fields=["is_active", "updated_at"])
        if dept.manager_id == membership.user_id:
            dept.manager = None
            dept.save(update_fields=["manager", "updated_at"])
        log_activity(request.user, "department.member_removed", dept, request=request,
                     changes={"user": membership.user.email})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        dept = self.get_object()
        user = request.user
        audits = visible_audits(user).filter(department=dept)
        findings = visible_findings(user).filter(department=dept)
        actions = visible_actions(user).filter(department=dept)
        return Response({
            "summary": metrics.summary(audits, findings, actions,
                                       user.organization.settings.compliance_target),
            "status_distribution": metrics.status_distribution(audits),
            "risk_distribution": metrics.risk_distribution(findings),
            "trend": metrics.completion_trend(audits, months=6),
        })
