import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Ban,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Copy,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { aiApi, auditsApi, findingsApi } from "@/api/endpoints";
import { AuditStatusBadge, Badge, FindingStatusBadge, OverdueBadge, PriorityBadge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, DetailList } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Avatar, FileList, FileUploadButton, ProgressBar, Tabs, type FileItem } from "@/components/ui/Misc";
import { ConfirmDialog, Modal, ReasonDialog } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { FindingFormModal } from "@/features/findings/FindingFormModal";
import type { ActivityLog, AuditDetail, Finding, ValidationIssue } from "@/types/api";
import {
  AUDIT_STATUS_LABELS,
  AUDIT_TYPE_LABELS,
  formatDate,
  formatDateTime,
  formatPercent,
  humanize,
  scoreColor,
  timeAgo,
} from "@/utils/format";
import { extractIssues, groupIssues, ISSUE_LABELS } from "./auditHelpers";

type TransitionKind = "schedule" | "start" | "submit" | "approve" | "rework" | "complete" | "cancel" | "reopen";
type DialogKind = TransitionKind | "delete";
type TabId = "overview" | "findings" | "evidence" | "review" | "history";
const TAB_IDS: TabId[] = ["overview", "findings", "evidence", "review", "history"];

const SUCCESS_MESSAGES: Record<TransitionKind, string> = {
  schedule: "Audit scheduled — the team has been notified",
  start: "Audit started",
  submit: "Audit submitted for review",
  approve: "Audit approved",
  rework: "Audit returned to the team for rework",
  complete: "Audit completed",
  cancel: "Audit cancelled",
  reopen: "Audit reopened",
};

export default function AuditDetailPage() {
  const { id } = useParams();
  const auditId = Number(id);
  const query = useQuery({ queryKey: ["audit", auditId], queryFn: () => auditsApi.get(auditId), enabled: !!auditId });

  if (query.isLoading) return <LoadingState />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <AuditDetailView audit={query.data} />;
}

