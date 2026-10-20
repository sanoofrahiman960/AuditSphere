import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { departmentsApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDebounce, useListParams, PAGE_SIZE } from "@/hooks/useListParams";
import { useAuth } from "@/features/auth/AuthContext";
import type { Department } from "@/types/api";
import { DepartmentFormModal, DepartmentStatusDialog } from "./DepartmentFormModal";

type StatusFilter = "active" | "inactive" | "all";

export default function DepartmentsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can("manage_departments");
  const list = useListParams(["status"], { ordering: "name" });
  const [searchInput, setSearchInput] = useState(list.search);
  const debouncedSearch = useDebounce(searchInput);
  const [editing, setEditing] = useState<Department | null>(null);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<Department | null>(null);

  useEffect(() => {
    if (debouncedSearch !== list.search) list.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const status = (list.filters.status as StatusFilter | undefined) ?? "active";
  const params = useMemo(
    () => ({
      page: list.page,
      page_size: PAGE_SIZE,
      search: list.search || undefined,
      ordering: list.ordering || undefined,
      is_active: status === "all" ? undefined : status === "active",
    }),
    [list.page, list.search, list.ordering, status],
  );

  const query = useQuery({
    queryKey: ["departments", params],
    queryFn: () => departmentsApi.list(params),
    placeholderData: (prev) => prev,
  });

  const columns: Column<Department>[] = [
    {
      key: "name",
      header: "Department",
      sortKey: "name",
      render: (d) => (
        <div className="min-w-[180px]">
          <Link to={`/departments/${d.id}`} className="link" onClick={(e) => e.stopPropagation()}>
            {d.name}
          </Link>
          {d.code && <p className="text-xs text-slate-500">{d.code}</p>}
        </div>
      ),
    },
    {
      key: "manager",
      header: "Manager",
      render: (d) => d.manager_detail?.full_name ?? <span className="text-slate-400">Not assigned</span>,
    },
    { key: "members", header: "Members", className: "tabular-nums", render: (d) => d.member_count },
    { key: "audits", header: "Audits", className: "tabular-nums", render: (d) => d.audit_count },
    {
      key: "findings",
      header: "Open findings",
      className: "tabular-nums",
      render: (d) => <span className={d.open_findings > 0 ? "font-semibold text-red-600" : undefined}>{d.open_findings}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (d) => (d.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>),
    },
  ];

  if (canManage) {
    columns.push({
      key: "row-actions",
      header: <span className="sr-only">Actions</span>,
      headerClassName: "w-px",
      render: (d) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(d)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={d.is_active ? "text-red-600 hover:text-red-700" : "text-green-700 hover:text-green-800"}
            icon={d.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            onClick={() => setToggling(d)}
          >
            {d.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    });
  }

  const hasFilters = !!list.search || status !== "active";

  const emptyTitle = hasFilters
    ? "No departments match these filters"
    : canManage
      ? "No departments yet"
      : "You are not a member of any department";
  const emptyDescription = hasFilters
    ? "Try a different search or status."
    : canManage
      ? "Create departments to organise audits, templates and responsibilities."
      : "You only see the departments you belong to or manage. Ask an audit administrator to add you to a department.";

  return (
    <>
      <PageHeader
        title="Departments"
        description={
          canManage
            ? "Organisational units that are audited. Deactivating keeps all history."
            : "The departments you belong to or manage."
        }
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Departments" }]}
        actions={
          canManage ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New department
            </Button>
          ) : undefined
        }
      />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="department-search">
            Search
          </label>
          <input
            id="department-search"
            type="search"
            className="input"
            placeholder="Name, code or description…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          label="Status"
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "all", label: "All" },
          ]}
          value={status}
          onChange={(e) => list.setFilter("status", e.target.value === "active" ? undefined : e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.results}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        onRowClick={(d) => navigate(`/departments/${d.id}`)}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        emptyAction={
          !hasFilters && canManage ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New department
            </Button>
          ) : undefined
        }
        pagination={{ page: list.page, pageSize: PAGE_SIZE, count: query.data?.count ?? 0, onPageChange: list.setPage }}
      />

      {canManage && (
        <>
          <DepartmentFormModal
            open={creating || !!editing}
            department={editing}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSaved={(d) => {
              if (creating) navigate(`/departments/${d.id}`);
            }}
          />
          <DepartmentStatusDialog department={toggling} onClose={() => setToggling(null)} />
        </>
      )}
    </>
  );
}
