from django.contrib import admin

from .models import AuditActivityLog


@admin.register(AuditActivityLog)
class AuditActivityLogAdmin(admin.ModelAdmin):
    """Read-only: history can be inspected but never changed from the admin."""

    list_display = ["created_at", "organization", "actor_email", "action", "object_type", "object_repr"]
    list_filter = ["organization", "action", "object_type"]
    search_fields = ["actor_email", "action", "object_repr", "object_id"]
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
