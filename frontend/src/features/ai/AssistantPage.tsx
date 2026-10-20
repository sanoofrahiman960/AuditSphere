import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpenText, Bot, FileText, Quote, RefreshCw, Search, Sparkles, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toApiError } from "@/api/client";
import { aiApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { useDepartmentOptions } from "@/hooks/useLookups";
import type { AIStatus, PolicyAnswer, PolicyDocument } from "@/types/api";
import { formatBytes, formatDate } from "@/utils/format";

const ACCEPTED = ".pdf,.txt,.md";

function isReady(status: AIStatus) {
  return status.enabled && status.llm_configured && status.retrieval_configured;
}

function notReadyReason(status: AIStatus): string | null {
  if (!status.enabled) return "The AI module is disabled.";
  if (!status.llm_configured) return "The language model is not configured (ANTHROPIC_API_KEY).";
  if (!status.retrieval_configured) return "Policy search is not configured (QDRANT_URL and EMBEDDING_API_URL).";
  return null;
}

function Disclaimer({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <p>
        <strong>Advisory only.</strong> {text}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- ask panel

function AskPanel({ status }: { status: AIStatus }) {
  const toast = useToast();
  const departments = useDepartmentOptions();
  const [question, setQuestion] = useState("");
  const [department, setDepartment] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: () => aiApi.ask(question.trim(), department ? Number(department) : null),
    onSuccess: () => setAsked(question.trim()),
    onError: (e) => toast.error(e),
  });

  const blocked = notReadyReason(status);
  const canSubmit = question.trim().length >= 3 && question.length <= 2000 && !blocked;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Search className="h-4 w-4 text-brand-600" aria-hidden />
          Ask the policies
        </span>
      }
      description="Answers are drawn only from approved, indexed policy documents and cite their sources."
    >
      <div className="space-y-4">
        <Disclaimer text={status.disclaimer} />
        {blocked && <Notice tone="warning">{blocked} Ask an administrator to finish the configuration.</Notice>}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) ask.mutate();
          }}
          noValidate
        >
          <Textarea
            label="Question"
            rows={3}
            maxLength={2000}
            placeholder="e.g. How often must privileged access be reviewed?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSubmit) ask.mutate();
            }}
            hint="Press Ctrl+Enter to ask."
          />
          <div className="flex flex-wrap items-end gap-3">
            <Select
              className="min-w-[220px] flex-1 sm:flex-none"
              label="Limit to department"
              placeholder="All departments"
              options={departments.data ?? []}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
            <Button type="submit" icon={<Sparkles className="h-4 w-4" />} loading={ask.isPending} disabled={!canSubmit}>
              Ask
            </Button>
          </div>
        </form>

        {ask.isPending && <LoadingState label="Searching approved policies…" className="py-6" />}
        {!ask.isPending && ask.data && asked && <AnswerView question={asked} answer={ask.data} />}
      </div>
    </Card>
  );
}

