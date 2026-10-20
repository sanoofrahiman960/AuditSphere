import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  MessageSquare,
  Pencil,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toApiError } from "@/api/client";
import { actionsApi } from "@/api/endpoints";
import { ActionStatusBadge, Badge, OverdueBadge, PriorityBadge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, DetailList } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Form";
import { Avatar, FileList, FileUploadButton, ProgressBar } from "@/components/ui/Misc";
import { ConfirmDialog, Modal, ReasonDialog } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import type { ActionStatus, CorrectiveActionDetail } from "@/types/api";
import { ACTION_STATUS_LABELS, formatDate, formatDateTime, timeAgo } from "@/utils/format";
import { ActionFormModal } from "./ActionFormModal";

type DialogName = "start" | "edit" | "submit" | "verify" | "reopen";

const TYPE_LABEL = { CORRECTIVE: "Corrective", PREVENTIVE: "Preventive" } as const;

function isActionStatus(value: string): value is ActionStatus {
  return value in ACTION_STATUS_LABELS;
}

export default function ActionDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const validId = Number.isInteger(id) && id > 0;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["action", id], queryFn: () => actionsApi.get(id), enabled: validId });

  const open = (name: DialogName) => {
    setDialogError(null);
    setDialog(name);
  };
  const closeDialog = () => setDialog(null);

  const refresh = (updated?: CorrectiveActionDetail) => {
    if (updated) queryClient.setQueryData(["action", id], updated);
    queryClient.invalidateQueries({ queryKey: ["action", id] });
    queryClient.invalidateQueries({ queryKey: ["actions"] });
    queryClient.invalidateQueries({ queryKey: ["finding"] });
    queryClient.invalidateQueries({ queryKey: ["findings"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const startMutation = useMutation({
    mutationFn: () => actionsApi.start(id),
    onSuccess: (updated) => {
      toast.success(`${updated.reference} is now in progress`);
      refresh(updated);
      closeDialog();
    },
    onError: (e) => toast.error(e),
  });

  const reopenMutation = useMutation({
    mutationFn: (notes: string) => actionsApi.reopen(id, notes),
    onSuccess: (updated) => {
      toast.success(`${updated.reference} reopened for rework`);
      refresh(updated);
      closeDialog();
    },
    onError: (e) => {
      const err = toApiError(e);
      setDialogError(err.fieldErrors.notes?.[0] ?? err.message);
      toast.error(err);
    },
  });

  if (!validId) return <ErrorState error={new Error("Invalid action id.")} />;
  if (query.isLoading) return <LoadingState label="Loading corrective action…" />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const action = query.data;
  const p = action.permissions;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Corrective actions", to: "/actions" }, { label: action.reference }]}
        title={
          <>
            <span className="mr-2 font-mono text-base font-medium text-slate-500">{action.reference}</span>
            {action.title}
          </>
        }
        meta={
          <>
            <ActionStatusBadge status={action.status} />
            <PriorityBadge priority={action.priority} />
            {action.is_overdue && <OverdueBadge />}
            <Badge tone={action.action_type === "CORRECTIVE" ? "blue" : "teal"}>
              {TYPE_LABEL[action.action_type]}
            </Badge>
            <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" aria-hidden />
            <Link to={`/findings/${action.finding.id}`} className="link inline-flex items-center gap-1 text-sm">
              <FileWarning className="h-4 w-4" aria-hidden />
              {action.finding.reference} · {action.finding.title}
            </Link>
            <SeverityBadge severity={action.finding.severity} />
            <Link to={`/audits/${action.finding.audit_id}`} className="link inline-flex items-center gap-1 text-sm">
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              {action.finding.audit_reference}
            </Link>
          </>
        }
        actions={
          <>
            {p.can_edit_all_fields && (
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => open("edit")}>
                Edit plan
              </Button>
            )}
            {p.can_start && (
              <Button variant="secondary" icon={<Play className="h-4 w-4" />} onClick={() => open("start")}>
                Start work
              </Button>
            )}
            {p.can_reopen && (
              <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => open("reopen")}>
                Reopen
              </Button>
            )}
            {p.can_submit_verification && (
              <Button icon={<Send className="h-4 w-4" />} onClick={() => open("submit")}>
                Submit for verification
              </Button>
            )}
            {p.can_verify && (
              <Button icon={<ShieldCheck className="h-4 w-4" />} onClick={() => open("verify")}>
                Verify
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 space-y-3 empty:hidden">
        {p.is_owner && action.status === "PENDING_VERIFICATION" && (
          <Notice>An independent reviewer will verify this action.</Notice>
        )}
        {action.status === "REWORK_REQUIRED" && action.verification_notes && (
          <Notice tone="warning">
            <strong>Returned for rework</strong>
            {action.verified_by ? ` by ${action.verified_by.full_name}` : ""}: {action.verification_notes}
          </Notice>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ProgressCard action={action} onSaved={refresh} />

          <Card
            title="Resolution evidence"
            description="Proof that the action was implemented, reviewed during verification."
            actions={
              p.can_upload_evidence && (
                <FileUploadButton
                  label="Upload evidence"
                  onUpload={(file) => actionsApi.uploadEvidence(id, file).then(() => refresh())}
                />
              )
            }
          >
            <FileList files={action.evidence} emptyText="No resolution evidence uploaded yet." />
          </Card>

          <CommentsCard action={action} onAdded={() => refresh()} />
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Details">
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Description</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{action.description || "—"}</p>
              </div>
              <DetailList
                columns={1}
                items={[
                  { label: "Owner", value: action.owner.full_name },
                  {
                    label: "Department",
                    value: (
                      <Link to={`/departments/${action.department.id}`} className="link">
                        {action.department.name}
                      </Link>
                    ),
                  },
                  {
                    label: "Due date",
                    value: (
                      <span className={clsx(action.is_overdue && "font-medium text-red-600")}>
                        {formatDate(action.due_date)}
                      </span>
                    ),
                  },
                  { label: "Created by", value: action.created_by?.full_name ?? "—" },
                  { label: "Created", value: formatDateTime(action.created_at) },
                  { label: "Submitted for verification", value: formatDateTime(action.submitted_at) },
                  ...(action.closed_at ? [{ label: "Closed", value: formatDateTime(action.closed_at) }] : []),
                ]}
              />
            </div>
          </Card>

          <Card title="Verification">
            {action.verification_result ? (
              <DetailList
                columns={1}
                items={[
                  {
                    label: "Result",
                    value:
                      action.verification_result === "EFFECTIVE" ? (
                        <Badge tone="green">Effective</Badge>
                      ) : (
                        <Badge tone="red">Not effective</Badge>
                      ),
                  },
                  {
                    label: "Notes",
                    value: <span className="whitespace-pre-line">{action.verification_notes || "—"}</span>,
                  },
                  { label: "Verified by", value: action.verified_by?.full_name ?? "—" },
                  { label: "Verified at", value: formatDateTime(action.verified_at) },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-500">
                {action.status === "PENDING_VERIFICATION"
                  ? "Awaiting verification by the audit reviewer or an administrator."
                  : "Not yet submitted for verification."}
              </p>
            )}
          </Card>

          <Card title="Status timeline">
            <StatusTimeline action={action} />
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === "start"}
        onClose={closeDialog}
        onConfirm={() => startMutation.mutate()}
        loading={startMutation.isPending}
        title="Start work on this action"
        message={`${action.reference} will move to “In Progress”. The finding's status is updated accordingly.`}
        confirmLabel="Start work"
      />

      <ActionFormModal open={dialog === "edit"} onClose={closeDialog} action={action} onSaved={() => refresh()} />

      <SubmitVerificationModal
        open={dialog === "submit"}
        onClose={closeDialog}
        action={action}
        onDone={(updated) => {
          refresh(updated);
          closeDialog();
        }}
      />

      <VerifyModal
        open={dialog === "verify"}
        onClose={closeDialog}
        action={action}
        onDone={(updated) => {
          refresh(updated);
          closeDialog();
        }}
      />

      <ReasonDialog
        open={dialog === "reopen"}
        onClose={closeDialog}
        title={`Reopen ${action.reference}`}
        message="The action returns to “Rework Required” and the owner is notified."
        label="Reason for reopening"
        confirmLabel="Reopen action"
        loading={reopenMutation.isPending}
        error={dialogError}
        onSubmit={(notes) => reopenMutation.mutate(notes)}
      />
    </>
  );
}

// ---------------------------------------------------------------- progress

function ProgressCard({
  action,
  onSaved,
}: {
  action: CorrectiveActionDetail;
  onSaved: (updated: CorrectiveActionDetail) => void;
}) {
  const toast = useToast();
  const editable = action.permissions.can_edit && action.status !== "CLOSED";
  const [progress, setProgress] = useState(action.progress);
  const [notes, setNotes] = useState(action.resolution_notes);

  useEffect(() => {
    setProgress(action.progress);
    setNotes(action.resolution_notes);
  }, [action.progress, action.resolution_notes]);

  const dirty = progress !== action.progress || notes !== action.resolution_notes;

  const mutation = useMutation({
    mutationFn: () => actionsApi.update(action.id, { progress, resolution_notes: notes }),
    onSuccess: (updated) => {
      toast.success("Progress saved");
      onSaved(updated);
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Card
      title="Progress & resolution"
      description={editable ? "Keep the progress and resolution notes current for reviewers." : undefined}
    >
      {editable ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) mutation.mutate();
          }}
        >
          <div>
            <label htmlFor="action-progress" className="label">
              Progress
            </label>
            <div className="flex items-center gap-3">
              <input
                id="action-progress"
                type="range"
                min={0}
                max={100}
                step={10}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-brand-600"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={10}
                  value={progress}
                  aria-label="Progress percentage"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setProgress(Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0);
                  }}
                  className="input w-20 text-right tabular-nums"
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
            </div>
          </div>
          <Textarea
            label="Resolution notes"
            rows={4}
            value={notes}
            placeholder="What has been done so far, and how the issue is being resolved."
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setProgress(action.progress);
                  setNotes(action.resolution_notes);
                }}
                disabled={mutation.isPending}
              >
                Discard
              </Button>
            )}
            <Button type="submit" loading={mutation.isPending} disabled={!dirty}>
              Save progress
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ProgressBar value={action.progress} tone={action.status === "CLOSED" ? "green" : "brand"} className="h-2" />
            <span className="w-12 text-right text-sm font-medium tabular-nums text-slate-700">{action.progress}%</span>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Resolution notes</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-800">
              {action.resolution_notes || <span className="text-slate-400">No resolution notes yet.</span>}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- timeline & comments

function StatusTimeline({ action }: { action: CorrectiveActionDetail }) {
  const changes = [...action.status_changes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!changes.length) return <p className="text-sm text-slate-500">No status changes recorded.</p>;
  const label = (s: string) =>
    isActionStatus(s) ? <ActionStatusBadge status={s} /> : <span className="text-xs text-slate-500">{s || "—"}</span>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-4">
      {changes.map((c) => (
        <li key={c.id} className="relative">
          <span
            className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500"
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {c.from_status ? (
              <>
                {label(c.from_status)}
                <span className="text-xs text-slate-400" aria-label="to">
                  →
                </span>
              </>
            ) : (
              <span className="text-xs font-medium text-slate-600">Created as</span>
            )}
            {label(c.to_status)}
          </div>
          <p className="mt-1 text-xs text-slate-500" title={formatDateTime(c.created_at)}>
            {c.changed_by?.full_name ?? "System"} · {timeAgo(c.created_at)}
          </p>
          {c.note && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{c.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function CommentsCard({ action, onAdded }: { action: CorrectiveActionDetail; onAdded: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const comments = [...action.comments].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const mutation = useMutation({
    mutationFn: () => actionsApi.addComment(action.id, body.trim()),
    onSuccess: () => {
      setBody("");
      toast.success("Comment added");
      onAdded();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Card title="Comments" description={`${comments.length} comment${comments.length === 1 ? "" : "s"}`}>
      {comments.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <MessageSquare className="h-4 w-4" aria-hidden /> No comments yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.author.full_name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium text-slate-800">{c.author.full_name}</span>{" "}
                  <span className="text-xs text-slate-500" title={formatDateTime(c.created_at)}>
                    {timeAgo(c.created_at)}
                  </span>
                </p>
                <p className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-700">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {action.permissions.can_comment && (
        <form
          className="mt-4 space-y-2 border-t border-slate-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) mutation.mutate();
          }}
        >
          <Textarea
            label="Add a comment"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share an update or ask a question…"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={mutation.isPending} disabled={!body.trim()}>
              Post comment
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- workflow dialogs

function SubmitVerificationModal({
  open,
  onClose,
  action,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  action: CorrectiveActionDetail;
  onDone: (updated: CorrectiveActionDetail) => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNotes(action.resolution_notes);
    setError(null);
  }, [open, action.resolution_notes]);

  const mutation = useMutation({
    mutationFn: () => actionsApi.submitVerification(action.id, notes.trim()),
    onSuccess: (updated) => {
      toast.success(`${updated.reference} submitted for verification`);
      onDone(updated);
    },
    onError: (e) => {
      const err = toApiError(e);
      setError(err.fieldErrors.resolution_notes?.[0] ?? err.message);
      toast.error(err);
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Submit ${action.reference} for verification`}
      description="Progress is set to 100% and the reviewer is notified."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            icon={<Send className="h-4 w-4" />}
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!notes.trim()}
          >
            Submit for verification
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        {action.evidence.length === 0 ? (
          <Notice tone="warning">
            No resolution evidence has been uploaded. Upload evidence first so the reviewer can confirm the action was
            effective.
          </Notice>
        ) : (
          <p className="text-sm text-slate-600">
            {action.evidence.length} evidence file{action.evidence.length === 1 ? "" : "s"} attached.
          </p>
        )}
        <Textarea
          label="Resolution notes"
          required
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          hint="Describe what was done and how it addresses the finding."
          error={!notes.trim() ? "Describe how the action was resolved." : undefined}
        />
      </div>
    </Modal>
  );
}

function VerifyModal({
  open,
  onClose,
  action,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  action: CorrectiveActionDetail;
  onDone: (updated: CorrectiveActionDetail) => void;
}) {
  const toast = useToast();
  const [approved, setApproved] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setApproved(null);
    setNotes("");
    setError(null);
  }, [open]);

  const notesMissing = approved === false && !notes.trim();

  const mutation = useMutation({
    mutationFn: () => actionsApi.verify(action.id, approved === true, notes.trim()),
    onSuccess: (updated) => {
      toast.success(
        updated.status === "CLOSED"
          ? `${updated.reference} verified as effective and closed`
          : `${updated.reference} returned for rework`,
      );
      onDone(updated);
    },
    onError: (e) => {
      const err = toApiError(e);
      setError(err.fieldErrors.notes?.[0] ?? err.message);
      toast.error(err);
    },
  });

  const choice = (value: boolean, title: string, description: string, icon: ReactNode, tone: string) => (
    <label
      className={clsx(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition",
        approved === value ? tone : "border-slate-200 hover:border-slate-300",
      )}
    >
      <input
        type="radio"
        name="verification"
        className="mt-1 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
        checked={approved === value}
        onChange={() => setApproved(value)}
      />
      <span className="flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Verify ${action.reference}`}
      description="Review the resolution notes and evidence before deciding."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={approved === false ? "danger" : "success"}
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={approved === null || notesMissing}
          >
            {approved === false ? "Return for rework" : "Close action"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Resolution notes</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{action.resolution_notes || "—"}</p>
          <p className="mt-2 text-xs text-slate-500">
            {action.evidence.length} evidence file{action.evidence.length === 1 ? "" : "s"} attached
            {action.submitted_at ? ` · submitted ${formatDateTime(action.submitted_at)}` : ""}
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="label">Decision</legend>
          {choice(
            true,
            "Effective — close action",
            "The evidence shows the issue is resolved.",
            <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />,
            "border-green-300 bg-green-50",
          )}
          {choice(
            false,
            "Not effective — return for rework",
            "The owner must address your notes and resubmit.",
            <XCircle className="h-4 w-4 text-red-600" aria-hidden />,
            "border-red-300 bg-red-50",
          )}
        </fieldset>
        <Textarea
          label={approved === false ? "Reason for rejection" : "Verification notes"}
          required={approved === false}
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={notesMissing ? "Explain why the evidence is insufficient." : undefined}
          hint={approved === false ? undefined : "Optional when closing."}
        />
      </div>
    </Modal>
  );
}
