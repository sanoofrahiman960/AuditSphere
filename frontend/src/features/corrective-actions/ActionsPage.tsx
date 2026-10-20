import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlarmClock, CheckCircle2, FilterX, ListTodo, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { actionsApi, type ListParams } from "@/api/endpoints";
import { ActionStatusBadge, Badge, OverdueBadge, PriorityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, Select } from "@/components/ui/Form";
import { ProgressBar, Tabs } from "@/components/ui/Misc";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDebounce, useListParams, PAGE_SIZE } from "@/hooks/useListParams";
import { useDepartmentOptions } from "@/hooks/useLookups";
import type { CorrectiveAction } from "@/types/api";
import {
  ACTION_STATUS_LABELS,
  ACTION_TYPE_LABELS,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  formatDate,
  options,
} from "@/utils/format";

const FILTERS = [
  "mine",
  "overdue",
  "open",
  "status",
  "priority",
  "severity",
  "department",
  "action_type",
  "due_from",
  "due_to",
];

type QuickView = "all" | "mine" | "overdue" | "verification";

const ACTION_TYPE_OPTIONS = options(ACTION_TYPE_LABELS);

/** Total for a filtered list, read from the paginated `count` with a one-row page. */
function useActionCount(key: string, params: ListParams) {
  return useQuery({
    queryKey: ["actions", "count", key],
    queryFn: () => actionsApi.list({ ...params, page_size: 1 }),
    select: (data) => data.count,
    staleTime: 30_000,
  });
}

