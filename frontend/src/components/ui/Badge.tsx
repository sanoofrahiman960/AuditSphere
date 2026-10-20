import clsx from "clsx";
import type { ReactNode } from "react";
import type { ActionStatus, AuditStatus, Compliance, FindingStatus, Priority, Severity, VersionStatus } from "@/types/api";
import {
  ACTION_STATUS_LABELS,
  ACTION_STATUS_TONE,
  AUDIT_STATUS_LABELS,
  AUDIT_STATUS_TONE,
  COMPLIANCE_LABELS,
  COMPLIANCE_TONE,
  FINDING_STATUS_LABELS,
  FINDING_STATUS_TONE,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  SEVERITY_LABELS,
  SEVERITY_TONE,
  VERSION_STATUS_LABELS,
  VERSION_STATUS_TONE,
  type Tone,
} from "@/utils/format";

const TONES: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-500/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  green: "bg-green-50 text-green-700 ring-green-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20",
  purple: "bg-purple-50 text-purple-700 ring-purple-600/20",
  teal: "bg-teal-50 text-teal-700 ring-teal-600/20",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const AuditStatusBadge = ({ status }: { status: AuditStatus }) => (
  <Badge tone={AUDIT_STATUS_TONE[status]}>{AUDIT_STATUS_LABELS[status]}</Badge>
);

export const SeverityBadge = ({ severity }: { severity: Severity }) => (
  <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABELS[severity]}</Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABELS[priority]}</Badge>
);

export const FindingStatusBadge = ({ status }: { status: FindingStatus }) => (
  <Badge tone={FINDING_STATUS_TONE[status]}>{FINDING_STATUS_LABELS[status]}</Badge>
);

export const ActionStatusBadge = ({ status }: { status: ActionStatus }) => (
  <Badge tone={ACTION_STATUS_TONE[status]}>{ACTION_STATUS_LABELS[status]}</Badge>
);

export const VersionStatusBadge = ({ status }: { status: VersionStatus }) => (
  <Badge tone={VERSION_STATUS_TONE[status]}>{VERSION_STATUS_LABELS[status]}</Badge>
);

export const ComplianceBadge = ({ compliance }: { compliance: Compliance }) => (
  <Badge tone={COMPLIANCE_TONE[compliance]}>{COMPLIANCE_LABELS[compliance]}</Badge>
);

export const OverdueBadge = () => <Badge tone="red">Overdue</Badge>;
