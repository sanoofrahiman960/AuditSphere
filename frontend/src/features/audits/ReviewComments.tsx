import clsx from "clsx";
import { CheckCircle2, MessageSquareWarning, Send } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ReviewComment } from "@/types/api";
import { formatDateTime } from "@/utils/format";

/**
 * Reviewer comments for one question (or the whole audit). Reviewers add comments while the
 * audit is under review; the audit team resolves each one, with an optional note, during rework.
 */
export function ReviewComments({
  comments,
  canAdd,
  canResolve,
  onAdd,
  onResolve,
  compact = false,
}: {
  comments: ReviewComment[];
  canAdd: boolean;
  canResolve: boolean;
  onAdd: (body: string) => Promise<unknown>;
  onResolve: (comment: ReviewComment, note: string) => Promise<unknown>;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  if (!comments.length && !canAdd) return null;

  const submit = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await onAdd(draft.trim());
      setDraft("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={clsx("space-y-2", !compact && "border-t border-slate-100 pt-3")}>
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} canResolve={canResolve && !c.is_resolved} onResolve={onResolve} />
      ))}
      {canAdd &&
        (adding ? (
          <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3">
            <label className="label" htmlFor={inputId}>
              Review comment
            </label>
            <textarea
              id={inputId}
              className="input"
              rows={2}
              autoFocus
              value={draft}
              placeholder="What should the auditor change or clarify?"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
              }}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" icon={<Send className="h-4 w-4" />} loading={busy} disabled={!draft.trim()} onClick={submit}>
                Add comment
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-purple-700"
            icon={<MessageSquareWarning className="h-4 w-4" />}
            onClick={() => setAdding(true)}
          >
            Add review comment
          </Button>
        ))}
    </div>
  );
}

function CommentItem({
  comment: c,
  canResolve,
  onResolve,
}: {
  comment: ReviewComment;
  canResolve: boolean;
  onResolve: (comment: ReviewComment, note: string) => Promise<unknown>;
}) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    setBusy(true);
    try {
      await onResolve(c, note.trim());
      setResolving(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2 text-sm",
        c.is_resolved ? "border-slate-200 bg-slate-50 text-slate-500" : "border-purple-200 bg-purple-50/60 text-slate-800",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        {c.is_resolved ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-label="Resolved" />
        ) : (
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" aria-label="Open review comment" />
        )}
        <div className="min-w-0 flex-1">
          <p className={clsx("whitespace-pre-wrap", c.is_resolved && "line-through decoration-slate-300")}>{c.body}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {c.author.full_name} · {formatDateTime(c.created_at)}
          </p>
          {c.is_resolved && (
            <p className="mt-1 text-xs text-slate-600">
              Resolved by {c.resolved_by?.full_name ?? "—"} · {formatDateTime(c.resolved_at)}
              {c.resolution_note ? ` — ${c.resolution_note}` : ""}
            </p>
          )}
        </div>
        {canResolve && !resolving && (
          <Button variant="secondary" size="sm" onClick={() => setResolving(true)}>
            Mark resolved
          </Button>
        )}
      </div>
      {resolving && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          <input
            className="input h-8 flex-1 py-1"
            placeholder="What did you change? (optional)"
            value={note}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void resolve()}
            aria-label="Resolution note"
          />
          <Button variant="ghost" size="sm" onClick={() => setResolving(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="success" loading={busy} onClick={resolve}>
            Resolve
          </Button>
        </div>
      )}
    </div>
  );
}
