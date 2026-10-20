from django.conf import settings
from django.db import models

from apps.core.models import OrgScopedModel, TimeStampedModel


class Department(OrgScopedModel):
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=20, blank=True)
    description = models.TextField(blank=True)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="managed_departments"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_department_name_per_org"),
        ]
        indexes = [models.Index(fields=["organization", "is_active"])]

    def __str__(self):
        return self.name


class DepartmentMembership(TimeStampedModel):
    class MemberRole(models.TextChoices):
        MANAGER = "MANAGER", "Manager"
        MEMBER = "MEMBER", "Member"

    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="department_memberships")
    member_role = models.CharField(max_length=10, choices=MemberRole.choices, default=MemberRole.MEMBER)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["department__name", "user__first_name"]
        constraints = [
            models.UniqueConstraint(fields=["department", "user"], name="uniq_department_membership"),
        ]

    def __str__(self):
        return f"{self.user} in {self.department} ({self.member_role})"
