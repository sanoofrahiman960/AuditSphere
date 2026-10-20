from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.accounts.views import ChangePasswordView, LoginView, LogoutView, MeView, RefreshView, UserViewSet
from apps.activity_logs.views import ActivityLogViewSet
from apps.ai_assistant.views import (
    ActionRecommendationDraftView,
    AIStatusView,
    AuditSummaryDraftView,
    PolicyDocumentViewSet,
    PolicySearchView,
)
from apps.audit_templates.views import AuditCategoryViewSet, AuditTemplateVersionViewSet, AuditTemplateViewSet
from apps.audits.views import AuditEvidenceViewSet, AuditViewSet
from apps.core.views import GlobalSearchView, HealthView, ReadinessView
from apps.corrective_actions.views import ActionEvidenceViewSet, CorrectiveActionViewSet
from apps.departments.views import DepartmentViewSet
from apps.findings.views import FindingViewSet
from apps.notifications.views import NotificationPreferencesView, NotificationViewSet
from apps.organizations.views import CurrentOrganizationView
from apps.reports import views as reports

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("departments", DepartmentViewSet, basename="department")
router.register("audit-categories", AuditCategoryViewSet, basename="audit-category")
router.register("audit-templates", AuditTemplateViewSet, basename="audit-template")
router.register("template-versions", AuditTemplateVersionViewSet, basename="template-version")
router.register("audits", AuditViewSet, basename="audit")
router.register("audit-evidence", AuditEvidenceViewSet, basename="audit-evidence")
router.register("findings", FindingViewSet, basename="finding")
router.register("corrective-actions", CorrectiveActionViewSet, basename="corrective-action")
router.register("action-evidence", ActionEvidenceViewSet, basename="action-evidence")
router.register("notifications", NotificationViewSet, basename="notification")
router.register("activity-logs", ActivityLogViewSet, basename="activity-log")
router.register("ai/policy-documents", PolicyDocumentViewSet, basename="policy-document")

auth_patterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("change-password/", ChangePasswordView.as_view(), name="auth-change-password"),
]

dashboard_patterns = [
    path("summary/", reports.DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("my-work/", reports.MyWorkView.as_view(), name="dashboard-my-work"),
    path("status-distribution/", reports.StatusDistributionView.as_view(), name="dashboard-status"),
    path("department-compliance/", reports.DepartmentComplianceView.as_view(), name="dashboard-departments"),
    path("risk-distribution/", reports.RiskDistributionView.as_view(), name="dashboard-risk"),
    path("monthly-trend/", reports.MonthlyTrendView.as_view(), name="dashboard-trend"),
    path("upcoming-audits/", reports.UpcomingAuditsView.as_view(), name="dashboard-upcoming"),
    path("recent-activity/", reports.RecentActivityView.as_view(), name="dashboard-activity"),
    path("overdue-actions/", reports.OverdueActionsView.as_view(), name="dashboard-overdue-actions"),
]

report_patterns = [
    path("", reports.ReportCatalogView.as_view(), name="report-catalog"),
    path("<slug:key>/", reports.ReportView.as_view(), name="report-detail"),
    path("<slug:key>/export/<str:fmt>/", reports.ReportExportView.as_view(), name="report-export"),
]

ai_patterns = [
    path("status/", AIStatusView.as_view(), name="ai-status"),
    path("policy-search/", PolicySearchView.as_view(), name="ai-policy-search"),
    path("audits/<int:audit_id>/summary-draft/", AuditSummaryDraftView.as_view(), name="ai-audit-summary"),
    path("findings/<int:finding_id>/recommendation-draft/", ActionRecommendationDraftView.as_view(),
         name="ai-finding-recommendation"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", HealthView.as_view(), name="health"),
    path("api/health/ready/", ReadinessView.as_view(), name="health-ready"),
    path("api/auth/", include(auth_patterns)),
    path("api/organization/", CurrentOrganizationView.as_view(), name="organization"),
    path("api/notification-preferences/", NotificationPreferencesView.as_view(), name="notification-preferences"),
    path("api/search/", GlobalSearchView.as_view(), name="search"),
    path("api/dashboard/", include(dashboard_patterns)),
    path("api/reports/", include(report_patterns)),
    path("api/ai/", include(ai_patterns)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
    path("api/", include(router.urls)),
]
