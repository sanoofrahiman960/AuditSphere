import { useQuery } from "@tanstack/react-query";
import { FilterX } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { findingsApi } from "@/api/endpoints";
import { FindingStatusBadge, OverdueBadge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDebounce, useListParams, PAGE_SIZE } from "@/hooks/useListParams";
import { useDepartmentOptions } from "@/hooks/useLookups";
import type { Finding } from "@/types/api";
import { FINDING_STATUS_LABELS, SEVERITY_LABELS, formatDate, options } from "@/utils/format";

const FILTERS = ["severity", "status", "department", "open", "overdue", "owner"];

export default function FindingsPage() {
  const navigate = useNavigate();
  const list = useListParams(FILTERS, { ordering: "-created_at" });
  const [searchInput, setSearchInput] = useState(list.search);
  const debouncedSearch = useDebounce(searchInput);
  const departments = useDepartmentOptions(true);

  useEffect(() => {
    if (debouncedSearch !== list.search) list.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ["findings", list.params],
    queryFn: () => findingsApi.list(list.params),
    placeholderData: (prev) => prev,
  });

  const columns: Column<Finding>[] = [
    {
      key: "reference",
      header: "Reference",
      sortKey: "reference",
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
        <div className="min-w-[220px]">
          <p className="font-medium text-slate-800">{f.title}</p>
          <p className="text-xs text-slate-500">
            {f.audit.reference} · {f.department.name}
            {f.question?.code ? ` · ${f.question.code}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      sortKey: "risk_score",
      render: (f) => (
        <div className="flex items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <span className="text-xs tabular-nums text-slate-500" title="Likelihood × impact">
            {f.risk_score}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
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
    { key: "target", header: "Target date", sortKey: "target_date", render: (f) => formatDate(f.target_date) },
    { key: "created", header: "Raised", sortKey: "created_at", render: (f) => formatDate(f.created_at) },
  ];

  const hasFilters = Object.keys(list.filters).length > 0 || !!list.search;

  return (
    <>
      <PageHeader
        title="Findings & Risks"
        description="Audit findings with likelihood × impact risk scoring. Raise new findings from an audit workspace."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Findings" }]}
      />

      <FilterPanel activeCount={Object.keys(list.filters).length + (list.search ? 1 : 0)}>
        <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="label" htmlFor="finding-search">
              Search
            </label>
            <input
              id="finding-search"
              type="search"
              className="input"
              placeholder="Reference, title, audit…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select
            label="Severity"
            placeholder="All severities"
            options={options(SEVERITY_LABELS)}
            value={list.filters.severity ?? ""}
            onChange={(e) => list.setFilter("severity", e.target.value)}
          />
          <Select
            label="Status"
            placeholder="All statuses"
            options={options(FINDING_STATUS_LABELS)}
            value={list.filters.status ?? ""}
            onChange={(e) => list.setFilter("status", e.target.value)}
          />
          <Select
            label="Department"
            placeholder="All departments"
            options={departments.data ?? []}
            value={list.filters.department ?? ""}
            onChange={(e) => list.setFilter("department", e.target.value)}
          />
          <Select
            label="Show"
            placeholder="All findings"
            options={[
              { value: "open", label: "Open only" },
              { value: "overdue", label: "Past target date" },
            ]}
            value={list.filters.overdue ? "overdue" : list.filters.open ? "open" : ""}
            onChange={(e) =>
              list.setFilters({
                open: e.target.value === "open" ? "true" : undefined,
                overdue: e.target.value === "overdue" ? "true" : undefined,
              })
            }
          />
          {hasFilters && (
            <div className="flex items-end lg:col-span-6">
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
        onRowClick={(f) => navigate(`/findings/${f.id}`)}
        emptyTitle={hasFilters ? "No findings match these filters" : "No findings yet"}
        emptyDescription={hasFilters ? "Try clearing some filters." : "Findings recorded during audits will appear here."}
        pagination={{ page: list.page, pageSize: PAGE_SIZE, count: query.data?.count ?? 0, onPageChange: list.setPage }}
      />
    </>
  );
}
