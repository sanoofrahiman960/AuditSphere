// Types mirror the Django REST serializers in backend/apps/*/serializers.py.

export type Role =
  | "SUPER_ADMIN"
  | "AUDIT_ADMIN"
  | "AUDITOR"
  | "REVIEWER"
  | "DEPT_MANAGER"
  | "ACTION_OWNER"
  | "EXECUTIVE";

export type Capability =
  | "manage_users"
  | "manage_settings"
  | "manage_departments"
  | "manage_templates"
  | "manage_audits"
  | "perform_audits"
  | "review_audits"
  | "manage_findings"
  | "manage_actions"
  | "verify_actions"
  | "view_activity_logs"
  | "view_reports"
  | "use_ai";

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiErrorBody {
  detail: string;
  code: string;
  errors: Record<string, unknown> | null;
}

// ---------------------------------------------------------------- accounts
export interface UserSummary {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  job_title: string;
}

export interface Me {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role;
  role_display: string;
  job_title: string;
  phone: string;
  organization: { id: number; name: string; slug: string } | null;
  capabilities: Capability[];
  managed_department_ids: number[];
  last_login: string | null;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: Me;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role;
  role_display: string;
  job_title: string;
  phone: string;
  is_active: boolean;
  last_login: string | null;
  date_joined: string;
  department_ids: number[];
}

export interface UserWrite {
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  job_title?: string;
  phone?: string;
  is_active?: boolean;
  password?: string;
}

export interface Option {
  value: string;
  label: string;
}

// ---------------------------------------------------------------- organisation
export interface OrganizationSettings {
  risk_critical_threshold: number;
  risk_high_threshold: number;
  risk_medium_threshold: number;
  compliance_target: number;
  audit_reminder_days: number[];
  action_reminder_days: number[];
  overdue_reminder_interval_days: number;
  allow_self_verification: boolean;
  email_notifications_enabled: boolean;
  updated_at: string;
}

export interface Organization {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  settings: OrganizationSettings;
  created_at: string;
}

// ---------------------------------------------------------------- departments
export interface Department {
  id: number;
  name: string;
  code: string;
  description: string;
  manager: number | null;
  manager_detail: UserSummary | null;
  is_active: boolean;
  member_count: number;
  audit_count: number;
  open_findings: number;
  created_at: string;
  updated_at: string;
}

export interface DepartmentWrite {
  name: string;
  code?: string;
  description?: string;
  manager?: number | null;
}

export interface DepartmentMembership {
  id: number;
  user: number;
  user_detail: UserSummary;
  member_role: "MANAGER" | "MEMBER";
  is_active: boolean;
  created_at: string;
}

export interface DepartmentStats {
  summary: DashboardSummary;
  status_distribution: StatusCount[];
  risk_distribution: RiskCount[];
  trend: TrendPoint[];
}

export interface Ref {
  id: number;
  name: string;
}

// ---------------------------------------------------------------- templates
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type RiskCategory =
  | "COMPLIANCE"
  | "OPERATIONAL"
  | "FINANCIAL"
  | "SECURITY"
  | "REPUTATIONAL"
  | "STRATEGIC"
  | "LEGAL"
  | "PEOPLE";
export type ResponseType = "YES_NO" | "PASS_FAIL" | "YES_NO_NA" | "RATING" | "TEXT" | "NUMBER" | "DATE";
export type VersionStatus = "DRAFT" | "APPROVED" | "ARCHIVED";
export type ScoringMethod = "SIMPLE" | "WEIGHTED";

export interface AuditCategory {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  template_count: number;
  created_at: string;
}

export interface Question {
  id?: number;
  code: string;
  text: string;
  guidance: string;
  response_type: ResponseType;
  is_mandatory: boolean;
  evidence_required: boolean;
  weight: string;
  risk_category: RiskCategory;
  failure_severity: Severity;
  requires_corrective_action: boolean;
  rating_max: number;
  rating_pass_threshold: number;
  numeric_min: string | null;
  numeric_max: string | null;
  order: number;
  is_scored?: boolean;
}

export interface Section {
  id?: number;
  title: string;
  description: string;
  order: number;
  questions: Question[];
}

