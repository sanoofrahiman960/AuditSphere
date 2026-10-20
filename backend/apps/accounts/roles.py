"""
Role definitions and the capability matrix.

Roles are stored on the user. Capabilities are the coarse "may this kind of user
do X at all" checks; object-level visibility is handled by apps.core.scoping.
"""
from django.db import models


class Role(models.TextChoices):
    SUPER_ADMIN = "SUPER_ADMIN", "Super Administrator"
    AUDIT_ADMIN = "AUDIT_ADMIN", "Audit Administrator"
    AUDITOR = "AUDITOR", "Auditor"
    REVIEWER = "REVIEWER", "Reviewer"
    DEPT_MANAGER = "DEPT_MANAGER", "Department Manager"
    ACTION_OWNER = "ACTION_OWNER", "Corrective Action Owner"
    EXECUTIVE = "EXECUTIVE", "Management / Executive Viewer"


ADMIN_ROLES = frozenset({Role.SUPER_ADMIN, Role.AUDIT_ADMIN})
# Roles that can read every department's data in their organisation.
ORG_WIDE_READ_ROLES = frozenset({Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.EXECUTIVE})


class Cap:
    MANAGE_USERS = "manage_users"
    MANAGE_SETTINGS = "manage_settings"
    MANAGE_DEPARTMENTS = "manage_departments"
    MANAGE_TEMPLATES = "manage_templates"
    MANAGE_AUDITS = "manage_audits"
    PERFORM_AUDITS = "perform_audits"
    REVIEW_AUDITS = "review_audits"
    MANAGE_FINDINGS = "manage_findings"
    MANAGE_ACTIONS = "manage_actions"
    VERIFY_ACTIONS = "verify_actions"
    VIEW_ACTIVITY_LOGS = "view_activity_logs"
    VIEW_REPORTS = "view_reports"
    USE_AI = "use_ai"


CAPABILITIES = {
    Cap.MANAGE_USERS: {Role.SUPER_ADMIN},
    Cap.MANAGE_SETTINGS: {Role.SUPER_ADMIN},
    Cap.MANAGE_DEPARTMENTS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN},
    Cap.MANAGE_TEMPLATES: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN},
    Cap.MANAGE_AUDITS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN},
    Cap.PERFORM_AUDITS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.AUDITOR},
    Cap.REVIEW_AUDITS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.REVIEWER},
    Cap.MANAGE_FINDINGS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.AUDITOR, Role.REVIEWER},
    Cap.MANAGE_ACTIONS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.DEPT_MANAGER},
    Cap.VERIFY_ACTIONS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.REVIEWER},
    Cap.VIEW_ACTIVITY_LOGS: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN},
    Cap.VIEW_REPORTS: {
        Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.AUDITOR, Role.REVIEWER, Role.DEPT_MANAGER, Role.EXECUTIVE,
    },
    Cap.USE_AI: {Role.SUPER_ADMIN, Role.AUDIT_ADMIN, Role.AUDITOR, Role.REVIEWER, Role.DEPT_MANAGER},
}


def has_capability(user, capability):
    if not user or not user.is_authenticated or not getattr(user, "organization_id", None):
        return False
    return user.role in CAPABILITIES.get(capability, set())


def capabilities_for(user):
    return sorted(cap for cap, roles in CAPABILITIES.items() if user.role in roles)
