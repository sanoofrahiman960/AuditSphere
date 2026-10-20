import { lazy } from "react";
import { Route, createBrowserRouter, createRoutesFromElements } from "react-router-dom";
import { RouteErrorPage } from "@/features/misc/RouteErrorPage";
import { AppLayout } from "@/layouts/AppLayout";
import { ProtectedRoute, RequireCapability } from "@/routes/guards";
import LoginPage from "@/features/auth/LoginPage";

const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));
const AuditsPage = lazy(() => import("@/features/audits/AuditsPage"));
const AuditFormPage = lazy(() => import("@/features/audits/AuditFormPage"));
const AuditDetailPage = lazy(() => import("@/features/audits/AuditDetailPage"));
const AuditWorkspacePage = lazy(() => import("@/features/audits/AuditWorkspacePage"));
const FindingsPage = lazy(() => import("@/features/findings/FindingsPage"));
const FindingDetailPage = lazy(() => import("@/features/findings/FindingDetailPage"));
const ActionsPage = lazy(() => import("@/features/corrective-actions/ActionsPage"));
const ActionDetailPage = lazy(() => import("@/features/corrective-actions/ActionDetailPage"));
const DepartmentsPage = lazy(() => import("@/features/departments/DepartmentsPage"));
const DepartmentDetailPage = lazy(() => import("@/features/departments/DepartmentDetailPage"));
const TemplatesPage = lazy(() => import("@/features/audit-templates/TemplatesPage"));
const TemplateDetailPage = lazy(() => import("@/features/audit-templates/TemplateDetailPage"));
const TemplateVersionPage = lazy(() => import("@/features/audit-templates/TemplateVersionPage"));
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage"));
const NotificationsPage = lazy(() => import("@/features/notifications/NotificationsPage"));
const AssistantPage = lazy(() => import("@/features/ai/AssistantPage"));
const UsersPage = lazy(() => import("@/features/admin/UsersPage"));
const ActivityLogPage = lazy(() => import("@/features/admin/ActivityLogPage"));
const SettingsPage = lazy(() => import("@/features/admin/SettingsPage"));
const ProfilePage = lazy(() => import("@/features/auth/ProfilePage"));
const NotFoundPage = lazy(() => import("@/features/misc/NotFoundPage"));

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route errorElement={<RouteErrorPage />}>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="audits" element={<AuditsPage />} />
          <Route path="audits/new" element={<RequireCapability capability="manage_audits"><AuditFormPage /></RequireCapability>} />
          <Route path="audits/:id" element={<AuditDetailPage />} />
          <Route path="audits/:id/edit" element={<RequireCapability capability="manage_audits"><AuditFormPage /></RequireCapability>} />
          <Route path="audits/:id/workspace" element={<AuditWorkspacePage />} />
          <Route path="findings" element={<FindingsPage />} />
          <Route path="findings/:id" element={<FindingDetailPage />} />
          <Route path="actions" element={<ActionsPage />} />
          <Route path="actions/:id" element={<ActionDetailPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="departments/:id" element={<DepartmentDetailPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="templates/:id" element={<TemplateDetailPage />} />
          <Route path="templates/:id/versions/:versionId" element={<TemplateVersionPage />} />
          <Route path="reports" element={<RequireCapability capability="view_reports"><ReportsPage /></RequireCapability>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="assistant" element={<RequireCapability capability="use_ai"><AssistantPage /></RequireCapability>} />
          <Route path="admin/users" element={<RequireCapability capability="manage_users"><UsersPage /></RequireCapability>} />
          <Route path="admin/activity" element={<RequireCapability capability="view_activity_logs"><ActivityLogPage /></RequireCapability>} />
          <Route path="admin/settings" element={<RequireCapability capability="manage_settings"><SettingsPage /></RequireCapability>} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Route>,
  ),
  {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);
