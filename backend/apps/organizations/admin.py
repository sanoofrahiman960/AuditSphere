from django.contrib import admin

from .models import Organization, OrganizationSettings


class SettingsInline(admin.StackedInline):
    model = OrganizationSettings
    can_delete = False


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "is_active", "created_at"]
    prepopulated_fields = {"slug": ("name",)}
    inlines = [SettingsInline]