function AuditDetailView({ audit }: { audit: AuditDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const p = audit.permissions;

  const tabParam = searchParams.get("tab") as TabId | null;
  const tab: TabId = tabParam && TAB_IDS.includes(tabParam) ? tabParam : "overview";
  const setTab = (next: TabId) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "overview") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  // Question-level review comments make an overall rework comment optional.
  const reviewComments = useQuery({
    queryKey: ["audit-review-comments", audit.id],
    queryFn: () => auditsApi.reviewComments(audit.id),
    enabled: audit.permissions.can_review,
  });
  const openReviewComments = (reviewComments.data ?? []).filter((c) => !c.is_resolved).length;

  const invalidateRelated = () => {
    for (const key of [
      ["audits"],
      ["workspace", audit.id],
      ["dashboard"],
      ["audit-reviews", audit.id],
      ["audit-review-comments", audit.id],
      ["audit-history", audit.id],
    ]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const transition = useMutation({
    mutationFn: ({ kind, text = "" }: { kind: TransitionKind; text?: string }) => {
      switch (kind) {
        case "schedule":
          return auditsApi.schedule(audit.id);
        case "start":
          return auditsApi.start(audit.id);
        case "submit":
          return auditsApi.submit(audit.id);
        case "approve":
          return auditsApi.approve(audit.id, text);
        case "rework":
          return auditsApi.requestRework(audit.id, text);
        case "complete":
          return auditsApi.complete(audit.id);
        case "cancel":
          return auditsApi.cancel(audit.id, text);
        case "reopen":
          return auditsApi.reopen(audit.id, text);
      }
    },
    onSuccess: (updated, { kind }) => {
      queryClient.setQueryData(["audit", audit.id], updated);
      invalidateRelated();
      setDialog(null);
      toast.success(SUCCESS_MESSAGES[kind]);
      if (kind === "start") navigate(`/audits/${audit.id}/workspace`);
    },
    onError: (err, { kind }) => {
      const found = kind === "submit" ? extractIssues(err) : null;
      if (found) {
        setDialog(null);
        setIssues(found);
        queryClient.invalidateQueries({ queryKey: ["workspace", audit.id] });
        return;
      }
      toast.error(err);
      // A 409 means someone else moved the audit on; show the current state.
      queryClient.invalidateQueries({ queryKey: ["audit", audit.id] });
    },
  });

  const remove = useMutation({
    mutationFn: () => auditsApi.remove(audit.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["audit", audit.id] });
      queryClient.invalidateQueries({ queryKey: ["audits"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Audit ${audit.reference} deleted`);
      navigate("/audits");
    },
    onError: (err) => toast.error(err),
  });

  // ---- AI summary draft (never saved automatically)
  const aiAllowed = can("use_ai");
  const aiStatus = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status, enabled: aiAllowed, staleTime: 5 * 60_000 });
  const aiDraft = useMutation({
    mutationFn: async () => {
      const status = await queryClient.fetchQuery({ queryKey: ["ai-status"], queryFn: aiApi.status, staleTime: 60_000 });
      if (!status.enabled) throw new Error("AI assistant is not enabled");
      return aiApi.auditSummary(audit.id);
    },
    onSuccess: () => setAiOpen(true),
    onError: (err) => toast.error(err),
  });

  const run = (kind: TransitionKind, text?: string) => transition.mutate({ kind, text });
  const busy = transition.isPending;
  const isTeamStage = ["IN_PROGRESS", "REWORK_REQUIRED", "SUBMITTED", "APPROVED", "COMPLETED"].includes(audit.status);

  const actions: ReactNode[] = [];
  if (p.can_start)
    actions.push(
      <Button key="start" icon={<Play className="h-4 w-4" />} onClick={() => setDialog("start")}>
        {audit.status === "REWORK_REQUIRED" ? "Resume audit" : "Start audit"}
      </Button>,
    );
  if (p.can_execute)
    actions.push(
      <Button
        key="workspace"
        variant={p.can_start ? "secondary" : "primary"}
        icon={<ClipboardList className="h-4 w-4" />}
        onClick={() => navigate(`/audits/${audit.id}/workspace`)}
      >
        Open workspace
      </Button>,
    );
  else if (isTeamStage)
    actions.push(
      <Button
        key="checklist"
        variant="secondary"
        icon={<ClipboardList className="h-4 w-4" />}
        onClick={() => navigate(`/audits/${audit.id}/workspace`)}
      >
        View checklist
      </Button>,
    );
  if (p.can_add_review_comments)
    actions.push(
      <Button
        key="review-checklist"
        variant="secondary"
        icon={<ClipboardList className="h-4 w-4" />}
        onClick={() => navigate(`/audits/${audit.id}/workspace`)}
      >
        Review checklist & comment
      </Button>,
    );
  if (p.can_submit)
    actions.push(
      <Button key="submit" icon={<Send className="h-4 w-4" />} onClick={() => setDialog("submit")}>
        Submit for review
      </Button>,
    );
  if (p.can_review) {
    actions.push(
      <Button key="approve" variant="success" icon={<ThumbsUp className="h-4 w-4" />} onClick={() => setDialog("approve")}>
        Approve
      </Button>,
      <Button key="rework" variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => setDialog("rework")}>
        Request rework
      </Button>,
    );
  }
  if (p.can_complete)
    actions.push(
      <Button key="complete" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDialog("complete")}>
        Complete
      </Button>,
    );
  if (p.can_schedule)
    actions.push(
      <Button key="schedule" icon={<CalendarCheck className="h-4 w-4" />} onClick={() => setDialog("schedule")}>
        Schedule
      </Button>,
    );
  if (p.can_edit)
    actions.push(
      <Button key="edit" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/audits/${audit.id}/edit`)}>
        Edit
      </Button>,
    );
  if (aiAllowed) {
    const enabled = !!aiStatus.data?.enabled;
    const button = (
      <Button
        variant="secondary"
        icon={<Sparkles className="h-4 w-4" />}
        disabled={!enabled}
        loading={aiDraft.isPending}
        onClick={() => aiDraft.mutate()}
      >
        Draft summary (AI)
      </Button>
    );
    actions.push(
      enabled ? (
        <span key="ai">{button}</span>
      ) : (
        <span key="ai" title={aiStatus.isLoading ? "Checking AI assistant…" : "AI assistant is not enabled"}>
          {button}
        </span>
      ),
    );
  }
  if (p.can_reopen)
    actions.push(
      <Button key="reopen" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setDialog("reopen")}>
        Reopen
      </Button>,
    );
  if (p.can_cancel)
    actions.push(
      <Button key="cancel" variant="ghost" className="text-red-600" icon={<Ban className="h-4 w-4" />} onClick={() => setDialog("cancel")}>
        Cancel audit
      </Button>,
    );
  if (p.can_delete)
    actions.push(
      <Button key="delete" variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDialog("delete")}>
        Delete
      </Button>,
    );

  return (
    <>
      <PageHeader
        title={audit.title}
        breadcrumbs={[{ label: "Audits", to: "/audits" }, { label: audit.reference }]}
        meta={
          <>
            <span className="font-mono text-sm text-slate-500">{audit.reference}</span>
            <AuditStatusBadge status={audit.status} />
            {audit.is_overdue && <OverdueBadge />}
            <PriorityBadge priority={audit.priority} />
            <span className="text-sm text-slate-500">
              {audit.department.name} · Due {formatDate(audit.due_date)}
            </span>
          </>
        }
        actions={actions.length ? actions : undefined}
      />

      <Tabs<TabId>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "findings", label: "Findings", count: audit.findings_count },
          { id: "evidence", label: "Evidence" },
          { id: "review", label: "Review" },
          { id: "history", label: "History" },
        ]}
      />

      {tab === "overview" && <OverviewTab audit={audit} />}
      {tab === "findings" && <FindingsTab audit={audit} />}
      {tab === "evidence" && <EvidenceTab audit={audit} />}
      {tab === "review" && <ReviewTab audit={audit} />}
      {tab === "history" && <HistoryTab audit={audit} />}

      {/* ---- dialogs ---- */}
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        tone="danger"
        title="Delete draft audit"
        confirmLabel="Delete audit"
        message={
          <>
            Permanently delete <strong>{audit.reference}</strong>? Only draft audits can be deleted; this cannot be undone.
          </>
        }
      />
      <ConfirmDialog
        open={dialog === "schedule"}
        onClose={() => setDialog(null)}
        onConfirm={() => run("schedule")}
        loading={busy}
        title="Schedule audit"
        confirmLabel="Schedule"
        message="The lead auditor, co-auditors and reviewer will be notified of their assignment."
      />
      <ConfirmDialog
        open={dialog === "start"}
        onClose={() => setDialog(null)}
        onConfirm={() => run("start")}
        loading={busy}
        title={audit.status === "REWORK_REQUIRED" ? "Resume audit" : "Start audit"}
        confirmLabel={audit.status === "REWORK_REQUIRED" ? "Resume" : "Start"}
        message="The audit moves to In Progress and the checklist workspace opens for the audit team."
      />
      <ConfirmDialog
        open={dialog === "submit"}
        onClose={() => setDialog(null)}
        onConfirm={() => run("submit")}
        loading={busy}
        title="Submit for review"
        confirmLabel="Submit"
        message={`The checklist becomes read-only and ${audit.reviewer?.full_name ?? "the reviewer"} is asked to review it.`}
      />
      <ConfirmDialog
        open={dialog === "complete"}
        onClose={() => setDialog(null)}
        onConfirm={() => run("complete")}
        loading={busy}
        title="Complete audit"
        confirmLabel="Complete"
        message="The final compliance score is recorded and the audit is closed."
      />
      <ReasonDialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        onSubmit={(text) => run("approve", text)}
        loading={busy}
        required={false}
        title="Approve audit"
        label="Comments (optional)"
        confirmLabel="Approve"
        message="Approval is recorded with your name and comments and the audit team is notified."
      />
      <ReasonDialog
        open={dialog === "rework"}
        onClose={() => setDialog(null)}
        onSubmit={(text) => run("rework", text)}
        loading={busy}
        title="Request rework"
        label={openReviewComments ? "Overall comment (optional)" : "What needs to change?"}
        required={openReviewComments === 0}
        confirmLabel="Return to team"
        message={
          openReviewComments
            ? `The audit is returned to the audit team with your ${openReviewComments} open question comment(s), which they must resolve before resubmitting.`
            : "The audit is returned to the audit team with your comments. Tip: add comments on specific questions from the checklist."
        }
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        onSubmit={(text) => run("cancel", text)}
        loading={busy}
        tone="danger"
        title="Cancel audit"
        confirmLabel="Cancel audit"
        message="Cancelled audits are excluded from scores. An administrator can reopen it later."
      />
      <ReasonDialog
        open={dialog === "reopen"}
        onClose={() => setDialog(null)}
        onSubmit={(text) => run("reopen", text)}
        loading={busy}
        title="Reopen audit"
        confirmLabel="Reopen"
        message="The audit returns to its working state so it can be corrected and resubmitted."
      />

      <Modal
        open={issues !== null}
        onClose={() => setIssues(null)}
        title="The checklist is incomplete"
        description="Resolve these issues in the workspace before submitting."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIssues(null)}>
              Close
            </Button>
            <Button onClick={() => navigate(`/audits/${audit.id}/workspace`)}>Open workspace</Button>
          </>
        }
      >
        <IssueGroups auditId={audit.id} issues={issues ?? []} />
      </Modal>

      <Modal
        open={aiOpen && !!aiDraft.data}
        onClose={() => setAiOpen(false)}
        title="AI draft — audit summary"
        description="Review and edit before using. Nothing has been saved."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAiOpen(false)}>
              Close
            </Button>
            <Button
              icon={<Copy className="h-4 w-4" />}
              onClick={() =>
                navigator.clipboard
                  .writeText(aiDraft.data?.draft ?? "")
                  .then(() => toast.success("Draft copied to clipboard"))
                  .catch(() => toast.error("Could not copy to the clipboard"))
              }
            >
              Copy
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
            {aiDraft.data?.draft}
          </div>
          {aiDraft.data?.disclaimer && <Notice tone="warning">{aiDraft.data.disclaimer}</Notice>}
        </div>
      </Modal>
    </>
  );
}

