import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isValid,
  parse,
  parseISO,
  startOfMonth,
  startOfWeek,
  addMonths,
} from "date-fns";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, FilterX, List, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { auditsApi } from "@/api/endpoints";
import { AuditStatusBadge, OverdueBadge, PriorityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Checkbox, Input, Select } from "@/components/ui/Form";
import { ProgressBar } from "@/components/ui/Misc";
import { Modal } from "@/components/ui/Modal";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import { useAuth } from "@/features/auth/AuthContext";
import { PAGE_SIZE, useDebounce, useListParams } from "@/hooks/useListParams";
import { AUDITOR_ROLES, useDepartmentOptions, useUserOptions } from "@/hooks/useLookups";
import type { AuditListItem, AuditStatus, CalendarEvent } from "@/types/api";
import {
  AUDIT_STATUS_COLORS,
  AUDIT_STATUS_LABELS,
  AUDIT_TYPE_LABELS,
  PRIORITY_LABELS,
  formatDate,
  formatPercent,
  isoDate,
  options,
  scoreColor,
} from "@/utils/format";

const FILTERS = ["department", "status", "lead_auditor", "priority", "audit_type", "due_from", "due_to", "overdue", "mine"];

type View = "list" | "calendar";

export default function AuditsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: View = searchParams.get("view") === "calendar" ? "calendar" : "list";
  const list = useListParams(FILTERS);
  const [searchInput, setSearchInput] = useState(list.search);
  const debouncedSearch = useDebounce(searchInput);
  const departments = useDepartmentOptions(true);
  const auditors = useUserOptions(AUDITOR_ROLES);

  useEffect(() => {
    if (debouncedSearch !== list.search) list.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const setView = (next: View) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "calendar") params.set("view", "calendar");
        else {
          params.delete("view");
          params.delete("month");
        }
        params.delete("page");
        return params;
      },
      { replace: true },
    );

  const query = useQuery({
    queryKey: ["audits", list.params],
    queryFn: () => auditsApi.list(list.params),
    placeholderData: (prev) => prev,
    enabled: view === "list",
  });

  const calendarFilters = useMemo(
    () => ({ search: list.search || undefined, ...list.filters }),
    [list.search, list.filters],
  );

  const columns: Column<AuditListItem>[] = [
    {
      key: "reference",
      header: "Reference",
      sortKey: "reference",
      render: (a) => (
        <Link to={`/audits/${a.id}`} className="link whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {a.reference}
        </Link>
      ),
    },
    {
      key: "title",
      header: "Audit",
      render: (a) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-slate-800">{a.title}</p>
          <p className="text-xs text-slate-500">
            {a.department.name} · {a.template.name} v{a.template.version}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      render: (a) => (
        <div className="flex flex-wrap gap-1">
          <AuditStatusBadge status={a.status} />
          {a.is_overdue && <OverdueBadge />}
        </div>
      ),
    },
    { key: "priority", header: "Priority", sortKey: "priority", render: (a) => <PriorityBadge priority={a.priority} /> },
    {
      key: "lead",
      header: "Lead auditor",
      render: (a) => a.lead_auditor?.full_name ?? <span className="text-slate-400">Unassigned</span>,
    },
    {
      key: "reviewer",
      header: "Reviewer",
      render: (a) => a.reviewer?.full_name ?? <span className="text-slate-400">Unassigned</span>,
    },
    {
      key: "planned",
      header: "Planned start",
      sortKey: "planned_start_date",
      className: "whitespace-nowrap",
      render: (a) => formatDate(a.planned_start_date),
    },
    {
      key: "due",
      header: "Due",
      sortKey: "due_date",
      className: "whitespace-nowrap",
      render: (a) => <span className={clsx(a.is_overdue && "font-medium text-red-600")}>{formatDate(a.due_date)}</span>,
    },
    {
      key: "completion",
      header: "Completion",
      render: (a) => (
        <div className="w-24">
          <span className="text-xs tabular-nums text-slate-600">{a.completion_percentage}%</span>
          <ProgressBar value={a.completion_percentage} className="mt-1" tone={a.completion_percentage === 100 ? "green" : "brand"} />
        </div>
      ),
    },
    {
      key: "score",
      header: "Score",
      sortKey: "compliance_score",
      render: (a) => (
        <span className={clsx("font-medium tabular-nums", scoreColor(a.compliance_score === null ? null : Number(a.compliance_score)))}>
          {formatPercent(a.compliance_score)}
        </span>
      ),
    },
  ];

  const hasFilters = Object.keys(list.filters).length > 0 || !!list.search;

  return (
    <>
      <PageHeader
        title="Audits"
        description="Plan, execute and review audits across departments."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Audits" }]}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="View">
              {(
                [
                  { id: "list", label: "List", icon: List },
                  { id: "calendar", label: "Calendar", icon: CalendarDays },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => setView(v.id)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                    view === v.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  <v.icon className="h-4 w-4" aria-hidden />
                  {v.label}
                </button>
              ))}
            </div>
            {can("manage_audits") && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate("/audits/new")}>
                New audit
              </Button>
            )}
          </>
        }
      />

      <FilterPanel activeCount={Object.keys(list.filters).length + (list.search ? 1 : 0)}>
        <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="audit-search">
              Search
            </label>
            <input
              id="audit-search"
              type="search"
              className="input"
              placeholder="Reference, title, department, scope…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select
            label="Department"
            placeholder="All departments"
            options={departments.data ?? []}
            value={list.filters.department ?? ""}
            onChange={(e) => list.setFilter("department", e.target.value)}
          />
          <Select
            label="Status"
            placeholder="All statuses"
            options={options(AUDIT_STATUS_LABELS)}
            value={list.filters.status ?? ""}
            onChange={(e) => list.setFilter("status", e.target.value)}
          />
          <Select
            label="Lead auditor"
            placeholder="Any auditor"
            options={auditors.data ?? []}
            value={list.filters.lead_auditor ?? ""}
            onChange={(e) => list.setFilter("lead_auditor", e.target.value)}
          />
          <Select
            label="Priority"
            placeholder="All priorities"
            options={options(PRIORITY_LABELS)}
            value={list.filters.priority ?? ""}
            onChange={(e) => list.setFilter("priority", e.target.value)}
          />
          <Select
            label="Audit type"
            placeholder="All types"
            options={options(AUDIT_TYPE_LABELS)}
            value={list.filters.audit_type ?? ""}
            onChange={(e) => list.setFilter("audit_type", e.target.value)}
          />
          <Input
            label="Due from"
            type="date"
            value={list.filters.due_from ?? ""}
            onChange={(e) => list.setFilter("due_from", e.target.value)}
          />
          <Input
            label="Due to"
            type="date"
            value={list.filters.due_to ?? ""}
            min={list.filters.due_from}
            onChange={(e) => list.setFilter("due_to", e.target.value)}
          />
          <div className="flex flex-col justify-end gap-2 pb-1 sm:col-span-2 lg:col-span-1 xl:col-span-2">
            <Checkbox
              label="Overdue only"
              checked={list.filters.overdue === "true"}
              onChange={(e) => list.setFilter("overdue", e.target.checked ? "true" : undefined)}
            />
            <Checkbox
              label="Assigned to me"
              checked={list.filters.mine === "true"}
              onChange={(e) => list.setFilter("mine", e.target.checked ? "true" : undefined)}
            />
          </div>
          {hasFilters && (
            <div className="flex items-end sm:col-span-2 lg:col-span-4 xl:col-span-6">
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

      {view === "list" ? (
        <DataTable
          columns={columns}
          rows={query.data?.results}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          ordering={list.ordering}
          onOrderingChange={list.setOrdering}
          onRowClick={(a) => navigate(`/audits/${a.id}`)}
          emptyTitle={hasFilters ? "No audits match these filters" : "No audits yet"}
          emptyDescription={
            hasFilters
              ? "Try clearing some filters."
              : can("manage_audits")
                ? "Plan the first audit from an approved template."
                : "Audits you are involved in will appear here."
          }
          emptyAction={
            !hasFilters && can("manage_audits") ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate("/audits/new")}>
                New audit
              </Button>
            ) : undefined
          }
          pagination={{ page: list.page, pageSize: PAGE_SIZE, count: query.data?.count ?? 0, onPageChange: list.setPage }}
        />
      ) : (
        <AuditCalendar filters={calendarFilters} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- calendar view

interface DayEntry {
  event: CalendarEvent;
  kind: "due" | "start";
}

const MAX_PER_CELL = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function AuditCalendar({ filters }: { filters: Record<string, string | undefined> }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const monthParam = searchParams.get("month");

  const month = useMemo(() => {
    const parsed = monthParam ? parse(monthParam, "yyyy-MM", new Date()) : new Date();
    return startOfMonth(isValid(parsed) ? parsed : new Date());
  }, [monthParam]);

  const setMonth = (date: Date) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("month", format(date, "yyyy-MM"));
        return params;
      },
      { replace: true },
    );

  const gridStart = startOfWeek(month, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const range = { start: isoDate(gridStart), end: isoDate(gridEnd) };

  const query = useQuery({
    queryKey: ["audits", { view: "calendar", ...range, ...filters }],
    queryFn: () => auditsApi.calendar({ ...range, ...filters }),
    placeholderData: (prev) => prev,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const push = (day: string, entry: DayEntry) => {
      const list = map.get(day) ?? [];
      list.push(entry);
      map.set(day, list);
    };
    for (const event of query.data ?? []) {
      push(event.due_date, { event, kind: "due" });
      if (event.planned_start_date !== event.due_date) push(event.planned_start_date, { event, kind: "start" });
    }
    // Due dates first, then overdue first within each kind.
    for (const list of map.values()) {
      list.sort((a, b) =>
        a.kind !== b.kind ? (a.kind === "due" ? -1 : 1) : Number(b.event.is_overdue) - Number(a.event.is_overdue),
      );
    }
    return map;
  }, [query.data]);

  const monthDays = days.filter((d) => isSameMonth(d, month));
  const agendaDays = monthDays.filter((d) => byDay.has(isoDate(d)));
  const openEntries = openDay ? byDay.get(openDay) ?? [] : [];
  const statusesShown = Array.from(new Set((query.data ?? []).map((e) => e.status)));

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900" aria-live="polite">
          {format(month, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous month"
            icon={<ChevronLeft className="h-4 w-4" />}
            onClick={() => setMonth(addMonths(month, -1))}
          />
          <Button variant="secondary" size="sm" onClick={() => setMonth(new Date())}>
            Today
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next month"
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => setMonth(addMonths(month, 1))}
          />
        </div>
      </div>

      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          {/* Desktop / tablet: month grid */}
          <div className="hidden md:block">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = isoDate(day);
                const entries = byDay.get(key) ?? [];
                const inMonth = isSameMonth(day, month);
                return (
                  <div
                    key={key}
                    className={clsx(
                      "min-h-[112px] border-b border-r border-slate-100 p-1.5 [&:nth-child(7n)]:border-r-0",
                      !inMonth && "bg-slate-50/70",
                    )}
                  >
                    <div className="mb-1 flex justify-end">
                      <span
                        className={clsx(
                          "inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-xs tabular-nums",
                          isToday(day) ? "bg-brand-600 font-semibold text-white" : inMonth ? "text-slate-700" : "text-slate-400",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {entries.slice(0, MAX_PER_CELL).map((entry) => (
                        <CalendarPill key={`${entry.kind}-${entry.event.id}`} entry={entry} />
                      ))}
                      {entries.length > MAX_PER_CELL && (
                        <button
                          type="button"
                          onClick={() => setOpenDay(key)}
                          className="w-full rounded px-1.5 text-left text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                        >
                          +{entries.length - MAX_PER_CELL} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile: agenda list */}
          <div className="md:hidden">
            {agendaDays.length === 0 ? (
              <EmptyState title="No audits this month" description="Nothing is planned or due in this month." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {agendaDays.map((day) => (
                  <li key={isoDate(day)} className="px-4 py-3">
                    <p
                      className={clsx(
                        "mb-2 text-xs font-semibold uppercase tracking-wide",
                        isToday(day) ? "text-brand-700" : "text-slate-500",
                      )}
                    >
                      {format(day, "EEEE d MMMM")}
                      {isToday(day) && " · Today"}
                    </p>
                    <div className="space-y-2">
                      {(byDay.get(isoDate(day)) ?? []).map((entry) => (
                        <AgendaRow key={`${entry.kind}-${entry.event.id}`} entry={entry} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            {(statusesShown.length ? statusesShown : (Object.keys(AUDIT_STATUS_LABELS) as AuditStatus[])).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: AUDIT_STATUS_COLORS[s] }} aria-hidden />
                {AUDIT_STATUS_LABELS[s]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-red-600" aria-hidden /> Overdue
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border border-dashed border-slate-400" aria-hidden /> Planned start
            </span>
            {query.data && query.data.length === 0 && (
              <span className="ml-auto text-slate-500">No audits planned or due in this period.</span>
            )}
          </div>
        </>
      )}

      <Modal
        open={!!openDay}
        onClose={() => setOpenDay(null)}
        title={openDay ? format(parseISO(openDay), "EEEE d MMMM yyyy") : ""}
        size="sm"
      >
        <div className="space-y-2">
          {openEntries.map((entry) => (
            <AgendaRow key={`${entry.kind}-${entry.event.id}`} entry={entry} />
          ))}
        </div>
      </Modal>
    </div>
  );
}

function eventTitle(entry: DayEntry) {
  const e = entry.event;
  return [
    `${e.reference} — ${e.title}`,
    `${e.department} · ${AUDIT_STATUS_LABELS[e.status]}${e.is_overdue ? " · Overdue" : ""}`,
    `Planned start ${formatDate(e.planned_start_date)} · Due ${formatDate(e.due_date)}`,
    e.lead_auditor ? `Lead auditor: ${e.lead_auditor}` : "No lead auditor",
  ].join("\n");
}

function CalendarPill({ entry }: { entry: DayEntry }) {
  const { event, kind } = entry;
  const color = AUDIT_STATUS_COLORS[event.status];
  if (kind === "start") {
    return (
      <Link
        to={`/audits/${event.id}`}
        title={eventTitle(entry)}
        className="flex items-center gap-1 truncate rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 hover:border-slate-400 hover:text-slate-700"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="truncate">Starts · {event.reference}</span>
      </Link>
    );
  }
  return (
    <Link
      to={`/audits/${event.id}`}
      title={eventTitle(entry)}
      className={clsx(
        "flex items-center gap-1 truncate rounded border-l-[3px] px-1.5 py-0.5 text-[11px] font-medium hover:brightness-95",
        event.is_overdue ? "text-red-700 ring-1 ring-inset ring-red-300" : "text-slate-800",
      )}
      style={{ borderLeftColor: color, backgroundColor: `${color}1f` }}
    >
      {event.is_overdue && <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" aria-label="Overdue" />}
      <span className="truncate">
        {event.reference} · {event.title}
      </span>
    </Link>
  );
}

function AgendaRow({ entry }: { entry: DayEntry }) {
  const { event, kind } = entry;
  return (
    <Link
      to={`/audits/${event.id}`}
      className={clsx(
        "flex items-start gap-3 rounded-lg border px-3 py-2 hover:bg-slate-50",
        kind === "start" ? "border-dashed border-slate-300" : "border-slate-200",
        event.is_overdue && kind === "due" && "border-red-200 bg-red-50/40",
      )}
    >
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: AUDIT_STATUS_COLORS[event.status] }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">
          {event.reference} · {event.title}
        </p>
        <p className="text-xs text-slate-500">
          {kind === "due" ? "Due" : "Planned start"} · {event.department}
          {event.lead_auditor ? ` · ${event.lead_auditor}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <AuditStatusBadge status={event.status} />
        {event.is_overdue && kind === "due" && <OverdueBadge />}
      </div>
    </Link>
  );
}
