import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, GitBranchPlus, Info, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toApiError } from "@/api/client";
import { templatesApi } from "@/api/endpoints";
import { Badge, VersionStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, DetailList } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input } from "@/components/ui/Form";
import { Modal, ReasonDialog } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import type { VersionSummary } from "@/types/api";
import { formatDate, formatDateTime } from "@/utils/format";
import { TemplateFormModal } from "./TemplatesPage";

const SCORING_LABELS = { SIMPLE: "Simple", WEIGHTED: "Weighted" } as const;

function DuplicateModal({
  open,
  onClose,
  sourceName,
  loading,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  sourceName: string;
  loading: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(`${sourceName} (copy)`);
  }, [open, sourceName]);
  const valid = name.trim().length > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicate template"
      description="Creates a new template whose first draft version copies the latest version's checklist."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(name.trim())} loading={loading} disabled={!valid}>
            Duplicate
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(name.trim());
        }}
        noValidate
      >
        <Input
          label="Name for the new template"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error ?? undefined}
        />
      </form>
    </Modal>
  );
}

export default function TemplateDetailPage() {
  const { id } = useParams();
  const templateId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can("manage_templates");

  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [creatingVersion, setCreatingVersion] = useState(false);

  const template = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => templatesApi.get(templateId),
    enabled: Number.isFinite(templateId),
  });
  const versions = useQuery({
    queryKey: ["template-versions", templateId],
    queryFn: () => templatesApi.versions(templateId),
    enabled: Number.isFinite(templateId),
  });

  const duplicate = useMutation({
    mutationFn: (name: string) => templatesApi.duplicate(templateId, name),
    onSuccess: (copy) => {
      toast.success(`Template duplicated as "${copy.name}"`);
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      queryClient.invalidateQueries({ queryKey: ["lookup"] });
      setDuplicating(false);
      navigate(`/templates/${copy.id}`);
    },
    onError: (e) => {
      const err = toApiError(e);
      setDuplicateError(err.fieldErrors.name?.[0] ?? err.message);
    },
  });

  const newVersion = useMutation({
    mutationFn: (change_notes: string) => templatesApi.newVersion(templateId, { change_notes }),
    onSuccess: (version) => {
      toast.success(`Draft version ${version.version} created`);
      queryClient.invalidateQueries({ queryKey: ["template-versions", templateId] });
      queryClient.invalidateQueries({ queryKey: ["template", templateId] });
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      queryClient.invalidateQueries({ queryKey: ["lookup"] });
      queryClient.setQueryData(["template-version", version.id], version);
      setCreatingVersion(false);
      navigate(`/templates/${templateId}/versions/${version.id}`);
    },
    onError: (e) => toast.error(e),
  });

  if (template.isLoading) return <LoadingState />;
  if (template.error || !template.data) return <ErrorState error={template.error} onRetry={() => template.refetch()} />;

  const t = template.data;
  const draft = versions.data?.find((v) => v.status === "DRAFT") ?? null;
  const current = versions.data?.find((v) => v.status === "APPROVED") ?? null;

  const columns: Column<VersionSummary>[] = [
    {
      key: "version",
      header: "Version",
      render: (v) => (
        <Link
          to={`/templates/${templateId}/versions/${v.id}`}
          className="link whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          v{v.version}
        </Link>
      ),
    },
    { key: "status", header: "Status", render: (v) => <VersionStatusBadge status={v.status} /> },
    {
      key: "standard",
      header: "Standard",
      render: (v) => v.applicable_standard || <span className="text-slate-400">—</span>,
    },
    { key: "scoring", header: "Scoring", render: (v) => SCORING_LABELS[v.scoring_method] },
    { key: "questions", header: "Questions", render: (v) => <span className="tabular-nums">{v.question_count}</span> },
    {
      key: "audits",
      header: "Used by",
      render: (v) => (
        <span className="whitespace-nowrap tabular-nums">
          {v.audit_count} audit{v.audit_count === 1 ? "" : "s"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (v) => (
        <div className="whitespace-nowrap">
          <p>{formatDate(v.created_at)}</p>
          <p className="text-xs text-slate-500">{v.created_by?.full_name ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "approved",
      header: "Approved",
      render: (v) =>
        v.approved_at ? (
          <div className="whitespace-nowrap">
            <p>{formatDate(v.approved_at)}</p>
            <p className="text-xs text-slate-500">{v.approved_by?.full_name ?? "—"}</p>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "notes",
      header: "Change notes",
      render: (v) => (
        <p className="line-clamp-2 min-w-[180px] max-w-xs text-xs text-slate-600">{v.change_notes || "—"}</p>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t.name}
        description={t.description || undefined}
        breadcrumbs={[{ label: "Templates", to: "/templates" }, { label: t.name }]}
        meta={
          <>
            {t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
            <Badge tone="blue">{t.department_name ?? "All departments"}</Badge>
            {t.category_name && <Badge tone="indigo">{t.category_name}</Badge>}
          </>
        }
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit details
              </Button>
              <Button
                variant="secondary"
                icon={<Copy className="h-4 w-4" />}
                onClick={() => {
                  setDuplicateError(null);
                  setDuplicating(true);
                }}
              >
                Duplicate
              </Button>
              <span title={draft ? `Draft v${draft.version} already exists — edit or approve it first.` : undefined}>
                <Button
                  icon={<GitBranchPlus className="h-4 w-4" />}
                  disabled={!!draft || versions.isLoading}
                  onClick={() => setCreatingVersion(true)}
                >
                  New version
                </Button>
              </span>
            </>
          )
        }
      />

      <div className="space-y-6">
        {canManage && draft && (
          <Notice tone="warning">
            Draft <strong>v{draft.version}</strong> is in progress, so a new version cannot be started until it is approved.{" "}
            <Link to={`/templates/${templateId}/versions/${draft.id}`} className="font-medium underline">
              Continue editing the draft
            </Link>
          </Notice>
        )}

        <Card title="Overview">
          <DetailList
            columns={3}
            items={[
              {
                label: "Current approved version",
                value: current ? (
                  <Link to={`/templates/${templateId}/versions/${current.id}`} className="link">
                    v{current.version}
                    {current.applicable_standard ? ` · ${current.applicable_standard}` : ""}
                  </Link>
                ) : (
                  <span className="text-slate-500">None yet — approve a version to use this template in audits</span>
                ),
              },
              { label: "Versions", value: t.version_count },
              { label: "Department", value: t.department_name ?? "All departments" },
              { label: "Category", value: t.category_name ?? "—" },
              { label: "Created", value: formatDateTime(t.created_at) },
              { label: "Last updated", value: formatDateTime(t.updated_at) },
            ]}
          />
        </Card>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Versions</h2>
              <p className="mt-0.5 flex items-start gap-1.5 text-sm text-slate-500">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Audits keep the exact version they were created with. Approving a new version archives the previous
                one for new audits but never changes existing audits.
              </p>
            </div>
          </div>
          <DataTable
            columns={columns}
            rows={versions.data}
            loading={versions.isLoading}
            error={versions.error}
            onRetry={() => versions.refetch()}
            onRowClick={(v) => navigate(`/templates/${templateId}/versions/${v.id}`)}
            emptyTitle="No versions"
            emptyDescription="This template has no versions yet."
          />
        </section>
      </div>

      {canManage && (
        <>
          <TemplateFormModal open={editing} onClose={() => setEditing(false)} template={t} />
          <DuplicateModal
            open={duplicating}
            onClose={() => setDuplicating(false)}
            sourceName={t.name}
            loading={duplicate.isPending}
            error={duplicateError}
            onSubmit={(name) => {
              setDuplicateError(null);
              duplicate.mutate(name);
            }}
          />
          <ReasonDialog
            open={creatingVersion}
            onClose={() => setCreatingVersion(false)}
            onSubmit={(notes) => newVersion.mutate(notes)}
            title="Start a new version"
            message={`The new draft copies the checklist of the latest version (v${t.latest_version?.version ?? "—"}). Existing audits are not affected.`}
            label="Change notes (optional)"
            required={false}
            confirmLabel="Create draft"
            loading={newVersion.isPending}
          />
        </>
      )}
    </>
  );
}
