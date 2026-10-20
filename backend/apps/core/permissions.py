from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.roles import Role, has_capability


class IsOrgMember(BasePermission):
    """Authenticated, active and attached to an active organisation."""

    message = "Your account is not attached to an active organisation."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated and user.is_active and user.organization_id
            and user.organization.is_active
        )


def capability_required(capability, *, read_capability=None):
    """
    Permission class factory. Writes need `capability`; reads are allowed to
    every org member (or need `read_capability` if given) and are further
    restricted by the viewset's scoped queryset.
    """

    class _HasCapability(IsOrgMember):
        message = "You do not have permission to perform this action."

        def has_permission(self, request, view):
            if not super().has_permission(request, view):
                return False
            if request.method in SAFE_METHODS:
                return read_capability is None or has_capability(request.user, read_capability)
            return has_capability(request.user, capability)

    _HasCapability.__name__ = f"Has_{capability}"
    return _HasCapability


class ReadOnlyForExecutives(IsOrgMember):
    """Executives can read everything in scope but never change data."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.method in SAFE_METHODS or request.user.role != Role.EXECUTIVE
