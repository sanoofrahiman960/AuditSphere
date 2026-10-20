import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, FilterX, ShieldCheck, XCircle } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { activityApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/DataTable";
import { Input, Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { PAGE_SIZE, useDebounce, useListParams } from "@/hooks/useListParams";
import { useUserOptions } from "@/hooks/useLookups";
import type { ActivityLog } from "@/types/api";
import { formatDateTime, humanize, timeAgo, type Tone } from "@/utils/format";

const FILTERS = ["action", "actor", "date_from", "date_to"];

const ACTION_PREFIXES = [
  { value: "audit.", label: "Audits" },
  { value: "finding.", label: "Findings" },
  { value: "action.", label: "Corrective actions" },
  { value: "evidence.", label: "Evidence" },
  { value: "template.", label: "Templates" },
  { value: "category.", label: "Categories" },
  { value: "department.", label: "Departments" },
  { value: "user.", label: "Users" },
  { value: "auth.", label: "Sign-in & security" },
  { value: "report.", label: "Reports" },
  { value: "organization.", label: "Organisation settings" },
  { value: "ai.", label: "AI assistant" },
];

const PREFIX_TONE: Record<string, Tone> = {
  audit: "blue",
  finding: "orange",
  action: "teal",
  evidence: "indigo",
  template: "purple",
  category: "purple",
  department: "gray",
  user: "amber",
  auth: "red",
  report: "green",
  organization: "amber",
  ai: "indigo",
};

const OBJECT_LINKS: Record<string, { path: string; label: string }> = {
  "audits.audit": { path: "/audits", label: "Audit" },
  "findings.auditfinding": { path: "/findings", label: "Finding" },
  "corrective_actions.correctiveaction": { path: "/actions", label: "Corrective action" },
};

function objectTypeLabel(type: string): string {
  if (!type) return "—";
  if (OBJECT_LINKS[type]) return OBJECT_LINKS[type].label;
  const model = type.split(".").pop() ?? type;
  return humanize(model);
}

/** "audit.rework_requested" → "Audit · Rework requested" */
function actionLabel(action: string): { area: string; verb: string } {
  const [area, ...rest] = action.split(".");
  return { area, verb: rest.length ? humanize(rest.join(".")) : humanize(area) };
}

function ObjectCell({ log }: { log: ActivityLog }) {
  const link = OBJECT_LINKS[log.object_type];
  const repr = log.object_repr || (log.object_id ? `#${log.object_id}` : "—");
  return (
    <div className="min-w-[180px] max-w-xs">
      <p className="text-xs text-slate-500">{objectTypeLabel(log.object_type)}</p>
      {link && log.object_id ? (
        <Link to={`${link.path}/${log.object_id}`} className="link break-words" onClick={(e) => e.stopPropagation()}>
          {repr}
        </Link>
      ) : (
        <p className="break-words text-slate-700">{repr}</p>
      )}
    </div>
  );
}

function IntegrityResult({ result }: { result: { intact: boolean; broken_entry_ids: number[]; checked: number } }) {
  if (result.intact) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" role="status">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          <strong>Chain intact.</strong> All {result.checked.toLocaleString()} entries were verified; no entry has been
          altered or removed.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p>
          <strong>Integrity check failed.</strong> {result.broken_entry_ids.length} of {result.checked.toLocaleString()}{" "}
          entries do not match their recorded hash chain. This indicates the history was modified outside the
          application — escalate to your security team.
        </p>
        <p className="mt-1 font-mono text-xs">
          Broken entry ids: {result.broken_entry_ids.join(", ")}
          {result.broken_entry_ids.length >= 100 ? " (first 100 shown)" : ""}
        </p>
      </div>
    </div>
  );
}

export default function ActivityLogPage() {
  const toast = useToast();
  const list = useListParams(FILTERS, { ordering: "-created_at" });
  const [searchInput, setSearchInput] = useState(list.search);
  const debouncedSearch = useDebounce(searchInput);
  const users = useUserOptions();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (debouncedSearch !== list.search) list.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ["activity", list.params],
    queryFn: () => activityApi.list(list.params),
    placeholderData: (prev) => prev,
  });

  const integrity = useMutation({
    mutationFn: activityApi.verifyIntegrity,
    onError: (e) => toast.error(e),
  });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasFilters = Object.keys(list.filters).length > 0 || !!list.search;
  const rows = query.data?.results;
  const COLS = 6;

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Append-only, tamper-evident history of every significant action. Each entry is hash-chained to the previous one; entries cannot be edited or deleted."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Administration" }, { label: "Activity log" }]}
        actions={
          <Button
            variant="secondary"
            icon={<ShieldCheck className="h-4 w-4" />}
            loading={integrity.isPending}
            onClick={() => integrity.mutate()}
          >
            Verify integrity
          </Button>
        }
      />

      {integrity.data && (
        <div className="mb-4">
          <IntegrityResult result={integrity.data} />
        </div>
      )}

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="activity-search">
            Search
          </label>
          <input
            id="activity-search"
            type="search"
            className="input"
            placeholder="Action, object, actor email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          label="Area"
          placeholder="All actions"
          options={ACTION_PREFIXES}
          value={list.filters.action ?? ""}
          onChange={(e) => list.setFilter("action", e.target.value)}
        />
        <Select
          label="Actor"
          placeholder="Anyone"
          options={users.data ?? []}
          value={list.filters.actor ?? ""}
          onChange={(e) => list.setFilter("actor", e.target.value)}
        />
        <Input
          label="From"
          type="date"
          value={list.filters.date_from ?? ""}
          max={list.filters.date_to}
          onChange={(e) => list.setFilter("date_from", e.target.value)}
        />
        <Input
          label="To"
          type="date"
          value={list.filters.date_to ?? ""}
          min={list.filters.date_from}
          onChange={(e) => list.setFilter("date_to", e.target.value)}
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

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th scope="col" className="w-8">
                  <span className="sr-only">Details</span>
                </th>
                <th scope="col">Time</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Object</th>
                <th scope="col">IP address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {!query.isLoading &&
                !query.error &&
                rows?.map((log) => {
                  const open = expanded.has(log.id);
                  const { area, verb } = actionLabel(log.action);
                  return (
                    <Fragment key={log.id}>
                      <tr className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(log.id)}>
                        <td className="pr-0">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={open ? "Hide details" : "Show details"}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(log.id);
                            }}
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="whitespace-nowrap">
                          <p>{formatDateTime(log.created_at)}</p>
                          <p className="text-xs text-slate-500">{timeAgo(log.created_at)}</p>
                        </td>
                        <td>
                          <div className="min-w-[160px]">
                            <p className="font-medium text-slate-800">{log.actor_name || "System"}</p>
                            {log.actor_email && log.actor_email !== log.actor_name && (
                              <p className="text-xs text-slate-500">{log.actor_email}</p>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="flex min-w-[180px] flex-wrap items-center gap-1.5">
                            <Badge tone={PREFIX_TONE[area] ?? "gray"}>{humanize(area)}</Badge>
                            <span className="text-slate-800">{verb}</span>
                          </div>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400">{log.action}</p>
                        </td>
                        <td>
                          <ObjectCell log={log} />
                        </td>
                        <td className="whitespace-nowrap font-mono text-xs text-slate-600">{log.ip_address ?? "—"}</td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={COLS} className="px-4 py-3">
                            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                              <div className="min-w-0">
                                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Changes</p>
                                {log.changes && Object.keys(log.changes).length > 0 ? (
                                  <pre className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700">
                                    {JSON.stringify(log.changes, null, 2)}
                                  </pre>
                                ) : (
                                  <p className="text-sm text-slate-500">No field changes recorded for this event.</p>
                                )}
                              </div>
                              <dl className="space-y-2 text-xs">
                                <div>
                                  <dt className="font-medium uppercase tracking-wide text-slate-500">Entry id</dt>
                                  <dd className="font-mono text-slate-700">{log.id}</dd>
                                </div>
                                <div>
                                  <dt className="font-medium uppercase tracking-wide text-slate-500">Object reference</dt>
                                  <dd className="break-all font-mono text-slate-700">
                                    {log.object_type || "—"}
                                    {log.object_id ? ` #${log.object_id}` : ""}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-medium uppercase tracking-wide text-slate-500">Request id</dt>
                                  <dd className="break-all font-mono text-slate-700">{log.request_id || "—"}</dd>
                                </div>
                                <div>
                                  <dt className="font-medium uppercase tracking-wide text-slate-500">Entry hash</dt>
                                  <dd className="break-all font-mono text-slate-700">{log.hash}</dd>
                                </div>
                              </dl>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
        {query.isLoading && <LoadingState />}
        {!query.isLoading && query.error != null && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {!query.isLoading && !query.error && rows?.length === 0 && (
          <EmptyState
            title={hasFilters ? "No activity matches these filters" : "No activity recorded yet"}
            description={hasFilters ? "Try widening the date range or clearing filters." : undefined}
          />
        )}
        {!query.error && (
          <Pagination page={list.page} pageSize={PAGE_SIZE} count={query.data?.count ?? 0} onPageChange={list.setPage} />
        )}
      </div>
    </>
  );
}