export default function ActionsPage() {
  const navigate = useNavigate();
  const list = useListParams(FILTERS, { ordering: "due_date" });
  const setFilters = list.setFilters;
  const [searchInput, setSearchInput] = useState(list.search);
  const debouncedSearch = useDebounce(searchInput);
  const departments = useDepartmentOptions(true);

  useEffect(() => {
    if (debouncedSearch !== list.search) list.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ["actions", list.params],
    queryFn: () => actionsApi.list(list.params),
    placeholderData: (prev) => prev,
  });

  const openCount = useActionCount("open", { open: true });
  const overdueCount = useActionCount("overdue", { overdue: true });
  const pendingCount = useActionCount("pending", { status: "PENDING_VERIFICATION" });
  const closedCount = useActionCount("closed", { status: "CLOSED" });

  const quickView: QuickView = list.filters.mine
    ? "mine"
    : list.filters.overdue
      ? "overdue"
      : list.filters.status === "PENDING_VERIFICATION"
        ? "verification"
        : "all";

  const setQuickView = (view: QuickView) =>
    setFilters({
      mine: view === "mine" ? "true" : undefined,
      overdue: view === "overdue" ? "true" : undefined,
      open: undefined,
      status:
        view === "verification"
          ? "PENDING_VERIFICATION"
          : list.filters.status === "PENDING_VERIFICATION"
            ? undefined
            : list.filters.status,
    });

  /** Jump from a stat card to the matching filtered list (other filters cleared). */
  const showOnly = (changes: Record<string, string>) =>
    setFilters(Object.fromEntries(FILTERS.map((key) => [key, changes[key]])));

  const columns: Column<CorrectiveAction>[] = [
    {
      key: "reference",
      header: "Reference",
      sortKey: "reference",
      render: (a) => (
        <Link to={`/actions/${a.id}`} className="link whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {a.reference}
        </Link>
      ),
    },
    {
      key: "title",
      header: "Action",
      render: (a) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-slate-800">{a.title}</p>
          <p className="text-xs text-slate-500">
            <Link to={`/findings/${a.finding.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              {a.finding.reference}
            </Link>{" "}
            · {SEVERITY_LABELS[a.finding.severity]} · {a.department.name}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (a) => (
        <Badge tone={a.action_type === "CORRECTIVE" ? "blue" : "teal"}>
          {a.action_type === "CORRECTIVE" ? "Corrective" : "Preventive"}
        </Badge>
      ),
    },
    { key: "owner", header: "Owner", render: (a) => <span className="whitespace-nowrap">{a.owner.full_name}</span> },
    { key: "priority", header: "Priority", sortKey: "priority", render: (a) => <PriorityBadge priority={a.priority} /> },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      render: (a) => (
        <div className="flex flex-wrap gap-1">
          <ActionStatusBadge status={a.status} />
          {a.is_overdue && <OverdueBadge />}
        </div>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      sortKey: "progress",
      render: (a) => (
        <div className="flex min-w-[110px] items-center gap-2">
          <ProgressBar value={a.progress} tone={a.status === "CLOSED" ? "green" : "brand"} />
          <span className="w-9 text-right text-xs tabular-nums text-slate-500">{a.progress}%</span>
        </div>
      ),
    },
    {
      key: "due",
      header: "Due date",
      sortKey: "due_date",
      render: (a) => (
        <span className={clsx("whitespace-nowrap", a.is_overdue && "font-medium text-red-600")}>
          {formatDate(a.due_date)}
        </span>
      ),
    },
    {
      key: "verification",
      header: "Verification",
      render: (a) =>
        a.verification_result === "EFFECTIVE" ? (
          <Badge tone="green">Effective</Badge>
        ) : a.verification_result === "NOT_EFFECTIVE" ? (
          <Badge tone="red">Not effective</Badge>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: "created", header: "Created", sortKey: "created_at", render: (a) => formatDate(a.created_at) },
  ];

  const anyFilter = Object.keys(list.filters).length > 0 || !!list.search;

  const countValue = (q: { data?: number; isLoading: boolean; isError: boolean }) =>
    q.isLoading ? "…" : q.isError ? "—" : (q.data ?? 0);

  return (
    <>
      <PageHeader
        title="Corrective Actions"
        description="Track remediation of audit findings from assignment through independent verification."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Corrective actions" }]}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Open"
          value={countValue(openCount)}
          hint="Not yet closed"
          icon={<ListTodo className="h-5 w-5" />}
          onClick={() => showOnly({ open: "true" })}
        />
        <StatCard
          label="Overdue"
          value={countValue(overdueCount)}
          hint="Past due date"
          tone={overdueCount.data ? "danger" : "default"}
          icon={<AlarmClock className="h-5 w-5" />}
          onClick={() => showOnly({ overdue: "true" })}
        />
        <StatCard
          label="Pending verification"
          value={countValue(pendingCount)}
          hint="Awaiting reviewer"
          tone={pendingCount.data ? "warning" : "default"}
          icon={<ShieldCheck className="h-5 w-5" />}
          onClick={() => showOnly({ status: "PENDING_VERIFICATION" })}
        />
        <StatCard
          label="Closed"
          value={countValue(closedCount)}
          hint="Verified effective"
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
          onClick={() => showOnly({ status: "CLOSED" })}
        />
      </div>

      <Tabs<QuickView>
        tabs={[
          { id: "all", label: "All" },
          { id: "mine", label: "Assigned to me" },
          { id: "overdue", label: "Overdue" },
          { id: "verification", label: "Awaiting verification" },
        ]}
        active={quickView}
        onChange={setQuickView}
      />

      <FilterPanel activeCount={Object.keys(list.filters).length + (list.search ? 1 : 0)}>
        <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="action-search">
              Search
            </label>
            <input
              id="action-search"
              type="search"
              className="input"
              placeholder="Reference, title, finding, owner…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select
            label="Status"
            placeholder="All statuses"
            options={options(ACTION_STATUS_LABELS)}
            value={list.filters.status ?? ""}
            onChange={(e) => list.setFilter("status", e.target.value)}
          />
          <Select
            label="Priority"
            placeholder="All priorities"
            options={options(PRIORITY_LABELS)}
            value={list.filters.priority ?? ""}
            onChange={(e) => list.setFilter("priority", e.target.value)}
          />
          <Select
            label="Finding severity"
            placeholder="All severities"
            options={options(SEVERITY_LABELS)}
            value={list.filters.severity ?? ""}
            onChange={(e) => list.setFilter("severity", e.target.value)}
          />
          <Select
            label="Department"
            placeholder="All departments"
            options={departments.data ?? []}
            value={list.filters.department ?? ""}
            onChange={(e) => list.setFilter("department", e.target.value)}
          />
          <Select
            label="Type"
            placeholder="All types"
            options={ACTION_TYPE_OPTIONS}
            value={list.filters.action_type ?? ""}
            onChange={(e) => list.setFilter("action_type", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Due from"
              type="date"
              value={list.filters.due_from ?? ""}
              max={list.filters.due_to || undefined}
              onChange={(e) => list.setFilter("due_from", e.target.value)}
            />
            <Input
              label="Due to"
              type="date"
              value={list.filters.due_to ?? ""}
              min={list.filters.due_from || undefined}
              onChange={(e) => list.setFilter("due_to", e.target.value)}
            />
          </div>
          {anyFilter && (
            <div className="flex items-end sm:col-span-2 lg:col-span-4">
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
      </FilterPanel>

      <DataTable
        columns={columns}
        rows={query.data?.results}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        onRowClick={(a) => navigate(`/actions/${a.id}`)}
        emptyTitle={anyFilter ? "No actions match this view" : "No corrective actions yet"}
        emptyDescription={
          anyFilter
            ? "Try another tab or clear some filters."
            : "Actions are assigned from a finding's detail page by a department manager or administrator."
        }
        pagination={{ page: list.page, pageSize: PAGE_SIZE, count: query.data?.count ?? 0, onPageChange: list.setPage }}
      />
    </>
  );
}
