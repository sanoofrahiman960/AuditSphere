// One function per backend endpoint (see backend/config/urls.py).
import type {
  ActionComment,
  ActionEvidence,
  ActivityLog,
  AIDraft,
  AIStatus,
  AuditCategory,
  AuditDetail,
  AuditListItem,
  AuditTemplate,
  AuditTemplateWrite,
  AuditWrite,
  CalendarEvent,
  CorrectiveAction,
  CorrectiveActionDetail,
  CorrectiveActionWrite,
  DashboardFilters,
  DashboardSummary,
  Department,
  DepartmentMembership,
  DepartmentRow,
  DepartmentStats,
  DepartmentWrite,
  Evidence,
  Finding,
  FindingDetail,
  FindingWrite,
  LoginResponse,
  Me,
  MyWork,
  Notification,
  NotificationPreference,
  Option,
  Organization,
  OrganizationSettings,
  OverdueAction,
  Paginated,
  PolicyAnswer,
  PolicyDocument,
  RecentActivity,
  Report,
  ReportCatalogItem,
  ReportFilters,
  ResponseInput,
  ReviewComment,
  ReviewDecision,
  RiskCount,
  ScoringMethod,
  RiskMatrix,
  SearchResult,
  Section,
  Severity,
  StatusCount,
  TemplateVersion,
  TrendPoint,
  UpcomingAudit,
  User,
  UserWrite,
  ValidationIssue,
  VersionSummary,
  Workspace,
} from "@/types/api";
import { del, downloadFile, get, patch, post, put, upload } from "./client";

export type ListParams = Record<string, string | number | boolean | (string | number)[] | undefined | null>;

// ---------------------------------------------------------------- auth
export const authApi = {
  login: (email: string, password: string) => post<LoginResponse>("/auth/login/", { email, password }),
  logout: (refresh: string) => post<void>("/auth/logout/", { refresh }),
  me: () => get<Me>("/auth/me/"),
  updateMe: (data: Partial<Pick<Me, "first_name" | "last_name" | "job_title" | "phone">>) =>
    patch<Me>("/auth/me/", data),
  changePassword: (current_password: string, new_password: string) =>
    post<{ detail: string }>("/auth/change-password/", { current_password, new_password }),
};

// ---------------------------------------------------------------- users & organisation
export const usersApi = {
  list: (params?: ListParams) => get<Paginated<User>>("/users/", params),
  get: (id: number) => get<User>(`/users/${id}/`),
  create: (data: UserWrite) => post<User>("/users/", data),
  update: (id: number, data: Partial<UserWrite>) => patch<User>(`/users/${id}/`, data),
  roles: () => get<Option[]>("/users/roles/"),
};

export const organizationApi = {
  get: () => get<Organization>("/organization/"),
  update: (data: { name?: string; settings?: Partial<OrganizationSettings> }) =>
    patch<Organization>("/organization/", data),
};

// ---------------------------------------------------------------- departments
export const departmentsApi = {
  list: (params?: ListParams) => get<Paginated<Department>>("/departments/", params),
  get: (id: number) => get<Department>(`/departments/${id}/`),
  create: (data: DepartmentWrite) => post<Department>("/departments/", data),
  update: (id: number, data: Partial<DepartmentWrite>) => patch<Department>(`/departments/${id}/`, data),
  deactivate: (id: number) => del(`/departments/${id}/`),
  activate: (id: number) => post<Department>(`/departments/${id}/activate/`),
  members: (id: number) => get<DepartmentMembership[]>(`/departments/${id}/members/`),
  addMember: (id: number, user: number, member_role: "MANAGER" | "MEMBER") =>
    post<DepartmentMembership>(`/departments/${id}/members/`, { user, member_role }),
  removeMember: (id: number, membershipId: number) => del(`/departments/${id}/members/${membershipId}/`),
  stats: (id: number) => get<DepartmentStats>(`/departments/${id}/stats/`),
};

