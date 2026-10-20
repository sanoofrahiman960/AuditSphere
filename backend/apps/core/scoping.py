"""
Object visibility rules — the single source of truth used by viewsets,
dashboards, reports, search and file downloads.

Every function starts from the user's organisation, so cross-tenant access is
impossible regardless of role.
"""
from django.db.models import Q

from apps.accounts.roles import Role


def managed_department_ids(user):
    from apps.departments.models import Department, DepartmentMembership

    direct = Department.objects.filter(organization_id=user.organization_id, manager=user).values_list("id", flat=True)
    via_membership = DepartmentMembership.objects.filter(
        user=user, is_active=True, member_role=DepartmentMembership.MemberRole.MANAGER,
        department__organization_id=user.organization_id,
    ).values_list("department_id", flat=True)
    return set(direct) | set(via_membership)


def member_department_ids(user):
    from apps.departments.models import DepartmentMembership

    return set(
        DepartmentMembership.objects.filter(
            user=user, is_active=True, department__organization_id=user.organization_id
        ).values_list("department_id", flat=True)
    ) | managed_department_ids(user)


def visible_departments(user):
    from apps.departments.models import Department

    qs = Department.objects.filter(organization_id=user.organization_id)
    if user.has_org_wide_read:
        return qs
    return qs.filter(id__in=member_department_ids(user))


def visible_audits(user):
    from apps.audits.models import Audit, AuditAssignment

    qs = Audit.objects.filter(organization_id=user.organization_id)
    if user.has_org_wide_read:
        return qs
    assigned = AuditAssignment.objects.filter(user=user, is_active=True).values("audit_id")
    condition = Q(lead_auditor=user) | Q(reviewer=user) | Q(department_contact=user) | Q(id__in=assigned)
    managed = managed_department_ids(user)
    if managed:
        # Managers see their departments' audits once they are planned (not internal drafts).
        condition |= Q(department_id__in=managed) & ~Q(status=Audit.Status.DRAFT)
    return qs.filter(condition)


def visible_findings(user):
    from apps.corrective_actions.models import CorrectiveAction
    from apps.findings.models import AuditFinding

    qs = AuditFinding.objects.filter(organization_id=user.organization_id)
    if user.has_org_wide_read:
        return qs
    owned_action_findings = CorrectiveAction.objects.filter(
        organization_id=user.organization_id, owner=user
    ).values("finding_id")
    return qs.filter(
        Q(audit_id__in=visible_audits(user).values("id")) | Q(owner=user) | Q(id__in=owned_action_findings)
    )


def visible_actions(user):
    from apps.corrective_actions.models import CorrectiveAction

    qs = CorrectiveAction.objects.filter(organization_id=user.organization_id)
    if user.has_org_wide_read:
        return qs
    return qs.filter(Q(finding_id__in=visible_findings(user).values("id")) | Q(owner=user))


def is_audit_team_member(user, audit):
    """Lead auditor or active co-auditor (the people who execute the checklist)."""
    if audit.lead_auditor_id == user.id:
        return True
    return audit.assignments.filter(user=user, is_active=True, assignment_role__in=["LEAD_AUDITOR", "AUDITOR"]).exists()


def manages_department(user, department_id):
    if user.role in (Role.SUPER_ADMIN, Role.AUDIT_ADMIN):
        return True
    return department_id in managed_department_ids(user)
