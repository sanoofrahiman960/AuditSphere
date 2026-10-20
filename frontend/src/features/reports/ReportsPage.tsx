import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { FileSpreadsheet, FileText, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { reportsApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { AUDITOR_ROLES, useDepartmentOptions, useUserOptions } from "@/hooks/useLookups";
import type { Report, ReportChart, ReportFilters, ReportSection } from "@/types/api";
import {
  ACTION_STATUS_LABELS,
  AUDIT_STATUS_LABELS,
  AUDIT_TYPE_LABELS,
  FINDING_STATUS_LABELS,
  SEVERITY_LABELS,
  formatDateTime,
  options,
} from "@/utils/format";
import { AXIS_TICK, CHART_COLORS, ChartEmpty, TOOLTIP_STYLE } from "@/features/dashboard/charts";

const DEFAULT_REPORT = "audits";
const PERIOD_REPORTS = new Set(["periodic", "completion-trend"]);
const ROWS_PER_PAGE = 25;
/** Server-side preview cap (backend/apps/reports/builders.py PREVIEW_LIMIT); exports allow more rows. */
const PREVIEW_LIMIT = 500;
const SERIES_COLORS = [CHART_COLORS.blue, CHART_COLORS.green, CHART_COLORS.amber, "#9333ea", "#0d9488"];

/** X-axis label per report chart (the API sends labels and series only). */
const CHART_X_LABEL: Record<string, string> = {
  audits: "Audit status",
  "department-compliance": "Department",
  findings: "Severity",
  "corrective-actions": "Action status",
  periodic: "Period",
  "auditor-workload": "Lead auditor",
  "completion-trend": "Period",
  "department-comparison": "Department",
};

interface Draft {
  date_from: string;
  date_to: string;
  department: string;
  audit_type: string;
  status: string;
  severity: string;
  auditor: string;
  owner: string;
  period: "month" | "quarter";
}

const EMPTY_DRAFT: Draft = {
  date_from: "",
  date_to: "",
  department: "",
  audit_type: "",
  status: "",
  severity: "",
  auditor: "",
  owner: "",
  period: "month",
};

/** Turn the form draft into API filters; `period` only applies to period-based reports. */
function toFilters(draft: Draft, reportKey: string): ReportFilters {
  const f: ReportFilters = {};
  if (draft.date_from) f.date_from = draft.date_from;
  if (draft.date_to) f.date_to = draft.date_to;
  if (draft.department) f.department = Number(draft.department);
  if (draft.audit_type) f.audit_type = draft.audit_type;
  if (draft.status) f.status = draft.status;
  if (draft.severity) f.severity = draft.severity;
  if (draft.auditor) f.auditor = Number(draft.auditor);
  if (draft.owner) f.owner = Number(draft.owner);
  if (PERIOD_REPORTS.has(reportKey)) f.period = draft.period;
  return f;
}

/** Audit, finding and action statuses in one select; a status shared by several record types is listed once. */
const STATUS_GROUPS = (() => {
  const entities: { name: string; labels: Record<string, string> }[] = [
    { name: "audits", labels: AUDIT_STATUS_LABELS },
    { name: "findings", labels: FINDING_STATUS_LABELS },
    { name: "actions", labels: ACTION_STATUS_LABELS },
  ];
  const seen = new Set<string>();
  return entities
    .map((entity) => ({
      label: `${entity.name[0].toUpperCase()}${entity.name.slice(1)} statuses`,
      options: Object.entries(entity.labels)
        .filter(([value]) => {
          if (seen.has(value)) return false;
          seen.add(value);
          return true;
        })
        .map(([value, label]) => {
          const appliesTo = entities.filter((e) => value in e.labels).map((e) => e.name);
          return { value, label: appliesTo.length > 1 ? `${label} (${appliesTo.join(", ")})` : label };
        }),
    }))
    .filter((group) => group.options.length > 0);
})();

function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
  return value;
}

// ---------------------------------------------------------------- page

export default function ReportsPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const reportKey = searchParams.get("report") || DEFAULT_REPORT;

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<Draft>(EMPTY_DRAFT);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const departments = useDepartmentOptions(true);
  const auditors = useUserOptions(AUDITOR_ROLES);
  const owners = useUserOptions();

  const catalog = useQuery({ queryKey: ["reports", "catalog"], queryFn: reportsApi.catalog, staleTime: 10 * 60_000 });
  const filters = useMemo(() => toFilters(applied, reportKey), [applied, reportKey]);
  const invalidRange = !!draft.date_from && !!draft.date_to && draft.date_from > draft.date_to;

  const report = useQuery({
    queryKey: ["reports", reportKey, filters],
    queryFn: () => reportsApi.get(reportKey, filters),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === reportKey ? prev : undefined),
  });

  const selected = catalog.data?.find((r) => r.key === reportKey);
  const unknownReport = catalog.isSuccess && !selected;
  const showPeriod = PERIOD_REPORTS.has(reportKey);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const run = () => {
    if (invalidRange) return;
    if (dirty) setApplied(draft);
    else report.refetch();
  };

  const reset = () => {
    setDraft(EMPTY_DRAFT);
    setApplied(EMPTY_DRAFT);
  };

  const selectReport = (key: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("report", key);
        return next;
      },
      { replace: true },
    );

  const doExport = async (format: "pdf" | "excel") => {
    setExporting(format);
    try {
      // Exports use the last applied filters, i.e. exactly what the preview shows.
      await reportsApi.export(reportKey, format, filters);
      toast.success(format === "pdf" ? "PDF export downloaded" : "Excel export downloaded");
    } catch (err) {
      toast.error(err);
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Run audit, risk and remediation reports, preview them here and export to PDF or Excel."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Reports" }]}
        meta={
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-hidden />
            Reports and exports contain only data you are authorised to see.
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={<FileText className="h-4 w-4" />}
              loading={exporting === "pdf"}
              disabled={!!exporting || unknownReport || !report.data}
              onClick={() => doExport("pdf")}
            >
              Export PDF
            </Button>
            <Button
              variant="secondary"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              loading={exporting === "excel"}
              disabled={!!exporting || unknownReport || !report.data}
              onClick={() => doExport("excel")}
            >
              Export Excel
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Catalog */}
        <aside aria-label="Report catalogue">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Report catalogue</h2>
          {catalog.isLoading ? (
            <div className="card">
              <LoadingState />
            </div>
          ) : catalog.error ? (
            <div className="card">
              <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {catalog.data?.map((item) => {
                const active = item.key === reportKey;
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => selectReport(item.key)}
                      aria-pressed={active}
                      className={clsx(
                        "w-full rounded-xl border bg-white p-3 text-left shadow-card transition",
                        active ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200 hover:border-brand-300",
                      )}
                    >
                      <span className={clsx("block text-sm font-semibold", active ? "text-brand-700" : "text-slate-800")}>
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{item.description}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {/* Filters */}
          <Card
            title="Filters"
            description={selected ? `Applied to: ${selected.title}` : undefined}
            actions={
              <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>
                Reset
              </Button>
            }
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run();
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Input label="From" type="date" value={draft.date_from} onChange={(e) => set("date_from", e.target.value)} />
                <Input
                  label="To"
                  type="date"
                  value={draft.date_to}
                  onChange={(e) => set("date_to", e.target.value)}
                  error={invalidRange ? "End date must be on or after the start date." : undefined}
                />
                <Select
                  label="Department"
                  placeholder="All departments"
                  options={departments.data ?? []}
                  value={draft.department}
                  onChange={(e) => set("department", e.target.value)}
                />
                <Select
                  label="Audit type"
                  placeholder="All types"
                  options={options(AUDIT_TYPE_LABELS)}
                  value={draft.audit_type}
                  onChange={(e) => set("audit_type", e.target.value)}
                />
                <StatusSelect value={draft.status} onChange={(v) => set("status", v)} />
                <Select
                  label="Risk severity"
                  placeholder="All severities"
                  options={options(SEVERITY_LABELS)}
                  value={draft.severity}
                  onChange={(e) => set("severity", e.target.value)}
                />
                <Select
                  label="Lead auditor"
                  placeholder="All auditors"
                  options={auditors.data ?? []}
                  value={draft.auditor}
                  onChange={(e) => set("auditor", e.target.value)}
                />
                <Select
                  label="Action owner"
                  placeholder="All owners"
                  options={owners.data ?? []}
                  value={draft.owner}
                  onChange={(e) => set("owner", e.target.value)}
                />
                {showPeriod && (
                  <Select
                    label="Group by"
                    options={[
                      { value: "month", label: "Month" },
                      { value: "quarter", label: "Quarter" },
                    ]}
                    value={draft.period}
                    onChange={(e) => set("period", e.target.value as Draft["period"])}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" icon={<Play className="h-4 w-4" />} loading={report.isFetching} disabled={invalidRange || unknownReport}>
                  Run report
                </Button>
                {dirty && <span className="text-xs text-amber-700">Filters changed — run the report to apply them.</span>}
              </div>
            </form>
          </Card>

          {/* Result */}
          {unknownReport ? (
            <div className="card">
              <EmptyState title="Unknown report" description="Choose a report from the catalogue." />
            </div>
          ) : report.isLoading ? (
            <div className="card">
              <LoadingState label="Building report…" />
            </div>
          ) : report.error ? (
            <div className="card">
              <ErrorState error={report.error} onRetry={() => report.refetch()} />
            </div>
          ) : report.data ? (
            <ReportView report={report.data} refreshing={report.isFetching} />
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- status select with groups

function StatusSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <Field label="Status" htmlFor={id} hint="Applies to every record type that has this status.">
      <select id={id} className="input pr-8" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All statuses</option>
        {STATUS_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------- report rendering

function ReportView({ report, refreshing }: { report: Report; refreshing: boolean }) {
  return (
    <div className={clsx("space-y-6 transition-opacity", refreshing && "opacity-60")} aria-busy={refreshing}>
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>
            <p className="text-sm text-slate-600">{report.organization}</p>
          </div>
          <p className="text-right text-xs text-slate-500">
            Generated {formatDateTime(report.generated_at)}
            <br />
            by {report.generated_by}
          </p>
        </div>
        {report.filters.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Applied filters">
            {report.filters.map((f) => (
              <Badge key={`${f.label}-${f.value}`} tone="blue">
                <span className="font-semibold">{f.label}:</span>&nbsp;{f.value}
              </Badge>
            ))}
          </div>
        )}

        {report.summary.length > 0 && (
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {report.summary.map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
                  {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {report.chart && (
        <Card title={report.chart.title}>
          <ReportBarChart chart={report.chart} xLabel={CHART_X_LABEL[report.key]} />
        </Card>
      )}

      {report.sections.map((section, i) => (
        <SectionTable key={`${report.key}-${report.generated_at}-${i}`} section={section} />
      ))}
    </div>
  );
}

function ReportBarChart({ chart, xLabel }: { chart: ReportChart; xLabel?: string }) {
  const data = chart.labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    chart.series.forEach((s, si) => {
      row[`s${si}`] = s.values[i] ?? null;
    });
    return row;
  });
  const empty = chart.labels.length === 0 || chart.series.every((s) => s.values.every((v) => !v));
  if (empty) return <ChartEmpty description="No records match the applied filters." />;

  const crowded = chart.labels.length > 6;
  const yLabel = chart.series.length === 1 ? chart.series[0].name : "Count";
  const isPercent = chart.series.every((s) => s.name.includes("%"));

  return (
    <figure aria-label={chart.title} className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: crowded ? 48 : 16, left: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_COLORS.grid }}
            interval={0}
            angle={crowded ? -35 : 0}
            textAnchor={crowded ? "end" : "middle"}
            height={crowded ? 70 : 40}
          >
            {xLabel && <Label value={xLabel} position="insideBottom" offset={crowded ? -40 : -8} style={AXIS_TICK} />}
          </XAxis>
          <YAxis
            allowDecimals={isPercent}
            domain={isPercent ? [0, 100] : [0, "auto"]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
          >
            <Label value={yLabel} angle={-90} position="insideLeft" style={{ ...AXIS_TICK, textAnchor: "middle" }} />
          </YAxis>
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: "#f1f5f9" }}
            formatter={(value, name) => [
              value === null || value === undefined ? "—" : formatCell(Number(value)),
              name,
            ]}
          />
          <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
          {chart.series.map((s, si) => (
            <Bar
              key={s.name}
              dataKey={`s${si}`}
              name={s.name}
              fill={SERIES_COLORS[si % SERIES_COLORS.length]}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

function SectionTable({ section }: { section: ReportSection }) {
  const [page, setPage] = useState(1);
  const total = section.rows.length;
  const rows = section.rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  // A column is numeric when its first non-empty value is a number (right-aligned).
  const numeric = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const col of section.columns) {
      const sample = section.rows.find((r) => r[col.key] !== null && r[col.key] !== undefined && r[col.key] !== "");
      result[col.key] = typeof sample?.[col.key] === "number";
    }
    return result;
  }, [section]);

  return (
    <Card
      title={section.title}
      description={
        total >= PREVIEW_LIMIT
          ? `${total.toLocaleString()} rows (preview limit reached; export for the complete list)`
          : `${total.toLocaleString()} ${total === 1 ? "row" : "rows"}`
      }
      bodyClassName="p-0"
    >
      {total === 0 ? (
        <EmptyState title="No records" description="Nothing in this section matches the applied filters." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  {section.columns.map((col) => (
                    <th key={col.key} scope="col" className={clsx(numeric[col.key] && "text-right")}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row, i) => (
                  <tr key={(page - 1) * ROWS_PER_PAGE + i}>
                    {section.columns.map((col) => (
                      <td
                        key={col.key}
                        className={clsx(numeric[col.key] ? "text-right tabular-nums" : "whitespace-nowrap", "max-w-xs truncate")}
                        title={typeof row[col.key] === "string" ? (row[col.key] as string) : undefined}
                      >
                        {formatCell(row[col.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={ROWS_PER_PAGE} count={total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}