// ---------------------------------------------------------------- templates
export const categoriesApi = {
  list: (params?: ListParams) => get<Paginated<AuditCategory>>("/audit-categories/", params),
  create: (data: { name: string; description?: string }) => post<AuditCategory>("/audit-categories/", data),
  update: (id: number, data: Partial<AuditCategory>) => patch<AuditCategory>(`/audit-categories/${id}/`, data),
  deactivate: (id: number) => del(`/audit-categories/${id}/`),
};

export const templatesApi = {
  list: (params?: ListParams) => get<Paginated<AuditTemplate>>("/audit-templates/", params),
  get: (id: number) => get<AuditTemplate>(`/audit-templates/${id}/`),
  create: (data: AuditTemplateWrite) => post<AuditTemplate>("/audit-templates/", data),
  update: (id: number, data: Partial<AuditTemplateWrite>) => patch<AuditTemplate>(`/audit-templates/${id}/`, data),
  versions: (id: number) => get<VersionSummary[]>(`/audit-templates/${id}/versions/`),
  newVersion: (id: number, data: { source_version?: number; change_notes?: string }) =>
    post<TemplateVersion>(`/audit-templates/${id}/versions/`, data),
  duplicate: (id: number, name: string) => post<AuditTemplate>(`/audit-templates/${id}/duplicate/`, { name }),
  getVersion: (versionId: number) => get<TemplateVersion>(`/template-versions/${versionId}/`),
  updateVersion: (
    versionId: number,
    data: { applicable_standard?: string; scoring_method?: ScoringMethod; change_notes?: string; sections?: Section[] },
  ) => patch<TemplateVersion>(`/template-versions/${versionId}/`, data),
  approveVersion: (versionId: number) => post<TemplateVersion>(`/template-versions/${versionId}/approve/`),
  archiveVersion: (versionId: number) => post<TemplateVersion>(`/template-versions/${versionId}/archive/`),
};

// ---------------------------------------------------------------- audits
export const auditsApi = {
  list: (params?: ListParams) => get<Paginated<AuditListItem>>("/audits/", params),
  calendar: (params: ListParams) => get<CalendarEvent[]>("/audits/calendar/", params),
  get: (id: number) => get<AuditDetail>(`/audits/${id}/`),
  create: (data: AuditWrite) => post<AuditDetail>("/audits/", data),
  update: (id: number, data: Partial<AuditWrite>) => patch<AuditDetail>(`/audits/${id}/`, data),
  remove: (id: number) => del(`/audits/${id}/`),
  schedule: (id: number) => post<AuditDetail>(`/audits/${id}/schedule/`),
  start: (id: number) => post<AuditDetail>(`/audits/${id}/start/`),
  submit: (id: number) => post<AuditDetail>(`/audits/${id}/submit/`),
  approve: (id: number, comments = "") => post<AuditDetail>(`/audits/${id}/approve/`, { comments }),
  requestRework: (id: number, comments: string) =>
    post<AuditDetail>(`/audits/${id}/request-rework/`, { comments }),
  complete: (id: number) => post<AuditDetail>(`/audits/${id}/complete/`),
  cancel: (id: number, reason: string) => post<AuditDetail>(`/audits/${id}/cancel/`, { reason }),
  reopen: (id: number, reason: string) => post<AuditDetail>(`/audits/${id}/reopen/`, { reason }),
  workspace: (id: number) => get<Workspace>(`/audits/${id}/workspace/`),
  saveResponses: (
    id: number,
    data: { responses?: ResponseInput[]; overall_summary?: string; overall_recommendation?: string },
  ) => put<Workspace>(`/audits/${id}/responses/`, data),
  validation: (id: number) => get<{ issues: ValidationIssue[] }>(`/audits/${id}/validation/`),
  evidence: (id: number) => get<Evidence[]>(`/audits/${id}/evidence/`),
  uploadEvidence: (
    id: number,
    file: File,
    extra: { response_id?: number | null; finding_id?: number | null; description?: string } = {},
  ) =>
    upload<Evidence>(`/audits/${id}/evidence/`, {
      file,
      response_id: extra.response_id ?? undefined,
      finding_id: extra.finding_id ?? undefined,
      description: extra.description,
    }),
  deleteEvidence: (evidenceId: number) => del(`/audit-evidence/${evidenceId}/`),
  reviews: (id: number) => get<ReviewDecision[]>(`/audits/${id}/reviews/`),
  reviewComments: (id: number) => get<ReviewComment[]>(`/audits/${id}/review-comments/`),
  addReviewComment: (id: number, body: string, questionId?: number | null) =>
    post<ReviewComment>(`/audits/${id}/review-comments/`, { body, question_id: questionId ?? null }),
  resolveReviewComment: (id: number, commentId: number, note = "") =>
    post<ReviewComment>(`/audits/${id}/review-comments/${commentId}/resolve/`, { note }),
  history: (id: number) => get<ActivityLog[]>(`/audits/${id}/history/`),
};