export interface VersionRef {
  id: number;
  version: number;
  status: VersionStatus;
  applicable_standard: string;
}

export interface AuditTemplate {
  id: number;
  name: string;
  description: string;
  department: number | null;
  department_name: string | null;
  category: number | null;
  category_name: string | null;
  is_active: boolean;
  latest_version: VersionRef | null;
  current_version: VersionRef | null;
  version_count: number;
  created_at: string;
  updated_at: string;
}

export interface AuditTemplateWrite {
  name: string;
  description?: string;
  department?: number | null;
  category?: number | null;
  is_active?: boolean;
  applicable_standard?: string;
  scoring_method?: ScoringMethod;
  sections?: Section[];
}

export interface VersionSummary {
  id: number;
  version: number;
  status: VersionStatus;
  applicable_standard: string;
  scoring_method: ScoringMethod;
  change_notes: string;
  question_count: number;
  audit_count: number;
  created_by: UserSummary | null;
  approved_by: UserSummary | null;
  approved_at: string | null;
  created_at: string;
}

export interface TemplateVersion {
  id: number;
  template: number;
  template_name: string;
  version: number;
  status: VersionStatus;
  applicable_standard: string;
  scoring_method: ScoringMethod;
  change_notes: string;
  is_editable: boolean;
  audit_count: number;
  created_by: UserSummary | null;
  approved_by: UserSummary | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  sections: Section[];
}

// ---------------------------------------------------------------- audits
export type AuditStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "REWORK_REQUIRED"
  | "APPROVED"
  | "COMPLETED"
  | "CANCELLED";
export type AuditType = "INTERNAL" | "COMPLIANCE" | "OPERATIONAL" | "FINANCIAL" | "IT" | "FOLLOW_UP" | "SPECIAL";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AuditListItem {
  id: number;
  reference: string;
  title: string;
  department: Ref;
  template: { id: number; name: string; version_id: number; version: number };
  audit_type: AuditType;
  priority: Priority;
  status: AuditStatus;
  status_display: string;
  planned_start_date: string;
  due_date: string;
  lead_auditor: UserSummary | null;
  reviewer: UserSummary | null;
  compliance_score: string | null;
  completion_percentage: number;
  is_overdue: boolean;
  findings_count: number;
  created_at: string;
}

export interface AuditAssignment {
  id: number;
  user: UserSummary;
  assignment_role: "LEAD_AUDITOR" | "AUDITOR" | "REVIEWER";
  is_active: boolean;
  created_at: string;
  ended_at: string | null;
}

export interface AuditPermissions {
  can_edit: boolean;
  can_delete: boolean;
  can_schedule: boolean;
  can_start: boolean;
  can_execute: boolean;
  can_submit: boolean;
  can_review: boolean;
  can_complete: boolean;
  can_cancel: boolean;
  can_reopen: boolean;
  can_raise_findings: boolean;
  can_upload_evidence: boolean;
  can_add_review_comments: boolean;
  can_resolve_review_comments: boolean;
}

