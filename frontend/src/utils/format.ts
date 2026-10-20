import { format, formatDistanceToNow, parseISO } from "date-fns";
import type {
  ActionStatus,
  ActionType,
  AuditStatus,
  AuditType,
  Capability,
  Compliance,
  FindingStatus,
  Priority,
  ResponseType,
  RiskCategory,
  Role,
  Severity,
  VersionStatus,
} from "@/types/api";

export function formatDate(value?: string | null, pattern = "d MMM yyyy"): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

export function formatDateTime(value?: string | null): string {
  return formatDate(value, "d MMM yyyy, HH:mm");
}

export function timeAgo(value?: string | null): string {
  if (!value) return "—";
  try {
    return formatDistanceToNow(parseISO(value), { addSuffix: true });
  } catch {
    return value;
  }
}

/** yyyy-MM-dd for <input type="date"> and API date fields. */
export function isoDate(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

export function formatPercent(value?: number | string | null, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_.]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------- labels
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Administrator",
  AUDIT_ADMIN: "Audit Administrator",
  AUDITOR: "Auditor",
  REVIEWER: "Reviewer",
  DEPT_MANAGER: "Department Manager",
  ACTION_OWNER: "Corrective Action Owner",
  EXECUTIVE: "Executive Viewer",
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  manage_users: "Manage users",
  manage_settings: "Organisation settings",
  manage_departments: "Manage departments",
  manage_templates: "Manage templates",
  manage_audits: "Plan audits",
  perform_audits: "Perform audits",
  review_audits: "Review audits",
  manage_findings: "Manage findings",
  manage_actions: "Manage corrective actions",
  verify_actions: "Verify corrective actions",
  view_activity_logs: "View activity log",
  view_reports: "View reports",
  use_ai: "Use AI assistant",
};

export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Submitted for Review",
  REWORK_REQUIRED: "Rework Required",
  APPROVED: "Approved",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  INTERNAL: "Internal",
  COMPLIANCE: "Compliance",
  OPERATIONAL: "Operational",
  FINANCIAL: "Financial",
  IT: "IT / Security",
  FOLLOW_UP: "Follow-up",
  SPECIAL: "Special investigation",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "Action in progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  RISK_ACCEPTED: "Risk accepted",
};

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  PENDING_VERIFICATION: "Pending Verification",
  REWORK_REQUIRED: "Rework Required",
  CLOSED: "Closed",
};

export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  ARCHIVED: "Archived",
};

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  YES_NO: "Yes / No",
  PASS_FAIL: "Pass / Fail",
  YES_NO_NA: "Yes / No / N/A",
  RATING: "Rating scale",
  TEXT: "Text",
  NUMBER: "Numeric value",
  DATE: "Date",
};

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  COMPLIANCE: "Compliance",
  OPERATIONAL: "Operational",
  FINANCIAL: "Financial",
  SECURITY: "Information Security",
  REPUTATIONAL: "Reputational",
  STRATEGIC: "Strategic",
  LEGAL: "Legal",
  PEOPLE: "People",
};

export const COMPLIANCE_LABELS: Record<Compliance, string> = {
  COMPLIANT: "Compliant",
  NON_COMPLIANT: "Non-compliant",
  NOT_APPLICABLE: "Not applicable",
  INFORMATIONAL: "Informational",
  UNANSWERED: "Unanswered",
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  CORRECTIVE: "Corrective",
  PREVENTIVE: "Preventive",
};

/** 1–5 scales used for likelihood × impact risk scoring. */
export const LIKELIHOOD_LABELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
export const IMPACT_LABELS = ["Negligible", "Minor", "Moderate", "Major", "Severe"];

/**
 * Client-side preview of the backend risk rule (score ≥ threshold ⇒ severity).
 * The server always computes the stored value; defaults match the organisation defaults.
 */
export function severityForScore(
  score: number,
  thresholds?: { critical_threshold: number; high_threshold: number; medium_threshold: number },
): Severity {
  if (score >= (thresholds?.critical_threshold ?? 20)) return "CRITICAL";
  if (score >= (thresholds?.high_threshold ?? 12)) return "HIGH";
  if (score >= (thresholds?.medium_threshold ?? 6)) return "MEDIUM";
  return "LOW";
}

export function options<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

// ---------------------------------------------------------------- colours (badge tones)
export type Tone = "gray" | "blue" | "indigo" | "amber" | "green" | "red" | "orange" | "purple" | "teal";

export const ROLE_TONE: Record<Role, Tone> = {
  SUPER_ADMIN: "red",
  AUDIT_ADMIN: "purple",
  AUDITOR: "blue",
  REVIEWER: "indigo",
  DEPT_MANAGER: "teal",
  ACTION_OWNER: "amber",
  EXECUTIVE: "gray",
};

export const AUDIT_STATUS_TONE: Record<AuditStatus, Tone> = {
  DRAFT: "gray",
  SCHEDULED: "indigo",
  IN_PROGRESS: "blue",
  SUBMITTED: "purple",
  REWORK_REQUIRED: "orange",
  APPROVED: "teal",
  COMPLETED: "green",
  CANCELLED: "gray",
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  CRITICAL: "red",
  HIGH: "orange",
  MEDIUM: "amber",
  LOW: "green",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  CRITICAL: "red",
  HIGH: "orange",
  MEDIUM: "amber",
  LOW: "gray",
};

export const FINDING_STATUS_TONE: Record<FindingStatus, Tone> = {
  OPEN: "red",
  IN_PROGRESS: "blue",
  RESOLVED: "teal",
  CLOSED: "green",
  RISK_ACCEPTED: "purple",
};

export const ACTION_STATUS_TONE: Record<ActionStatus, Tone> = {
  OPEN: "gray",
  IN_PROGRESS: "blue",
  PENDING_VERIFICATION: "purple",
  REWORK_REQUIRED: "orange",
  CLOSED: "green",
};

export const VERSION_STATUS_TONE: Record<VersionStatus, Tone> = {
  DRAFT: "amber",
  APPROVED: "green",
  ARCHIVED: "gray",
};

export const COMPLIANCE_TONE: Record<Compliance, Tone> = {
  COMPLIANT: "green",
  NON_COMPLIANT: "red",
  NOT_APPLICABLE: "gray",
  INFORMATIONAL: "blue",
  UNANSWERED: "amber",
};

/** Chart colours (hex) aligned with the badge tones. */
export const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#d97706",
  LOW: "#16a34a",
};

export const AUDIT_STATUS_COLORS: Record<AuditStatus, string> = {
  DRAFT: "#94a3b8",
  SCHEDULED: "#6366f1",
  IN_PROGRESS: "#2563eb",
  SUBMITTED: "#9333ea",
  REWORK_REQUIRED: "#ea580c",
  APPROVED: "#0d9488",
  COMPLETED: "#16a34a",
  CANCELLED: "#cbd5e1",
};

export function scoreColor(score: number | null | undefined, target = 85): string {
  if (score === null || score === undefined) return "text-slate-400";
  if (score >= target) return "text-green-600";
  if (score >= target - 15) return "text-amber-600";
  return "text-red-600";
}