export const evidenceApi = {
  download: (downloadUrl: string, name: string) => downloadFile(downloadUrl, undefined, name),
};

// ---------------------------------------------------------------- findings
export const findingsApi = {
  list: (params?: ListParams) => get<Paginated<Finding>>("/findings/", params),
  get: (id: number) => get<FindingDetail>(`/findings/${id}/`),
  create: (data: FindingWrite) => post<FindingDetail>("/findings/", data),
  update: (id: number, data: Partial<FindingWrite>) => patch<FindingDetail>(`/findings/${id}/`, data),
  assess: (
    id: number,
    data: { likelihood: number; impact: number; override_severity?: Severity | null; rationale?: string },
  ) => post<FindingDetail>(`/findings/${id}/assess/`, data),
  close: (id: number, notes: string, accept_risk = false) =>
    post<FindingDetail>(`/findings/${id}/close/`, { notes, accept_risk }),
  reopen: (id: number, notes: string) => post<FindingDetail>(`/findings/${id}/reopen/`, { notes }),
  evidence: (id: number) => get<Evidence[]>(`/findings/${id}/evidence/`),
  uploadEvidence: (id: number, file: File, description = "") =>
    upload<Evidence>(`/findings/${id}/evidence/`, { file, description }),
  history: (id: number) => get<ActivityLog[]>(`/findings/${id}/history/`),
  riskMatrix: () => get<RiskMatrix>("/findings/risk-matrix/"),
};

// ---------------------------------------------------------------- corrective actions
export const actionsApi = {
  list: (params?: ListParams) => get<Paginated<CorrectiveAction>>("/corrective-actions/", params),
  get: (id: number) => get<CorrectiveActionDetail>(`/corrective-actions/${id}/`),
  create: (data: CorrectiveActionWrite) => post<CorrectiveActionDetail>("/corrective-actions/", data),
  update: (id: number, data: CorrectiveActionWrite) =>
    patch<CorrectiveActionDetail>(`/corrective-actions/${id}/`, data),
  start: (id: number) => post<CorrectiveActionDetail>(`/corrective-actions/${id}/start/`),
  submitVerification: (id: number, resolution_notes: string) =>
    post<CorrectiveActionDetail>(`/corrective-actions/${id}/submit-verification/`, { resolution_notes }),
  verify: (id: number, approved: boolean, notes = "") =>
    post<CorrectiveActionDetail>(`/corrective-actions/${id}/verify/`, { approved, notes }),
  reopen: (id: number, notes: string) => post<CorrectiveActionDetail>(`/corrective-actions/${id}/reopen/`, { notes }),
  comments: (id: number) => get<ActionComment[]>(`/corrective-actions/${id}/comments/`),
  addComment: (id: number, body: string) => post<ActionComment>(`/corrective-actions/${id}/comments/`, { body }),
  evidence: (id: number) => get<ActionEvidence[]>(`/corrective-actions/${id}/evidence/`),
  uploadEvidence: (id: number, file: File, description = "") =>
    upload<ActionEvidence>(`/corrective-actions/${id}/evidence/`, { file, description }),
};

