import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilterX, FolderCog, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { categoriesApi, templatesApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { applyServerErrors, Checkbox, Input, Select, Textarea } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { PAGE_SIZE, useDebounce, useListParams } from "@/hooks/useListParams";
import { useCategoryOptions, useDepartmentOptions } from "@/hooks/useLookups";
import type { AuditCategory, AuditTemplate } from "@/types/api";
import { formatDate } from "@/utils/format";

const FILTERS = ["department", "category", "is_active"];

// ---------------------------------------------------------------- template create / edit modal

const templateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(200),
  description: z.string().optional(),
  department: z.string().optional(),
  category: z.string().optional(),
  applicable_standard: z.string().max(255, "Keep the standard under 255 characters").optional(),
  scoring_method: z.enum(["SIMPLE", "WEIGHTED"]),
  is_active: z.boolean(),
});
type TemplateFormValues = z.infer<typeof templateSchema>;
const TEMPLATE_FIELDS = Object.keys(templateSchema.shape);

const SCORING_OPTIONS = [
  { value: "SIMPLE", label: "Simple — every scored question counts equally" },
  { value: "WEIGHTED", label: "Weighted — questions carry individual weights" },
];

/**
 * Create a template (with an empty first draft version) or edit an existing template's details.
 * Version content (standard, scoring, checklist) is edited on the version page.
 */
