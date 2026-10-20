import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Gauge,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toApiError } from "@/api/client";
import { aiApi, findingsApi } from "@/api/endpoints";
import { ActionStatusBadge, Badge, FindingStatusBadge, OverdueBadge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, DetailList } from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Form";
import { FileList, FileUploadButton, ProgressBar } from "@/components/ui/Misc";
import { Modal, ReasonDialog } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { ActionFormModal } from "@/features/corrective-actions/ActionFormModal";
import type { ActivityLog, AIDraft, FindingDetail, RiskMatrix, Severity } from "@/types/api";
import { FindingFormModal } from "./FindingFormModal";
import {
  IMPACT_LABELS,
  LIKELIHOOD_LABELS,
  RISK_CATEGORY_LABELS,
  SEVERITY_LABELS,
  formatDate,
  formatDateTime,
  humanize,
  options,
  severityForScore as severityFor,
  timeAgo,
} from "@/utils/format";

// ---------------------------------------------------------------- local helpers

const LIKELIHOOD_OPTIONS = LIKELIHOOD_LABELS.map((label, i) => ({ value: i + 1, label: `${i + 1} — ${label}` }));
const IMPACT_OPTIONS = IMPACT_LABELS.map((label, i) => ({ value: i + 1, label: `${i + 1} — ${label}` }));