// ---------------------------------------------------------------- notifications
export const notificationsApi = {
  list: (params?: ListParams) => get<Paginated<Notification>>("/notifications/", params),
  unreadCount: () => get<{ count: number }>("/notifications/unread-count/"),
  markRead: (id: number) => post<Notification>(`/notifications/${id}/read/`),
  markAllRead: () => post<{ updated: number }>("/notifications/read-all/"),
  preferences: () => get<NotificationPreference[]>("/notification-preferences/"),
  updatePreferences: (items: Omit<NotificationPreference, "label">[]) =>
    put<NotificationPreference[]>("/notification-preferences/", items),
};

// ---------------------------------------------------------------- dashboard
export const dashboardApi = {
  summary: (f?: DashboardFilters) => get<DashboardSummary>("/dashboard/summary/", f),
  myWork: () => get<MyWork>("/dashboard/my-work/"),
  statusDistribution: (f?: DashboardFilters) => get<StatusCount[]>("/dashboard/status-distribution/", f),
  departmentCompliance: (f?: DashboardFilters) => get<DepartmentRow[]>("/dashboard/department-compliance/", f),
  riskDistribution: (f?: DashboardFilters) => get<RiskCount[]>("/dashboard/risk-distribution/", f),
  monthlyTrend: (f?: DashboardFilters) => get<TrendPoint[]>("/dashboard/monthly-trend/", f),
  upcomingAudits: () => get<UpcomingAudit[]>("/dashboard/upcoming-audits/"),
  recentActivity: () => get<RecentActivity[]>("/dashboard/recent-activity/"),
  overdueActions: (f?: DashboardFilters) => get<OverdueAction[]>("/dashboard/overdue-actions/", f),
};

// ---------------------------------------------------------------- reports
export const reportsApi = {
  catalog: () => get<ReportCatalogItem[]>("/reports/"),
  get: (key: string, filters: ReportFilters) => get<Report>(`/reports/${key}/`, filters),
  export: (key: string, format: "pdf" | "excel", filters: ReportFilters) =>
    downloadFile(`/reports/${key}/export/${format}/`, filters, `${key}.${format === "pdf" ? "pdf" : "xlsx"}`),
};

// ---------------------------------------------------------------- activity logs & search
export const activityApi = {
  list: (params?: ListParams) => get<Paginated<ActivityLog>>("/activity-logs/", params),
  verifyIntegrity: () =>
    get<{ intact: boolean; broken_entry_ids: number[]; checked: number }>("/activity-logs/verify-integrity/"),
};

export const searchApi = {
  search: (q: string) => get<{ query: string; results: SearchResult[] }>("/search/", { q }),
};

// ---------------------------------------------------------------- AI assistant
export const aiApi = {
  status: () => get<AIStatus>("/ai/status/"),
  ask: (question: string, department?: number | null) =>
    post<PolicyAnswer>("/ai/policy-search/", { question, department: department ?? null }),
  auditSummary: (auditId: number) => post<AIDraft>(`/ai/audits/${auditId}/summary-draft/`),
  actionRecommendation: (findingId: number) => post<AIDraft>(`/ai/findings/${findingId}/recommendation-draft/`),
  documents: (params?: ListParams) => get<Paginated<PolicyDocument>>("/ai/policy-documents/", params),
  uploadDocument: (data: { title: string; description?: string; version_label?: string; department?: number | null; file: File }) =>
    upload<PolicyDocument>("/ai/policy-documents/", {
      title: data.title,
      description: data.description,
      version_label: data.version_label,
      department: data.department ?? undefined,
      file: data.file,
    }),
  updateDocument: (id: number, data: Partial<Pick<PolicyDocument, "title" | "description" | "is_approved">>) =>
    patch<PolicyDocument>(`/ai/policy-documents/${id}/`, data),
  indexDocument: (id: number) => post<PolicyDocument>(`/ai/policy-documents/${id}/index/`),
};