export function TemplateFormModal({
  open,
  onClose,
  template,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  template?: AuditTemplate;
  onSaved?: (template: AuditTemplate) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const departments = useDepartmentOptions();
  const categories = useCategoryOptions();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = !!template;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<TemplateFormValues>({ resolver: zodResolver(templateSchema) });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset({
      name: template?.name ?? "",
      description: template?.description ?? "",
      department: template?.department ? String(template.department) : "",
      category: template?.category ? String(template.category) : "",
      applicable_standard: "",
      scoring_method: "SIMPLE",
      is_active: template?.is_active ?? true,
    });
  }, [open, template, reset]);

  // Keep the current (possibly inactive) department/category selectable when editing.
  const departmentOptions = useMemo(() => {
    const opts = departments.data ?? [];
    if (template?.department && !opts.some((o) => o.value === template.department)) {
      return [...opts, { value: template.department, label: `${template.department_name ?? "Current"} (inactive)` }];
    }
    return opts;
  }, [departments.data, template]);
  const categoryOptions = useMemo(() => {
    const opts = categories.data ?? [];
    if (template?.category && !opts.some((o) => o.value === template.category)) {
      return [...opts, { value: template.category, label: `${template.category_name ?? "Current"} (inactive)` }];
    }
    return opts;
  }, [categories.data, template]);

  const mutation = useMutation({
    mutationFn: (values: TemplateFormValues) => {
      const base = {
        name: values.name.trim(),
        description: values.description?.trim() ?? "",
        department: values.department ? Number(values.department) : null,
        category: values.category ? Number(values.category) : null,
      };
      return editing
        ? templatesApi.update(template!.id, { ...base, is_active: values.is_active })
        : templatesApi.create({
            ...base,
            applicable_standard: values.applicable_standard?.trim() ?? "",
            scoring_method: values.scoring_method,
            sections: [],
          });
    },
    onSuccess: (saved) => {
      toast.success(editing ? "Template details updated" : `Template "${saved.name}" created`);
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      queryClient.invalidateQueries({ queryKey: ["template", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["lookup"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => {
      const err = toApiError(e);
      setFormError(
        applyServerErrors(err.fieldErrors, setError as never, TEMPLATE_FIELDS) ??
          (Object.keys(err.fieldErrors).length ? null : err.message),
      );
    },
  });

  const submit = handleSubmit((v) => mutation.mutate(v));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? "Edit template details" : "New audit template"}
      description={
        editing
          ? "These details apply to every version of the template."
          : "The template starts with an empty draft version. You will build its checklist next."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {editing ? "Save details" : "Create and build checklist"}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <InlineError message={formError} />
        <Input label="Name" required error={errors.name?.message} {...register("name")} />
        <Textarea label="Description" rows={3} error={errors.description?.message} {...register("description")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Department"
            placeholder="All departments"
            hint="Leave empty to make the template available to every department."
            options={departmentOptions}
            error={errors.department?.message}
            {...register("department")}
          />
          <Select
            label="Category"
            placeholder="Uncategorised"
            options={categoryOptions}
            error={errors.category?.message}
            {...register("category")}
          />
        </div>
        {!editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Applicable standard"
              placeholder="e.g. ISO 27001:2022, SOX, internal policy"
              error={errors.applicable_standard?.message}
              {...register("applicable_standard")}
            />
            <Select
              label="Scoring method"
              options={SCORING_OPTIONS}
              error={errors.scoring_method?.message}
              {...register("scoring_method")}
            />
          </div>
        )}
        {editing && (
          <Checkbox
            label="Active"
            description="Inactive templates stay attached to existing audits but cannot be chosen for new audits."
            {...register("is_active")}
          />
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- categories management

function CategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.list({ page_size: 500 }),
    enabled: open,
  });
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string; description: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<AuditCategory | null>(null);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setNewDescription("");
      setCreateError(null);
      setEditing(null);
      setEditError(null);
    }
  }, [open]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["lookup"] });
    queryClient.invalidateQueries({ queryKey: ["templates"] });
  };

  const firstError = (e: unknown) => {
    const err = toApiError(e);
    return err.fieldErrors.name?.[0] ?? err.fieldErrors.description?.[0] ?? err.message;
  };

  const create = useMutation({
    mutationFn: () => categoriesApi.create({ name: newName.trim(), description: newDescription.trim() }),
    onSuccess: (c) => {
      toast.success(`Category "${c.name}" added`);
      setNewName("");
      setNewDescription("");
      setCreateError(null);
      refresh();
    },
    onError: (e) => setCreateError(firstError(e)),
  });

  const update = useMutation({
    mutationFn: (vars: { id: number; data: Partial<AuditCategory> }) => categoriesApi.update(vars.id, vars.data),
    onSuccess: (c) => {
      toast.success(`Category "${c.name}" updated`);
      setEditing(null);
      setEditError(null);
      refresh();
    },
    onError: (e) => {
      if (editing) setEditError(firstError(e));
      else toast.error(e);
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: number) => categoriesApi.deactivate(id),
    onSuccess: () => {
      toast.success("Category deactivated");
      setDeactivating(null);
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const categories = query.data?.results ?? [];

  return (
    <>
      <Modal
        open={open && !deactivating}
        onClose={onClose}
        size="lg"
        title="Audit categories"
        description="Categories group templates for filtering and reporting. Deactivated categories remain on existing templates."
        footer={
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <form
          className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) {
              setCreateError("Enter a category name.");
              return;
            }
            create.mutate();
          }}
          noValidate
        >
          <p className="mb-3 text-sm font-medium text-slate-800">Add a category</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
            <Input label="Name" required value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} />
            <Input label="Description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
            <Button type="submit" loading={create.isPending} icon={<Plus className="h-4 w-4" />}>
              Add
            </Button>
          </div>
          {createError && <p className="mt-2 text-xs text-red-600" role="alert">{createError}</p>}
        </form>

        {query.isLoading ? (
          <LoadingState />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : categories.length === 0 ? (
          <EmptyState title="No categories yet" description="Add your first category above." />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {categories.map((c) =>
              editing?.id === c.id ? (
                <li key={c.id} className="space-y-3 px-3 py-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Name"
                      required
                      value={editing.name}
                      maxLength={120}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                    <Input
                      label="Description"
                      value={editing.description}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    />
                  </div>
                  {editError && <p className="text-xs text-red-600" role="alert">{editError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={update.isPending}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      loading={update.isPending}
                      disabled={!editing.name.trim()}
                      onClick={() =>
                        update.mutate({
                          id: c.id,
                          data: { name: editing.name.trim(), description: editing.description.trim() },
                        })
                      }
                    >
                      Save
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                      {c.name}
                      {!c.is_active && <Badge>Inactive</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {c.description || "No description"} · {c.template_count} template{c.template_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setEditError(null);
                      setEditing({ id: c.id, name: c.name, description: c.description });
                    }}
                  >
                    Rename
                  </Button>
                  {c.is_active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() => setDeactivating(c)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<RotateCcw className="h-3.5 w-3.5" />}
                      loading={update.isPending && update.variables?.id === c.id}
                      onClick={() => update.mutate({ id: c.id, data: { is_active: true } })}
                    >
                      Reactivate
                    </Button>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={() => deactivating && deactivate.mutate(deactivating.id)}
        loading={deactivate.isPending}
        tone="danger"
        title="Deactivate category?"
        confirmLabel="Deactivate"
        message={
          <>
            <strong>{deactivating?.name}</strong> will no longer be offered for new templates. The{" "}
            {deactivating?.template_count ?? 0} template(s) already using it keep their category. You can reactivate it
            later.
          </>
        }
      />
    </>
  );
}

// ---------------------------------------------------------------- page

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can("manage_templates");
  const list = useListParams(FILTERS, { ordering: "name" });
  const [searchInput, setSearchInput] = useState(list.search);
  const debouncedSearch = useDebounce(searchInput);
  const departments = useDepartmentOptions(true);
  const categories = useCategoryOptions();
  const [creating, setCreating] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);

  useEffect(() => {
    if (debouncedSearch !== list.search) list.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ["templates", list.params],
    queryFn: () => templatesApi.list(list.params),
    placeholderData: (prev) => prev,
  });

  const columns: Column<AuditTemplate>[] = [
    {
      key: "name",
      header: "Template",
      sortKey: "name",
      render: (t) => (
        <div className="min-w-[240px] max-w-md">
          <Link to={`/templates/${t.id}`} className="link" onClick={(e) => e.stopPropagation()}>
            {t.name}
          </Link>
          {t.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{t.description}</p>}
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (t) => t.department_name ?? <span className="text-slate-500">All departments</span>,
    },
    { key: "category", header: "Category", render: (t) => t.category_name ?? <span className="text-slate-400">—</span> },
    {
      key: "version",
      header: "Current version",
      render: (t) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.current_version ? (
            <Badge tone="green">v{t.current_version.version} approved</Badge>
          ) : (
            <span className="text-xs text-slate-500">No approved version</span>
          )}
          {t.latest_version?.status === "DRAFT" && <Badge tone="amber">Draft v{t.latest_version.version}</Badge>}
        </div>
      ),
    },
    { key: "versions", header: "Versions", render: (t) => <span className="tabular-nums">{t.version_count}</span> },
    {
      key: "active",
      header: "Status",
      render: (t) => (t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>),
    },
    { key: "updated", header: "Updated", sortKey: "updated_at", render: (t) => formatDate(t.updated_at) },
  ];

  const hasFilters = Object.keys(list.filters).length > 0 || !!list.search;

  return (
    <>
      <PageHeader
        title="Audit Templates"
        description="Reusable, versioned checklists. Audits are always created from an approved template version."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Templates" }]}
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={<FolderCog className="h-4 w-4" />} onClick={() => setManagingCategories(true)}>
                Categories
              </Button>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New template
              </Button>
            </>
          )
        }
      />

      {!canManage && (
        <div className="mb-4">
          <Notice>You can browse templates and their versions. Only audit administrators can create or change them.</Notice>
        </div>
      )}

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="template-search">
            Search
          </label>
          <input
            id="template-search"
            type="search"
            className="input"
            placeholder="Name or description…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          label="Department"
          placeholder="Any department"
          options={departments.data ?? []}
          value={list.filters.department ?? ""}
          onChange={(e) => list.setFilter("department", e.target.value)}
        />
        <Select
          label="Category"
          placeholder="Any category"
          options={categories.data ?? []}
          value={list.filters.category ?? ""}
          onChange={(e) => list.setFilter("category", e.target.value)}
        />
        <Select
          label="Status"
          placeholder="Active and inactive"
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "Inactive" },
          ]}
          value={list.filters.is_active ?? ""}
          onChange={(e) => list.setFilter("is_active", e.target.value)}
        />
        {hasFilters && (
          <div className="flex items-end lg:col-span-5">
            <Button
              variant="ghost"
              size="sm"
              icon={<FilterX className="h-4 w-4" />}
              onClick={() => {
                setSearchInput("");
                list.clearFilters();
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.results}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        onRowClick={(t) => navigate(`/templates/${t.id}`)}
        emptyTitle={hasFilters ? "No templates match these filters" : "No templates yet"}
        emptyDescription={
          hasFilters
            ? "Try clearing some filters."
            : canManage
              ? "Create a template to define the checklist auditors will follow."
              : "Templates created by audit administrators will appear here."
        }
        emptyAction={
          !hasFilters &&
          canManage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New template
            </Button>
          )
        }
        pagination={{ page: list.page, pageSize: PAGE_SIZE, count: query.data?.count ?? 0, onPageChange: list.setPage }}
      />

      {canManage && (
        <>
          <TemplateFormModal
            open={creating}
            onClose={() => setCreating(false)}
            onSaved={(t) =>
              navigate(t.latest_version ? `/templates/${t.id}/versions/${t.latest_version.id}` : `/templates/${t.id}`)
            }
          />
          <CategoriesModal open={managingCategories} onClose={() => setManagingCategories(false)} />
        </>
      )}
    </>
  );
}