function IssueGroups({ auditId, issues }: { auditId: number; issues: ValidationIssue[] }) {
  if (!issues.length) return <p className="text-sm text-slate-600">The server reported the checklist as incomplete.</p>;
  return (
    <div className="space-y-4">
      {groupIssues(issues).map(([code, list]) => (
        <div key={code}>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-800">
            {ISSUE_LABELS[code] ?? humanize(code)} <span className="font-normal text-slate-500">({list.length})</span>
          </h3>
          <ul className="space-y-1">
            {list.map((issue, i) => (
              <li key={`${issue.question_id}-${i}`}>
                <Link
                  to={`/audits/${auditId}/workspace${issue.question_id === null ? "" : `#q-${issue.question_id}`}`}
                  className="link text-sm"
                >
                  {issue.message}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function OverviewTab({ audit }: { audit: AuditDetail }) {
  const reviews = useQuery({
    queryKey: ["audit-reviews", audit.id],
    queryFn: () => auditsApi.reviews(audit.id),
    enabled: audit.status === "REWORK_REQUIRED",
  });
  // Review decisions are returned newest first.
  const latestRework = reviews.data?.find((r) => r.decision === "REWORK_REQUIRED");
  const coAuditors = audit.team.filter((t) => t.is_active && t.assignment_role === "AUDITOR");
  const score = audit.compliance_score === null ? null : Number(audit.compliance_score);
  const scored = audit.compliant_count + audit.non_compliant_count;

  const timestamps = [
    { label: "Started", value: audit.started_at },
    { label: "Submitted", value: audit.submitted_at },
    { label: "Approved", value: audit.approved_at },
    { label: "Completed", value: audit.completed_at },
    { label: "Cancelled", value: audit.cancelled_at },
  ].filter((t) => t.value);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {audit.status === "REWORK_REQUIRED" && latestRework && (
          <Notice tone="warning">
            <strong>Rework requested</strong> by {latestRework.reviewer.full_name} ({timeAgo(latestRework.created_at)}):{" "}
            {latestRework.comments}
          </Notice>
        )}
        {audit.status_reason && (
          <Notice tone={audit.status === "CANCELLED" ? "warning" : "info"}>
            <strong>{audit.status === "CANCELLED" ? "Cancellation reason" : "Status note"}:</strong> {audit.status_reason}
          </Notice>
        )}

        <Card title="Audit details">
          <DetailList
            items={[
              {
                label: "Department",
                value: (
                  <Link to={`/departments/${audit.department.id}`} className="link">
                    {audit.department.name}
                  </Link>
                ),
              },
              {
                label: "Checklist template",
                value: (
                  <Link to={`/templates/${audit.template.id}/versions/${audit.template.version_id}`} className="link">
                    {audit.template.name} · v{audit.template.version}
                  </Link>
                ),
              },
              { label: "Audit type", value: AUDIT_TYPE_LABELS[audit.audit_type] },
              { label: "Priority", value: <PriorityBadge priority={audit.priority} /> },
              {
                label: "Period under review",
                value:
                  audit.period_start || audit.period_end
                    ? `${formatDate(audit.period_start)} – ${formatDate(audit.period_end)}`
                    : null,
              },
              { label: "Planned start", value: formatDate(audit.planned_start_date) },
              {
                label: "Due date",
                value: (
                  <span className="inline-flex items-center gap-2">
                    {formatDate(audit.due_date)}
                    {audit.is_overdue && <OverdueBadge />}
                  </span>
                ),
              },
              { label: "Status", value: AUDIT_STATUS_LABELS[audit.status] },
              { label: "Lead auditor", value: audit.lead_auditor?.full_name ?? "Unassigned" },
              { label: "Reviewer", value: audit.reviewer?.full_name ?? "Unassigned" },
              { label: "Department contact", value: audit.department_contact?.full_name ?? null },
              {
                label: "Co-auditors",
                value: coAuditors.length ? coAuditors.map((t) => t.user.full_name).join(", ") : "None",
              },
              {
                label: "Created",
                value: `${formatDateTime(audit.created_at)}${audit.created_by ? ` by ${audit.created_by.full_name}` : ""}`,
              },
              { label: "Last updated", value: formatDateTime(audit.updated_at) },
              ...timestamps.map((t) => ({ label: t.label, value: formatDateTime(t.value) })),
            ]}
          />
        </Card>

        <Card title="Scope & objectives">
          <DetailList
            columns={1}
            items={[
              { label: "Scope", value: audit.scope ? <span className="whitespace-pre-wrap">{audit.scope}</span> : null },
              {
                label: "Objectives",
                value: audit.objectives ? <span className="whitespace-pre-wrap">{audit.objectives}</span> : null,
              },
            ]}
          />
        </Card>

        <Card title="Overall summary & recommendation" description="Written by the audit team in the workspace.">
          <DetailList
            columns={1}
            items={[
              {
                label: "Overall summary",
                value: audit.overall_summary ? <span className="whitespace-pre-wrap">{audit.overall_summary}</span> : null,
              },
              {
                label: "Overall recommendation",
                value: audit.overall_recommendation ? (
                  <span className="whitespace-pre-wrap">{audit.overall_recommendation}</span>
                ) : null,
              },
            ]}
          />
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Compliance score">
          <p className={clsx("text-4xl font-semibold tabular-nums", scoreColor(score))}>{formatPercent(score)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {scored ? `${audit.compliant_count} of ${scored} scored answers compliant` : "No scored answers yet"}
          </p>

          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-600">
              <span>Completion</span>
              <span className="tabular-nums">
                {audit.answered_count}/{audit.total_questions} · {audit.completion_percentage}%
              </span>
            </div>
            <ProgressBar value={audit.completion_percentage} tone={audit.completion_percentage === 100 ? "green" : "brand"} />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <ScoreStat label="Compliant" value={audit.compliant_count} className="text-green-700" />
            <ScoreStat label="Non-compliant" value={audit.non_compliant_count} className="text-red-700" />
            <ScoreStat label="Not applicable" value={audit.not_applicable_count} />
            <ScoreStat label="Answered" value={audit.answered_count} />
            <ScoreStat label="Total questions" value={audit.total_questions} />
            <ScoreStat
              label="Mandatory unanswered"
              value={audit.mandatory_unanswered_count}
              className={audit.mandatory_unanswered_count ? "text-amber-700" : undefined}
            />
          </dl>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Scores are internal indicators of control performance, not proof of legal or certification compliance.
            Not-applicable and informational answers are excluded from the score.
          </p>
        </Card>

        <Card title="Audit team">
          {audit.team.filter((t) => t.is_active).length === 0 ? (
            <p className="text-sm text-slate-500">No one is assigned yet.</p>
          ) : (
            <ul className="space-y-3">
              {audit.team
                .filter((t) => t.is_active)
                .map((t) => (
                  <li key={t.id} className="flex items-center gap-3">
                    <Avatar name={t.user.full_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{t.user.full_name}</p>
                      <p className="truncate text-xs text-slate-500">{t.user.job_title || t.user.email}</p>
                    </div>
                    <Badge tone={t.assignment_role === "REVIEWER" ? "purple" : t.assignment_role === "LEAD_AUDITOR" ? "blue" : "gray"}>
                      {t.assignment_role === "LEAD_AUDITOR" ? "Lead" : t.assignment_role === "REVIEWER" ? "Reviewer" : "Auditor"}
                    </Badge>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function ScoreStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={clsx("text-lg font-semibold tabular-nums text-slate-800", className)}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- findings

function FindingsTab({ audit }: { audit: AuditDetail }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const params = { audit: audit.id, page_size: 100, ordering: "-created_at" };
  const query = useQuery({ queryKey: ["findings", params], queryFn: () => findingsApi.list(params) });

  const columns: Column<Finding>[] = [
    {
      key: "reference",
      header: "Reference",
      render: (f) => (
        <Link to={`/findings/${f.id}`} className="link whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {f.reference}
        </Link>
      ),
    },
    {
      key: "title",
      header: "Finding",
      render: (f) => (
        <div className="min-w-[200px]">
          <p className="font-medium text-slate-800">{f.title}</p>
          {f.question && <p className="text-xs text-slate-500">{f.question.code || "Checklist question"}</p>}
        </div>
      ),
    },
    { key: "severity", header: "Severity", render: (f) => <SeverityBadge severity={f.severity} /> },
    {
      key: "status",
      header: "Status",
      render: (f) => (
        <div className="flex flex-wrap gap-1">
          <FindingStatusBadge status={f.status} />
          {f.is_overdue && <OverdueBadge />}
        </div>
      ),
    },
    { key: "owner", header: "Owner", render: (f) => f.owner?.full_name ?? <span className="text-slate-400">Unassigned</span> },
    {
      key: "actions",
      header: "Actions",
      render: (f) => (
        <span className="tabular-nums">
          {f.open_actions_count} open / {f.actions_count}
        </span>
      ),
    },
    { key: "target", header: "Target date", render: (f) => formatDate(f.target_date) },
  ];

  return (
    <div className="space-y-3">
      {audit.permissions.can_raise_findings && (
        <div className="flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Record finding
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={query.data?.results}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(f) => navigate(`/findings/${f.id}`)}
        emptyTitle="No findings recorded"
        emptyDescription="Findings raised against failed checks in this audit appear here."
      />
      {query.data && query.data.count > query.data.results.length && (
        <p className="text-xs text-slate-500">
          Showing {query.data.results.length} of {query.data.count}.{" "}
          <Link to={`/findings?search=${encodeURIComponent(audit.reference)}`} className="link">
            View all in Findings
          </Link>
        </p>
      )}
      <FindingFormModal open={open} onClose={() => setOpen(false)} auditId={audit.id} />
    </div>
  );
}

// ---------------------------------------------------------------- evidence

function EvidenceTab({ audit }: { audit: AuditDetail }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const [toDelete, setToDelete] = useState<FileItem | null>(null);
  const query = useQuery({ queryKey: ["audit-evidence", audit.id], queryFn: () => auditsApi.evidence(audit.id) });

  const editable = audit.status === "IN_PROGRESS" || audit.status === "REWORK_REQUIRED";
  const canDelete = (fileId: number) => {
    const ev = query.data?.find((e) => e.id === fileId);
    return !!ev && editable && (ev.uploaded_by?.id === user?.id || can("manage_audits"));
  };
  const anyDeletable = !!query.data?.some((e) => canDelete(e.id));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["audit-evidence", audit.id] });
    queryClient.invalidateQueries({ queryKey: ["workspace", audit.id] });
    queryClient.invalidateQueries({ queryKey: ["audit-history", audit.id] });
  };

  const remove = useMutation({
    mutationFn: (fileId: number) => auditsApi.deleteEvidence(fileId),
    onSuccess: () => {
      toast.success("Evidence removed");
      setToDelete(null);
      refresh();
    },
    onError: (err) => toast.error(err),
  });

  return (
    <Card
      title="Evidence"
      description="All files attached to this audit, its checklist answers and findings. Downloads are logged."
      actions={
        audit.permissions.can_upload_evidence ? (
          <FileUploadButton
            label="Upload evidence"
            onUpload={async (file) => {
              await auditsApi.uploadEvidence(audit.id, file);
              refresh();
            }}
          />
        ) : undefined
      }
    >
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState title="No evidence uploaded" description="Attach evidence here or against individual checklist answers." />
      ) : (
        <FileList
          files={query.data}
          onDelete={
            anyDeletable
              ? (file) =>
                  canDelete(file.id)
                    ? setToDelete(file)
                    : toast.info("Only the uploader or an audit administrator can remove this file.")
              : undefined
          }
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        loading={remove.isPending}
        tone="danger"
        title="Remove evidence"
        confirmLabel="Remove"
        message={
          <>
            Remove <strong>{toDelete?.original_name}</strong> from this audit? The removal is recorded in the audit history.
          </>
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------- review

function ReviewCommentsCard({ audit }: { audit: AuditDetail }) {
  const query = useQuery({
    queryKey: ["audit-review-comments", audit.id],
    queryFn: () => auditsApi.reviewComments(audit.id),
  });
  const comments = query.data ?? [];
  const open = comments.filter((c) => !c.is_resolved).length;
  if (!query.isLoading && !comments.length) return null;
  return (
    <Card
      title="Review comments"
      description={`${open} open · ${comments.length - open} resolved — comments are added and resolved in the checklist workspace.`}
      actions={
        <Link to={`/audits/${audit.id}/workspace`} className="link text-sm">
          Open checklist
        </Link>
      }
    >
      {query.isLoading ? (
        <LoadingState />
      ) : (
        <ul className="divide-y divide-slate-100">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-3 py-2.5 text-sm">
              <Badge tone={c.is_resolved ? "green" : "purple"}>{c.is_resolved ? "Resolved" : "Open"}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-slate-800">
                  {c.question !== null ? (
                    <Link to={`/audits/${audit.id}/workspace#q-${c.question}`} className="link mr-1 font-mono text-xs">
                      {c.question_code || `Q${c.question}`}
                    </Link>
                  ) : (
                    <span className="mr-1 text-xs font-medium text-slate-500">Audit-level</span>
                  )}
                  {c.body}
                </p>
                <p className="text-xs text-slate-500">
                  {c.author.full_name} · {formatDateTime(c.created_at)}
                  {c.is_resolved &&
                    ` · resolved by ${c.resolved_by?.full_name ?? "—"}${c.resolution_note ? `: ${c.resolution_note}` : ""}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReviewTab({ audit }: { audit: AuditDetail }) {
  return (
    <div className="space-y-6">
      <ReviewCommentsCard audit={audit} />
      <ReviewDecisionsCard audit={audit} />
    </div>
  );
}

function ReviewDecisionsCard({ audit }: { audit: AuditDetail }) {
  const query = useQuery({ queryKey: ["audit-reviews", audit.id], queryFn: () => auditsApi.reviews(audit.id) });

  return (
    <Card title="Review decisions" description={`Reviewer: ${audit.reviewer?.full_name ?? "not assigned"}`}>
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState
          title="No review decisions yet"
          description={
            audit.status === "SUBMITTED"
              ? "The audit is awaiting the reviewer's decision."
              : "Decisions appear here once the audit is submitted and reviewed."
          }
        />
      ) : (
        <ol className="relative space-y-6 border-l border-slate-200 pl-6">
          {query.data.map((r) => (
            <li key={r.id} className="relative">
              <span
                className={clsx(
                  "absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white",
                  r.decision === "APPROVED" ? "bg-green-500" : "bg-orange-500",
                )}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.decision === "APPROVED" ? "green" : "orange"}>
                  {r.decision === "APPROVED" ? "Approved" : "Rework requested"}
                </Badge>
                <span className="text-sm font-medium text-slate-800">{r.reviewer.full_name}</span>
                <span className="text-xs text-slate-500" title={formatDateTime(r.created_at)}>
                  {formatDateTime(r.created_at)}
                </span>
              </div>
              {r.comments ? (
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{r.comments}</p>
              ) : (
                <p className="mt-1 text-xs italic text-slate-400">No comments</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- history

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("from" in obj && "to" in obj) return `${formatChangeValue(obj.from)} → ${formatChangeValue(obj.to)}`;
    const text = JSON.stringify(obj);
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }
  if (typeof value === "string" && /^[A-Z_]+$/.test(value) && value in AUDIT_STATUS_LABELS) {
    return AUDIT_STATUS_LABELS[value as keyof typeof AUDIT_STATUS_LABELS];
  }
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function ChangeSummary({ changes }: { changes: Record<string, unknown> }) {
  const entries = Object.entries(changes ?? {});
  if (!entries.length) return null;
  return (
    <dl className="mt-1.5 space-y-0.5 rounded-md bg-slate-50 px-3 py-2 text-xs">
      {entries.slice(0, 8).map(([key, value]) => (
        <div key={key} className="flex flex-wrap gap-x-1.5">
          <dt className="font-medium text-slate-600">{humanize(key)}:</dt>
          <dd className="break-all text-slate-700">{formatChangeValue(value)}</dd>
        </div>
      ))}
      {entries.length > 8 && <p className="text-slate-400">+{entries.length - 8} more</p>}
    </dl>
  );
}

function HistoryTab({ audit }: { audit: AuditDetail }) {
  const query = useQuery({ queryKey: ["audit-history", audit.id], queryFn: () => auditsApi.history(audit.id) });

  return (
    <Card title="Activity history" description="Tamper-evident log of every change to this audit (latest 200 entries).">
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState title="No activity recorded" />
      ) : (
        <ol className="space-y-4">
          {query.data.map((log: ActivityLog) => (
            <li key={log.id} className="flex gap-3">
              <Avatar name={log.actor_name || log.actor_email || "System"} className="h-7 w-7 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">
                  <span className="font-medium">{log.actor_name || log.actor_email || "System"}</span>{" "}
                  <span className="text-slate-600">{humanize(log.action)}</span>
                </p>
                <p className="text-xs text-slate-500" title={formatDateTime(log.created_at)}>
                  {timeAgo(log.created_at)} · {formatDateTime(log.created_at)}
                </p>
                <ChangeSummary changes={log.changes} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