function AnswerView({ question, answer }: { question: string; answer: PolicyAnswer }) {
  return (
    <div className="space-y-4 border-t border-slate-100 pt-4" aria-live="polite">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Question</p>
        <p className="mt-1 text-sm text-slate-700">{question}</p>
      </div>
      <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-brand-700">
          <Bot className="h-4 w-4" aria-hidden /> Draft answer
        </p>
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{answer.answer}</p>
      </div>

      <Disclaimer text={answer.disclaimer} />

      {answer.citations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Citations ({answer.citations.length})
          </p>
          <ul className="space-y-2">
            {answer.citations.map((c, i) => (
              <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                  <FileText className="h-4 w-4 text-slate-400" aria-hidden />
                  {c.document_title}
                  {c.page != null && <Badge>Page {c.page}</Badge>}
                </p>
                <blockquote className="mt-2 flex gap-2 border-l-2 border-brand-300 pl-3 text-sm italic text-slate-600">
                  <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
                  {c.cited_text}
                </blockquote>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.sources.length > 0 && (
        <details className="group rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700">
            Retrieved passages ({answer.sources.length})
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {answer.sources.map((s, i) => (
              <li key={i} className="px-3 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                  <span className="font-medium">{s.document_title}</span>
                  {s.page != null && <Badge>Page {s.page}</Badge>}
                  <span className="text-xs tabular-nums text-slate-500" title="Similarity score">
                    relevance {s.score.toFixed(3)}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{s.excerpt}…</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- upload modal

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const departments = useDepartmentOptions();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [department, setDepartment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setVersionLabel("");
      setDepartment("");
      setFile(null);
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  const upload = useMutation({
    mutationFn: () =>
      aiApi.uploadDocument({
        title: title.trim(),
        description: description.trim(),
        version_label: versionLabel.trim(),
        department: department ? Number(department) : null,
        file: file!,
      }),
    onSuccess: (doc) => {
      toast.success(`"${doc.title}" uploaded. Approve and index it to make it searchable.`);
      queryClient.invalidateQueries({ queryKey: ["policy-documents"] });
      onClose();
    },
    onError: (e) => {
      const err = toApiError(e);
      const mapped: Record<string, string> = {};
      let unmatched: string | null = null;
      for (const [field, messages] of Object.entries(err.fieldErrors)) {
        if (["title", "description", "version_label", "department", "file"].includes(field)) mapped[field] = messages[0];
        else unmatched = unmatched ?? messages[0];
      }
      setErrors(mapped);
      setFormError(unmatched ?? (Object.keys(err.fieldErrors).length ? null : err.message));
    },
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = "Give the document a title.";
    if (!file) next.file = "Choose a PDF, TXT or MD file.";
    else if (!/\.(pdf|txt|md)$/i.test(file.name)) next.file = "Policy documents must be PDF, TXT or MD.";
    setErrors(next);
    if (Object.keys(next).length === 0) upload.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Upload policy document"
      description="Uploaded documents are not searchable until they are approved and indexed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button icon={<Upload className="h-4 w-4" />} onClick={submit} loading={upload.isPending}>
            Upload
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <InlineError message={formError} />
        <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Textarea
          label="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Version label"
            placeholder="e.g. v3.1 (2026)"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            error={errors.version_label}
          />
          <Select
            label="Department"
            placeholder="Organisation-wide"
            options={departments.data ?? []}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            error={errors.department}
          />
        </div>
        <Field label="File" required error={errors.file} hint="PDF, TXT or Markdown." htmlFor="policy-file">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              id="policy-file"
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => fileInput.current?.click()}>
              {file ? "Choose another file" : "Choose file"}
            </Button>
            <span className="min-w-0 truncate text-sm text-slate-600">
              {file ? `${file.name} · ${formatBytes(file.size)}` : "No file chosen"}
            </span>
          </div>
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- documents

const STATUS_TONE = { PENDING: "amber", PROCESSED: "green", FAILED: "red" } as const;
const STATUS_LABEL = { PENDING: "Not indexed", PROCESSED: "Indexed", FAILED: "Indexing failed" } as const;

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 " +
        (checked ? "bg-green-600" : "bg-slate-300")
      }
    >
      <span
        className={"inline-block h-4 w-4 rounded-full bg-white shadow transition " + (checked ? "translate-x-4" : "translate-x-0.5")}
      />
    </button>
  );
}

function DocumentsCard({ status }: { status: AIStatus }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can("manage_templates");
  const [uploading, setUploading] = useState(false);
  const ready = isReady(status);

  const query = useQuery({
    queryKey: ["policy-documents"],
    queryFn: () => aiApi.documents({ page_size: 200 }),
  });

  const approve = useMutation({
    mutationFn: (vars: { id: number; is_approved: boolean }) => aiApi.updateDocument(vars.id, { is_approved: vars.is_approved }),
    onSuccess: (doc) => {
      toast.success(doc.is_approved ? `"${doc.title}" approved for search` : `"${doc.title}" withdrawn from search`);
      queryClient.invalidateQueries({ queryKey: ["policy-documents"] });
    },
    onError: (e) => toast.error(e),
  });

  const index = useMutation({
    mutationFn: (id: number) => aiApi.indexDocument(id),
    onSuccess: (doc) => {
      if (doc.status === "FAILED") toast.error(`Indexing "${doc.title}" failed: ${doc.error || "unknown error"}`);
      else toast.success(`"${doc.title}" indexed — ${doc.chunk_count} passages from ${doc.page_count} page(s)`);
      queryClient.invalidateQueries({ queryKey: ["policy-documents"] });
    },
    onError: (e) => {
      toast.error(e);
      queryClient.invalidateQueries({ queryKey: ["policy-documents"] });
    },
  });

  const docs = query.data?.results ?? [];

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <BookOpenText className="h-4 w-4 text-brand-600" aria-hidden />
          Policy documents
        </span>
      }
      description="Only documents that are both approved and indexed are searched."
      actions={
        canManage && (
          <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setUploading(true)}>
            Upload document
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No policy documents yet"
          description={
            canManage
              ? "Upload approved policies, SOPs and standards (PDF, TXT or MD) so auditors can search them."
              : "Audit administrators upload approved policies here."
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map((doc: PolicyDocument) => {
            const indexing = index.isPending && index.variables === doc.id;
            return (
              <li key={doc.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                    {doc.title}
                    {doc.version_label && <Badge tone="indigo">{doc.version_label}</Badge>}
                    <span title={doc.status === "FAILED" ? doc.error : undefined}>
                      <Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
                    </span>
                    {!canManage && (doc.is_approved ? <Badge tone="green">Approved</Badge> : <Badge>Not approved</Badge>)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {doc.department_name ?? "Organisation-wide"} · {doc.original_name} · {formatBytes(doc.size)}
                    {doc.status === "PROCESSED" && ` · ${doc.page_count} page(s), ${doc.chunk_count} passages`} · Uploaded{" "}
                    {formatDate(doc.created_at)}
                  </p>
                  {doc.description && <p className="mt-1 text-xs text-slate-600">{doc.description}</p>}
                  {doc.status === "FAILED" && doc.error && (
                    <p className="mt-1 text-xs text-red-600" role="alert">
                      {doc.error}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <Switch
                        checked={doc.is_approved}
                        label={doc.is_approved ? `Withdraw approval for ${doc.title}` : `Approve ${doc.title} for search`}
                        disabled={approve.isPending && approve.variables?.id === doc.id}
                        onChange={(value) => approve.mutate({ id: doc.id, is_approved: value })}
                      />
                      {doc.is_approved ? "Approved" : "Not approved"}
                    </label>
                    <span title={ready ? undefined : notReadyReason(status) ?? undefined}>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                        loading={indexing}
                        disabled={!ready || (index.isPending && !indexing)}
                        onClick={() => index.mutate(doc.id)}
                      >
                        {doc.status === "PROCESSED" ? "Re-index" : "Index"}
                      </Button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(query.data?.count ?? 0) > docs.length && (
        <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
          Showing {docs.length} of {query.data?.count} documents.
        </p>
      )}
      {canManage && <UploadModal open={uploading} onClose={() => setUploading(false)} />}
    </Card>
  );
}

// ---------------------------------------------------------------- page

export default function AssistantPage() {
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status, staleTime: 5 * 60_000 });
  const { can } = useAuth();
  const canManage = can("manage_templates");

  if (status.isLoading) return <LoadingState />;
  if (status.error || !status.data) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data;

  return (
    <>
      <PageHeader
        title="AI Assistant"
        description="Search approved policies and procedures in plain language. AI output is advisory: it never sets finding severity or compliance results."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "AI Assistant" }]}
        meta={
          s.enabled ? (
            <>
              <Badge tone={isReady(s) ? "green" : "amber"}>{isReady(s) ? "Ready" : "Partially configured"}</Badge>
              {s.model && <Badge tone="gray">Model: {s.model}</Badge>}
            </>
          ) : (
            <Badge>Disabled</Badge>
          )
        }
      />

      {!s.enabled ? (
        <div className="space-y-6">
          <div className="card">
            <EmptyState
              icon={<Bot className="h-6 w-6" />}
              title="The AI assistant is not enabled"
              description={
                <>
                  The assistant is an optional module for searching approved policies and drafting summaries. AuditSphere
                  works fully without it.
                </>
              }
            />
            <div className="mx-auto max-w-2xl px-5 pb-8 text-sm text-slate-600">
              <p className="mb-2 font-medium text-slate-800">To enable it, a system administrator sets on the server:</p>
              <ul className="space-y-1.5">
                <li>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">AI_ENABLED=true</code> and{" "}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">ANTHROPIC_API_KEY</code> (optionally{" "}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">AI_MODEL</code>) for answers and drafts;
                </li>
                <li>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">EMBEDDING_API_URL</code>,{" "}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">EMBEDDING_API_KEY</code>,{" "}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">EMBEDDING_MODEL</code> for document
                  embeddings;
                </li>
                <li>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">QDRANT_URL</code> (and{" "}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">QDRANT_API_KEY</code> if required) for
                  the vector store used by policy search.
                </li>
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Even when enabled, AI output is advisory and is never used to set finding severity or compliance.
              </p>
            </div>
          </div>
          {canManage && <DocumentsCard status={s} />}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <AskPanel status={s} />
          </div>
          <div className="space-y-4 xl:col-span-2">
            <DocumentsCard status={s} />
            <Notice>
              Only documents that are <strong>approved</strong> and <strong>indexed</strong> are searched. Withdraw
              approval to remove a document from answers immediately.
            </Notice>
          </div>
        </div>
      )}
    </>
  );
}