export interface ReviewComment {
  id: number;
  question: number | null;
  question_code: string | null;
  body: string;
  author: UserSummary;
  is_resolved: boolean;
  resolution_note: string;
  resolved_by: UserSummary | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AuditDetail extends AuditListItem {
  period_start: string | null;
  period_end: string | null;
  department_contact: UserSummary | null;
  scope: string;
  objectives: string;
  overall_summary: string;
  overall_recommendation: string;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  status_reason: string;
  total_questions: number;
  answered_count: number;
  mandatory_unanswered_count: number;
  compliant_count: number;
  non_compliant_count: number;
  not_applicable_count: number;
  team: AuditAssignment[];
  permissions: AuditPermissions;
  created_by: UserSummary | null;
  updated_at: string;
}

export interface AuditWrite {
  title: string;
  department: number;
  template_version: number;
  audit_type: AuditType;
  period_start?: string | null;
  period_end?: string | null;
  planned_start_date: string;
  due_date: string;
  lead_auditor?: number | null;
  reviewer?: number | null;
  department_contact?: number | null;
  scope?: string;
  objectives?: string;
  priority: Priority;
  team_member_ids?: number[];
}

export interface CalendarEvent {
  id: number;
  reference: string;
  title: string;
  department: string;
  status: AuditStatus;
  priority: Priority;
  planned_start_date: string;
  due_date: string;
  is_overdue: boolean;
  lead_auditor: string | null;
}

export type Compliance = "COMPLIANT" | "NON_COMPLIANT" | "NOT_APPLICABLE" | "INFORMATIONAL" | "UNANSWERED";
export type ChoiceValue = "YES" | "NO" | "PASS" | "FAIL" | "NA" | "";

export interface Evidence {
  id: number;
  audit: number;
  response: number | null;
  finding: number | null;
  original_name: string;
  content_type: string;
  size: number;
  sha256: string;
  description: string;
  uploaded_by: UserSummary | null;
  created_at: string;
  download_url: string;
}

export interface AuditResponse {
  id: number;
  question: number;
  choice_value: ChoiceValue;
  text_value: string;
  number_value: string | null;
  date_value: string | null;
  rating_value: number | null;
  is_not_applicable: boolean;
  manual_assessment: "" | "COMPLIANT" | "NON_COMPLIANT";
  compliance: Compliance;
  observation: string;
  recommendation: string;
  risk_flagged: boolean;
  answered_by: UserSummary | null;
  updated_at: string;
  evidence: Evidence[];
}

export interface ResponseInput {
  question_id: number;
  choice_value?: ChoiceValue | null;
  text_value?: string | null;
  number_value?: string | null;
  date_value?: string | null;
  rating_value?: number | null;
  is_not_applicable?: boolean;
  manual_assessment?: "" | "COMPLIANT" | "NON_COMPLIANT" | null;
  observation?: string | null;
  recommendation?: string | null;
  risk_flagged?: boolean;
}

export interface WorkspaceQuestion extends Question {
  id: number;
  response: AuditResponse | null;
  findings_count: number;
}

export interface WorkspaceSection {
  id: number;
  title: string;
  description: string;
  questions: WorkspaceQuestion[];
}

export interface ValidationIssue {
  /** null for an audit-level review comment */
  question_id: number | null;
  code: "mandatory_unanswered" | "evidence_missing" | "finding_required" | "review_comment_open";
  message: string;
}

export interface Workspace {
  audit: AuditDetail;
  sections: WorkspaceSection[];
  review_comments: ReviewComment[];
  issues: ValidationIssue[];
  scoring_explanation: string;
  template_version: {
    id: number;
    version: number;
    name: string;
    applicable_standard: string;
    scoring_method: ScoringMethod;
  };
}

export interface ReviewDecision {
  id: number;
  decision: "APPROVED" | "REWORK_REQUIRED";
  comments: string;
  reviewer: UserSummary;
  created_at: string;
}

// ---------------------------------------------------------------- activity log
export interface ActivityLog {
  id: number;
  created_at: string;
  actor: number | null;
  actor_email: string;
  actor_name: string;
  action: string;
  object_type: string;
  object_id: string;
  object_repr: string;
  changes: Record<string, unknown>;
  ip_address: string | null;
  request_id: string;
  hash: string;
}

// ---------------------------------------------------------------- findings
export type FindingStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "RISK_ACCEPTED";

export interface RiskAssessment {
  id: number;
  likelihood: number;
  impact: number;
  score: number;
  calculated_severity: Severity;
  final_severity: Severity;
  is_override: boolean;
  rationale: string;
  assessed_by: UserSummary | null;
  created_at: string;
}

export interface Finding {
  id: number;
  reference: string;
  audit: { id: number; reference: string; title: string; status: AuditStatus; reviewer: number | null };
  department: Ref;
  question: { id: number; code: string; text: string } | null;
  title: string;
  description: string;
  expected_requirement: string;
  observed_condition: string;
  root_cause: string;
  business_impact: string;
  risk_category: RiskCategory;
  likelihood: number;
  impact: number;
  risk_score: number;
  severity: Severity;
  severity_overridden: boolean;
  owner: UserSummary | null;
  recommended_action: string;
  target_date: string | null;
  status: FindingStatus;
  status_display: string;
  closed_at: string | null;
  closed_by: UserSummary | null;
  closure_notes: string;
  created_by: UserSummary | null;
  created_at: string;
  updated_at: string;
  actions_count: number;
  open_actions_count: number;
  is_overdue: boolean;
}

export interface FindingPermissions {
  can_edit: boolean;
  can_override_severity: boolean;
  can_close: boolean;
  can_accept_risk: boolean;
  can_reopen: boolean;
  can_add_action: boolean;
  can_upload_evidence: boolean;
}

export interface FindingDetail extends Finding {
  risk_assessments: RiskAssessment[];
  evidence: Evidence[];
  actions: CorrectiveAction[];
  permissions: FindingPermissions;
}

export interface FindingWrite {
  audit?: number;
  question?: number | null;
  title: string;
  description: string;
  expected_requirement?: string;
  observed_condition?: string;
  root_cause?: string;
  business_impact?: string;
  risk_category?: RiskCategory;
  likelihood?: number;
  impact?: number;
  owner?: number | null;
  recommended_action?: string;
  target_date?: string | null;
}

export interface RiskMatrix {
  critical_threshold: number;
  high_threshold: number;
  medium_threshold: number;
  explanation: string;
}

// ---------------------------------------------------------------- corrective actions
export type ActionStatus = "OPEN" | "IN_PROGRESS" | "PENDING_VERIFICATION" | "REWORK_REQUIRED" | "CLOSED";
export type ActionType = "CORRECTIVE" | "PREVENTIVE";

export interface CorrectiveAction {
  id: number;
  reference: string;
  finding: {
    id: number;
    reference: string;
    title: string;
    severity: Severity;
    status: FindingStatus;
    audit_id: number;
    audit_reference: string;
  };
  department: Ref;
  action_type: ActionType;
  title: string;
  description: string;
  owner: UserSummary;
  due_date: string;
  priority: Priority;
  status: ActionStatus;
  status_display: string;
  progress: number;
  resolution_notes: string;
  verification_result: "" | "EFFECTIVE" | "NOT_EFFECTIVE";
  verification_notes: string;
  verified_by: UserSummary | null;
  verified_at: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  is_overdue: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActionComment {
  id: number;
  body: string;
  author: UserSummary;
  created_at: string;
}

export interface ActionEvidence {
  id: number;
  original_name: string;
  content_type: string;
  size: number;
  sha256: string;
  description: string;
  uploaded_by: UserSummary | null;
  created_at: string;
  download_url: string;
}

export interface StatusChange {
  id: number;
  from_status: string;
  to_status: string;
  changed_by: UserSummary | null;
  note: string;
  created_at: string;
}

export interface ActionPermissions {
  can_edit: boolean;
  can_edit_all_fields: boolean;
  can_start: boolean;
  can_submit_verification: boolean;
  can_verify: boolean;
  can_reopen: boolean;
  can_comment: boolean;
  can_upload_evidence: boolean;
  is_owner: boolean;
}

export interface CorrectiveActionDetail extends CorrectiveAction {
  comments: ActionComment[];
  evidence: ActionEvidence[];
  status_changes: StatusChange[];
  created_by: UserSummary | null;
  permissions: ActionPermissions;
}

export interface CorrectiveActionWrite {
  finding?: number;
  action_type?: ActionType;
  title?: string;
  description?: string;
  owner?: number;
  due_date?: string;
  priority?: Priority;
  progress?: number;
  resolution_notes?: string;
}

// ---------------------------------------------------------------- notifications
export interface Notification {
  id: number;
  notification_type: string;
  type_display: string;
  title: string;
  message: string;
  link: string;
  target_type: string;
  target_id: number | null;
  is_read: boolean;
  read_at: string | null;
  email_status: string;
  created_at: string;
}

export interface NotificationPreference {
  notification_type: string;
  label: string;
  in_app: boolean;
  email: boolean;
}

// ---------------------------------------------------------------- dashboard
export interface DashboardSummary {
  total_audits: number;
  draft_audits: number;
  scheduled_audits: number;
  in_progress_audits: number;
  awaiting_review_audits: number;
  completed_audits: number;
  cancelled_audits: number;
  overdue_audits: number;
  open_findings: number;
  critical_high_findings: number;
  open_actions: number;
  overdue_actions: number;
  failed_checks: number;
  compliance_score: number | null;
  compliance_target: number | null;
  scoring_explanation?: string;
  risk_explanation?: string;
}

export interface StatusCount {
  status: AuditStatus;
  label: string;
  count: number;
}

export interface RiskCount {
  severity: Severity;
  label: string;
  open: number;
  total: number;
}

export interface DepartmentRow {
  department_id: number;
  department: string;
  is_active: boolean;
  total_audits: number;
  completed_audits: number;
  open_audits: number;
  overdue_audits: number;
  compliance_score: number | null;
  failed_checks: number;
  total_findings: number;
  open_findings: number;
  critical_findings: number;
  high_findings: number;
  open_actions: number;
  overdue_actions: number;
  closed_actions: number;
}

export interface TrendPoint {
  period: string;
  due: number;
  completed: number;
  on_time: number;
  on_time_rate: number | null;
  compliance_score: number | null;
}

export interface UpcomingAudit {
  id: number;
  reference: string;
  title: string;
  department: string;
  status: AuditStatus;
  planned_start_date: string;
  due_date: string;
  days_left: number;
  completion_percentage: number;
  lead_auditor: string | null;
}

export interface RecentActivity {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  object_type: string;
  object_id: string;
  object_repr: string;
}

export interface OverdueAction {
  id: number;
  reference: string;
  title: string;
  department: string;
  owner: string;
  due_date: string;
  days_overdue: number;
  status: ActionStatus;
  priority: Priority;
  finding_severity: Severity;
}

export interface MyWorkItem {
  kind: "audit" | "rework" | "review" | "complete" | "verify" | "action" | "overdue";
  id: number;
  reference: string;
  title: string;
  department: string;
  status: string;
  due_date: string;
  days_left: number;
  completion_percentage?: number;
  owner?: string;
  progress?: number;
}

export interface MyWorkSection {
  key: "perform" | "review" | "verify" | "my_actions" | "department_overdue";
  title: string;
  count: number;
  items: MyWorkItem[];
}

export interface MyWork {
  total: number;
  sections: MyWorkSection[];
}

export interface DashboardFilters {
  department?: number;
  date_from?: string;
  date_to?: string;
  period?: "month" | "quarter";
}

// ---------------------------------------------------------------- reports
export interface ReportCatalogItem {
  key: string;
  title: string;
  description: string;
}

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}

export interface ReportChart {
  title: string;
  type: "bar";
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
}

export interface Report {
  key: string;
  title: string;
  organization: string;
  generated_at: string;
  generated_by: string;
  filters: { label: string; value: string }[];
  summary: { label: string; value: string | number }[];
  chart: ReportChart | null;
  sections: ReportSection[];
}

export interface ReportFilters {
  date_from?: string;
  date_to?: string;
  department?: number | string;
  audit_type?: string;
  status?: string;
  severity?: string;
  auditor?: number | string;
  owner?: number | string;
  period?: "month" | "quarter";
}

// ---------------------------------------------------------------- search & AI
export interface SearchResult {
  type: "audit" | "finding" | "action" | "department" | "template";
  id: number;
  title: string;
  subtitle: string;
  link: string;
}

export interface AIStatus {
  enabled: boolean;
  llm_configured: boolean;
  retrieval_configured: boolean;
  model: string | null;
  disclaimer: string;
}

export interface PolicyDocument {
  id: number;
  title: string;
  description: string;
  version_label: string;
  department: number | null;
  department_name: string | null;
  original_name: string;
  size: number;
  is_approved: boolean;
  status: "PENDING" | "PROCESSED" | "FAILED";
  page_count: number;
  chunk_count: number;
  error: string;
  created_at: string;
}

export interface PolicyAnswer {
  answer: string;
  citations: { document_id: number; document_title: string; page: number | null; cited_text: string }[];
  sources: { document_id: number; document_title: string; page: number | null; score: number; excerpt: string }[];
  disclaimer: string;
}

export interface AIDraft {
  draft: string;
  disclaimer: string;
}