const CELL_TONE: Record<Severity, { idle: string; active: string }> = {
  CRITICAL: { idle: "bg-red-100 text-red-800", active: "bg-red-600 text-white" },
  HIGH: { idle: "bg-orange-100 text-orange-800", active: "bg-orange-500 text-white" },
  MEDIUM: { idle: "bg-amber-100 text-amber-800", active: "bg-amber-500 text-white" },
  LOW: { idle: "bg-green-100 text-green-800", active: "bg-green-600 text-white" },
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("from" in obj && "to" in obj) return `${formatValue(obj.from)} → ${formatValue(obj.to)}`;
    return Object.entries(obj)
      .map(([k, v]) => `${humanize(k)}: ${formatValue(v)}`)
      .join(", ");
  }
  return String(value);
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</h3>
      {value?.trim() ? (
        <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{value}</p>
      ) : (
        <p className="mt-1 text-sm text-slate-400">—</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page

type DialogName = "edit" | "assess" | "close" | "accept" | "reopen" | "action" | "ai";

export default function FindingDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const validId = Number.isInteger(id) && id > 0;
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<AIDraft | null>(null);

  const query = useQuery({ queryKey: ["finding", id], queryFn: () => findingsApi.get(id), enabled: validId });
  const history = useQuery({
    queryKey: ["finding-history", id],
    queryFn: () => findingsApi.history(id),
    enabled: validId,
  });
  const matrix = useQuery({ queryKey: ["risk-matrix"], queryFn: findingsApi.riskMatrix, staleTime: 10 * 60_000 });

  const finding = query.data;
  const aiAllowed = can("use_ai") && !!finding?.permissions.can_add_action;
  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: aiApi.status,
    enabled: aiAllowed,
    staleTime: 5 * 60_000,
  });
  const aiReady = !!aiStatus.data?.enabled && !!aiStatus.data?.llm_configured;

  const open = (name: DialogName) => {
    setDialogError(null);
    setDialog(name);
  };
  const closeDialog = () => setDialog(null);

  const refresh = (updated?: FindingDetail) => {
    if (updated) queryClient.setQueryData(["finding", id], updated);
    queryClient.invalidateQueries({ queryKey: ["finding"] });
    queryClient.invalidateQueries({ queryKey: ["finding-history", id] });
    queryClient.invalidateQueries({ queryKey: ["findings"] });
    queryClient.invalidateQueries({ queryKey: ["actions"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const onDialogError = (e: unknown, field: string) => {
    const err = toApiError(e);
    setDialogError(err.fieldErrors[field]?.[0] ?? err.message);
    toast.error(err);
  };

  const closeMutation = useMutation({
    mutationFn: ({ notes, acceptRisk }: { notes: string; acceptRisk: boolean }) =>
      findingsApi.close(id, notes, acceptRisk),
    onSuccess: (updated, vars) => {
      toast.success(vars.acceptRisk ? `Risk accepted for ${updated.reference}` : `Finding ${updated.reference} closed`);
      refresh(updated);
      closeDialog();
    },
    onError: (e) => onDialogError(e, "notes"),
  });

  const reopenMutation = useMutation({
    mutationFn: (notes: string) => findingsApi.reopen(id, notes),
    onSuccess: (updated) => {
      toast.success(`Finding ${updated.reference} reopened`);
      refresh(updated);
      closeDialog();
    },
    onError: (e) => onDialogError(e, "notes"),
  });

  const aiMutation = useMutation({
    mutationFn: async () => {
      const status = await aiApi.status();
      if (!status.enabled || !status.llm_configured) {
        throw new Error("The AI assistant is not enabled for this organisation.");
      }
      return aiApi.actionRecommendation(id);
    },
    onSuccess: (draft) => {
      setAiDraft(draft);
      open("ai");
    },
    onError: (e) => toast.error(e),
  });

  if (!validId) return <ErrorState error={new Error("Invalid finding id.")} />;
  if (query.isLoading) return <LoadingState label="Loading finding…" />;
  if (query.error || !finding) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const p = finding.permissions;
  const thresholds = matrix.data;
  const latestAssessment = [...finding.risk_assessments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const calculatedSeverity = latestAssessment?.calculated_severity ?? severityFor(finding.risk_score, thresholds);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Findings", to: "/findings" }, { label: finding.reference }]}
        title={
          <>
            <span className="mr-2 font-mono text-base font-medium text-slate-500">{finding.reference}</span>
            {finding.title}
          </>
        }
        meta={
          <>
            <SeverityBadge severity={finding.severity} />
            {finding.severity_overridden && (
              <span title={`Calculated severity: ${SEVERITY_LABELS[calculatedSeverity]}`}>
                <Badge tone="amber">Overridden</Badge>
              </span>
            )}
            <FindingStatusBadge status={finding.status} />
            {finding.is_overdue && <OverdueBadge />}
            <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" aria-hidden />
            <Link to={`/audits/${finding.audit.id}`} className="link inline-flex items-center gap-1 text-sm">
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              {finding.audit.reference} · {finding.audit.title}
            </Link>
            <Link to={`/departments/${finding.department.id}`} className="link inline-flex items-center gap-1 text-sm">
              <Building2 className="h-4 w-4" aria-hidden />
              {finding.department.name}
            </Link>
          </>
        }
        actions={
          <>
            {p.can_edit && (
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => open("edit")}>
                Edit
              </Button>
            )}
            {p.can_edit && (
              <Button variant="secondary" icon={<Gauge className="h-4 w-4" />} onClick={() => open("assess")}>
                Reassess risk
              </Button>
            )}
            {p.can_reopen && (
              <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => open("reopen")}>
                Reopen
              </Button>
            )}
            {p.can_accept_risk && (
              <Button variant="danger" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => open("accept")}>
                Accept risk
              </Button>
            )}
            {p.can_close && (
              <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => open("close")}>
                Close finding
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <FindingDetailsCard finding={finding} />

          <Card
            title="Corrective actions"
            description={`${finding.open_actions_count} open of ${finding.actions_count}`}
            bodyClassName="p-0"
            actions={
              <>
                {aiAllowed && (
                  <span
                    title={
                      aiReady
                        ? "Draft action ideas with the AI assistant"
                        : aiStatus.isLoading
                          ? "Checking AI availability…"
                          : "The AI assistant is not enabled for this organisation"
                    }
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Sparkles className="h-4 w-4" />}
                      disabled={!aiReady}
                      loading={aiMutation.isPending}
                      onClick={() => aiMutation.mutate()}
                    >
                      Suggest actions (AI)
                    </Button>
                  </span>
                )}
                {p.can_add_action && (
                  <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open("action")}>
                    Assign action
                  </Button>
                )}
              </>
            }
          >
            <ActionsTable finding={finding} />
          </Card>

          <Card
            title="Evidence"
            description="Files supporting this finding. Downloads are logged."
            actions={
              p.can_upload_evidence && (
                <FileUploadButton
                  label="Upload evidence"
                  onUpload={(file) => findingsApi.uploadEvidence(id, file).then(() => refresh())}
                />
              )
            }
          >
            <FileList files={finding.evidence} emptyText="No evidence attached to this finding." />
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <RiskPanel finding={finding} matrix={thresholds} calculatedSeverity={calculatedSeverity} />

          <Card title="Risk assessment history" description="Every scoring and override is recorded.">
            {finding.risk_assessments.length === 0 ? (
              <p className="text-sm text-slate-500">No assessments recorded.</p>
            ) : (
              <ol className="space-y-3">
                {finding.risk_assessments.map((a) => (
                  <li key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium tabular-nums text-slate-800">
                        {a.likelihood} × {a.impact} = {a.score}
                      </span>
                      <span className="text-xs text-slate-500" title={formatDateTime(a.created_at)}>
                        {formatDate(a.created_at)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span>Calculated</span>
                      <SeverityBadge severity={a.calculated_severity} />
                      {a.final_severity !== a.calculated_severity && (
                        <>
                          <span aria-hidden>→</span>
                          <span>Final</span>
                          <SeverityBadge severity={a.final_severity} />
                        </>
                      )}
                      {a.is_override && <Badge tone="amber">Override</Badge>}
                    </div>
                    {a.rationale && <p className="mt-2 whitespace-pre-line text-slate-600">{a.rationale}</p>}
                    <p className="mt-1 text-xs text-slate-500">by {a.assessed_by?.full_name ?? "System"}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="History" description="Activity log for this finding.">
            <HistoryTimeline query={history} />
          </Card>
        </div>
      </div>

      <FindingFormModal open={dialog === "edit"} onClose={closeDialog} finding={finding} onSaved={() => refresh()} />

      <AssessRiskModal
        open={dialog === "assess"}
        onClose={closeDialog}
        finding={finding}
        thresholds={thresholds}
        onSaved={(updated) => {
          refresh(updated);
          closeDialog();
        }}
      />

      <ReasonDialog
        open={dialog === "close"}
        onClose={closeDialog}
        title={`Close finding ${finding.reference}`}
        message={
          finding.open_actions_count > 0
            ? `${finding.open_actions_count} corrective action(s) are still open. All actions must be verified and closed before the finding can be closed.`
            : "Record how the finding was resolved. The closure is recorded in the audit trail."
        }
        label="Closure notes"
        confirmLabel="Close finding"
        loading={closeMutation.isPending}
        error={dialogError}
        onSubmit={(notes) => closeMutation.mutate({ notes, acceptRisk: false })}
      />

      <ReasonDialog
        open={dialog === "accept"}
        onClose={closeDialog}
        title={`Accept risk for ${finding.reference}`}
        message="The finding will be closed as “Risk accepted” without further remediation, even if actions remain open. Document who accepted the risk and why."
        label="Risk acceptance rationale"
        confirmLabel="Accept risk"
        tone="danger"
        loading={closeMutation.isPending}
        error={dialogError}
        onSubmit={(notes) => closeMutation.mutate({ notes, acceptRisk: true })}
      />

      <ReasonDialog
        open={dialog === "reopen"}
        onClose={closeDialog}
        title={`Reopen finding ${finding.reference}`}
        message="The finding returns to an open state and its status is recalculated from its corrective actions."
        label="Reason for reopening"
        confirmLabel="Reopen finding"
        loading={reopenMutation.isPending}
        error={dialogError}
        onSubmit={(notes) => reopenMutation.mutate(notes)}
      />

      <ActionFormModal
        open={dialog === "action"}
        onClose={closeDialog}
        findingId={finding.id}
        findingTitle={`${finding.reference} · ${finding.title}`}
        defaultDescription={finding.recommended_action}
        onSaved={() => refresh()}
      />

      <AIDraftModal open={dialog === "ai"} onClose={closeDialog} draft={aiDraft} />
    </>
  );
}

// ---------------------------------------------------------------- sections

function FindingDetailsCard({ finding }: { finding: FindingDetail }) {
  const closed = finding.status === "CLOSED" || finding.status === "RISK_ACCEPTED";
  return (
    <Card title="Finding details">
      <div className="space-y-4">
        <TextBlock label="Description" value={finding.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextBlock label="Expected requirement" value={finding.expected_requirement} />
          <TextBlock label="Observed condition" value={finding.observed_condition} />
          <TextBlock label="Root cause" value={finding.root_cause} />
          <TextBlock label="Business impact" value={finding.business_impact} />
        </div>
        <TextBlock label="Recommended action" value={finding.recommended_action} />
        <div className="border-t border-slate-100 pt-4">
          <DetailList
            items={[
              { label: "Risk category", value: RISK_CATEGORY_LABELS[finding.risk_category] },
              {
                label: "Owner",
                value: finding.owner?.full_name ?? <span className="text-slate-400">Unassigned</span>,
              },
              {
                label: "Target date",
                value: (
                  <span className={clsx(finding.is_overdue && "font-medium text-red-600")}>
                    {formatDate(finding.target_date)}
                  </span>
                ),
              },
              {
                label: "Checklist question",
                value: finding.question ? (
                  <span>
                    {finding.question.code && (
                      <span className="mr-1 font-mono text-xs text-slate-500">{finding.question.code}</span>
                    )}
                    {finding.question.text}
                  </span>
                ) : (
                  <span className="text-slate-400">Not linked to a checklist question</span>
                ),
              },
              { label: "Raised by", value: finding.created_by?.full_name ?? "—" },
              { label: "Raised on", value: formatDateTime(finding.created_at) },
              { label: "Last updated", value: formatDateTime(finding.updated_at) },
            ]}
          />
        </div>
        {(closed || finding.closed_at) && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {finding.status === "RISK_ACCEPTED" ? "Risk acceptance" : "Closure"}
            </h3>
            <DetailList
              items={[
                { label: "Closed by", value: finding.closed_by?.full_name ?? "—" },
                { label: "Closed on", value: formatDateTime(finding.closed_at) },
              ]}
            />
            <div className="mt-4">
              <TextBlock label="Notes" value={finding.closure_notes} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function RiskPanel({
  finding,
  matrix,
  calculatedSeverity,
}: {
  finding: FindingDetail;
  matrix?: RiskMatrix;
  calculatedSeverity: Severity;
}) {
  const impacts = [5, 4, 3, 2, 1];
  const likelihoods = [1, 2, 3, 4, 5];
  return (
    <Card title="Risk score" description="Likelihood × impact against the organisation's thresholds.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-sm text-slate-500" title={`Likelihood: ${LIKELIHOOD_LABELS[finding.likelihood - 1]}`}>
            L {finding.likelihood}
          </span>
          <span className="text-slate-400">×</span>
          <span className="text-sm text-slate-500" title={`Impact: ${IMPACT_LABELS[finding.impact - 1]}`}>
            I {finding.impact}
          </span>
          <span className="text-slate-400">=</span>
          <span className="text-3xl font-semibold text-slate-900">{finding.risk_score}</span>
        </div>
        <SeverityBadge severity={finding.severity} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {LIKELIHOOD_LABELS[finding.likelihood - 1]} likelihood · {IMPACT_LABELS[finding.impact - 1]} impact
      </p>
      {finding.severity_overridden && (
        <div className="mt-3">
          <Notice tone="warning">
            Severity overridden to {SEVERITY_LABELS[finding.severity]}; the calculated severity is{" "}
            {SEVERITY_LABELS[calculatedSeverity]}.
          </Notice>
        </div>
      )}

      <div className="mt-4">
        <div
          className="grid grid-cols-[1.25rem_repeat(5,minmax(0,1fr))] gap-1"
          role="img"
          aria-label={`Risk matrix. Current position: likelihood ${finding.likelihood}, impact ${finding.impact}, score ${finding.risk_score}.`}
        >
          {impacts.map((impact) => (
            <div key={impact} className="contents">
              <div className="flex items-center justify-center text-[11px] font-medium text-slate-500">{impact}</div>
              {likelihoods.map((likelihood) => {
                const score = likelihood * impact;
                const severity = severityFor(score, matrix);
                const current = likelihood === finding.likelihood && impact === finding.impact;
                return (
                  <div
                    key={likelihood}
                    title={`L${likelihood} × I${impact} = ${score} (${SEVERITY_LABELS[severity]})`}
                    className={clsx(
                      "flex aspect-square items-center justify-center rounded text-xs tabular-nums",
                      current
                        ? `${CELL_TONE[severity].active} font-bold ring-2 ring-slate-900 ring-offset-1`
                        : CELL_TONE[severity].idle,
                    )}
                  >
                    {score}
                  </div>
                );
              })}
            </div>
          ))}
          <div />
          {likelihoods.map((l) => (
            <div key={l} className="text-center text-[11px] font-medium text-slate-500">
              {l}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between pl-6 text-[11px] text-slate-500">
          <span>↑ Impact</span>
          <span>Likelihood →</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
          {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Severity[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={clsx("h-2.5 w-2.5 rounded-sm", CELL_TONE[s].active)} aria-hidden />
              {SEVERITY_LABELS[s]}
              {matrix && (
                <span className="text-slate-400">
                  {s === "CRITICAL"
                    ? `≥${matrix.critical_threshold}`
                    : s === "HIGH"
                      ? `≥${matrix.high_threshold}`
                      : s === "MEDIUM"
                        ? `≥${matrix.medium_threshold}`
                        : `<${matrix.medium_threshold}`}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
      {matrix?.explanation && <p className="mt-3 text-xs leading-relaxed text-slate-500">{matrix.explanation}</p>}
    </Card>
  );
}

function ActionsTable({ finding }: { finding: FindingDetail }) {
  if (finding.actions.length === 0) {
    return (
      <EmptyState
        title="No corrective actions yet"
        description={
          finding.permissions.can_add_action
            ? "Assign an action to an owner to remediate this finding."
            : "Actions assigned by the department manager or an administrator will appear here."
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Action</th>
            <th scope="col">Type</th>
            <th scope="col">Owner</th>
            <th scope="col">Due</th>
            <th scope="col">Status</th>
            <th scope="col">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {finding.actions.map((a) => (
            <tr key={a.id}>
              <td>
                <Link to={`/actions/${a.id}`} className="link whitespace-nowrap">
                  {a.reference}
                </Link>
              </td>
              <td className="min-w-[180px] font-medium text-slate-800">{a.title}</td>
              <td>{a.action_type === "CORRECTIVE" ? "Corrective" : "Preventive"}</td>
              <td className="whitespace-nowrap">{a.owner.full_name}</td>
              <td className={clsx("whitespace-nowrap", a.is_overdue && "font-medium text-red-600")}>
                {formatDate(a.due_date)}
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  <ActionStatusBadge status={a.status} />
                  {a.is_overdue && <OverdueBadge />}
                </div>
              </td>
              <td className="min-w-[110px]">
                <div className="flex items-center gap-2">
                  <ProgressBar value={a.progress} tone={a.status === "CLOSED" ? "green" : "brand"} />
                  <span className="w-9 text-right text-xs tabular-nums text-slate-500">{a.progress}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTimeline({
  query,
}: {
  query: { data?: ActivityLog[]; isLoading: boolean; error: unknown; refetch: () => unknown };
}) {
  if (query.isLoading) return <LoadingState className="py-6" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} className="py-6" />;
  const logs = query.data ?? [];
  if (!logs.length) return <p className="text-sm text-slate-500">No activity recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-4">
      {logs.map((log) => {
        const changes = Object.entries(log.changes ?? {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
        return (
          <li key={log.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500" aria-hidden />
            <p className="text-sm text-slate-800">
              <span className="font-medium">{log.actor_name || log.actor_email || "System"}</span>{" "}
              <span className="text-slate-600">{humanize(log.action.replace(/^finding\./, "")).toLowerCase()}</span>
            </p>
            <p className="text-xs text-slate-500" title={formatDateTime(log.created_at)}>
              {timeAgo(log.created_at)}
            </p>
            {changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {changes.slice(0, 6).map(([key, value]) => (
                  <li key={key} className="break-words">
                    <span className="text-slate-500">{humanize(key)}:</span> {formatValue(value)}
                  </li>
                ))}
                {changes.length > 6 && <li className="text-slate-400">+{changes.length - 6} more change(s)</li>}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- dialogs

function AssessRiskModal({
  open,
  onClose,
  finding,
  thresholds,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  finding: FindingDetail;
  thresholds?: RiskMatrix;
  onSaved: (finding: FindingDetail) => void;
}) {
  const toast = useToast();
  const [likelihood, setLikelihood] = useState(finding.likelihood);
  const [impact, setImpact] = useState(finding.impact);
  const [override, setOverride] = useState<Severity | "">("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canOverride = finding.permissions.can_override_severity;

  useEffect(() => {
    if (!open) return;
    setLikelihood(finding.likelihood);
    setImpact(finding.impact);
    setOverride("");
    setRationale("");
    setError(null);
  }, [open, finding.likelihood, finding.impact]);

  const score = likelihood * impact;
  const calculated = severityFor(score, thresholds);
  const finalSeverity = override || calculated;
  const rationaleMissing = !!override && !rationale.trim();

  const mutation = useMutation({
    mutationFn: () =>
      findingsApi.assess(finding.id, {
        likelihood,
        impact,
        override_severity: override || null,
        rationale: rationale.trim(),
      }),
    onSuccess: (updated) => {
      toast.success(`Risk reassessed: ${SEVERITY_LABELS[updated.severity]} (score ${updated.risk_score})`);
      onSaved(updated);
    },
    onError: (e) => {
      const err = toApiError(e);
      setError(err.fieldErrors.rationale?.[0] ?? err.fieldErrors.override_severity?.[0] ?? err.message);
      toast.error(err);
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reassess risk — ${finding.reference}`}
      description="A new assessment is recorded in the risk history."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={rationaleMissing}>
            Save assessment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Likelihood"
            options={LIKELIHOOD_OPTIONS}
            value={likelihood}
            onChange={(e) => setLikelihood(Number(e.target.value))}
          />
          <Select
            label="Impact"
            options={IMPACT_OPTIONS}
            value={impact}
            onChange={(e) => setImpact(Number(e.target.value))}
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600" aria-live="polite">
          <p className="flex flex-wrap items-center gap-2">
            Score{" "}
            <strong className="tabular-nums text-slate-900">
              {likelihood} × {impact} = {score}
            </strong>
            <span aria-hidden>→</span>
            <span>calculated</span>
            <SeverityBadge severity={calculated} />
            {override && override !== calculated && (
              <>
                <span aria-hidden>→</span>
                <span>final</span>
                <SeverityBadge severity={finalSeverity} />
              </>
            )}
          </p>
        </div>

        {canOverride ? (
          <>
            <Select
              label="Override severity"
              placeholder="No override — use calculated severity"
              options={options(SEVERITY_LABELS)}
              value={override}
              onChange={(e) => setOverride(e.target.value as Severity | "")}
              hint="Only reviewers and administrators may override. The reason is kept in the audit trail."
            />
            <Textarea
              label={override ? "Override rationale" : "Rationale (optional)"}
              required={!!override}
              rows={3}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              error={rationaleMissing ? "A reason is required to override the calculated severity." : undefined}
            />
          </>
        ) : (
          <Textarea
            label="Rationale (optional)"
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        )}

        {finding.severity_overridden && !override && (
          <Notice tone="warning">
            The current severity ({SEVERITY_LABELS[finding.severity]}) is an override. Saving without an override
            reverts to the calculated severity.
          </Notice>
        )}
      </div>
    </Modal>
  );
}

function AIDraftModal({ open, onClose, draft }: { open: boolean; onClose: () => void; draft: AIDraft | null }) {
  const toast = useToast();
  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.draft);
      toast.success("Draft copied to clipboard");
    } catch {
      toast.error("Could not copy to the clipboard. Select the text and copy it manually.");
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Suggested corrective actions"
      description="AI-generated draft. Review it before assigning any action."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button icon={<Copy className="h-4 w-4" />} onClick={copy} disabled={!draft}>
            Copy draft
          </Button>
        </>
      }
    >
      {draft ? (
        <div className="space-y-3">
          <Notice tone="warning">{draft.disclaimer}</Notice>
          <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
            {draft.draft}
          </div>
          <p className="text-xs text-slate-500">
            Nothing has been created. Use “Assign action” to record an action with a named owner and due date.
          </p>
        </div>
      ) : (
        <LoadingState />
      )}
    </Modal>
  );
}
