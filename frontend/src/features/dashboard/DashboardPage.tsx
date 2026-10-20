import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileSearch,
  FilterX,
  Info,
  ListChecks,
  ShieldAlert,
  Timer,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { actionsApi, dashboardApi, findingsApi } from "@/api/endpoints";
import { ActionStatusBadge, AuditStatusBadge, OverdueBadge, PriorityBadge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, StatCard } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Form";
import { ProgressBar } from "@/components/ui/Misc";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/ui/States";
import { useDepartmentOptions } from "@/hooks/useLookups";
import { useAuth } from "@/features/auth/AuthContext";
import type { DashboardFilters, DashboardSummary, DepartmentRow, Me } from "@/types/api";
import { formatDate, formatPercent, humanize, scoreColor, timeAgo } from "@/utils/format";
import {
  AXIS_TICK,
  CHART_COLORS,
  ChartFrame,
  RiskBars,
  StatusDonut,
  TOOLTIP_STYLE,
  TrendChart,
} from "./charts";
import { MyWorkPanel } from "./MyWorkPanel";

// ---------------------------------------------------------------- helpers

function greeting(user: Me | null): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = user?.first_name || user?.full_name || "";
  return name ? `${part}, ${name}` : part;
}

function scopeCopy(user: Me | null): string {
  switch (user?.role) {
    case "SUPER_ADMIN":
    case "AUDIT_ADMIN":
    case "EXECUTIVE":
      return "Organisation-wide audit, risk and remediation position.";
    case "DEPT_MANAGER":
      return "Audit, risk and remediation position for the departments you manage and the audits you take part in.";
    case "AUDITOR":
    case "REVIEWER":
      return "Audits you lead, review or are assigned to, with the findings and actions they raised.";
    default:
      return "Audit, risk and remediation position for the records you can access.";
  }
}

/** Literal Tailwind classes so the JIT compiler keeps them. */
function scoreBg(score: number | null | undefined, target: number): string {
  if (score === null || score === undefined) return "bg-slate-300";
  if (score >= target) return "bg-green-600";
  if (score >= target - 15) return "bg-amber-500";
  return "bg-red-600";
}

function scoreHex(score: number, target: number | null): string {
  if (target === null) return CHART_COLORS.blue;
  if (score >= target) return "#16a34a";
  if (score >= target - 15) return "#f59e0b";
  return "#dc2626";
}

const OBJECT_ROUTES: Record<string, string> = {
  "audits.audit": "/audits",
  "findings.auditfinding": "/findings",
  "corrective_actions.correctiveaction": "/actions",
  "departments.department": "/departments",
  "audit_templates.audittemplate": "/templates",
};

function objectLink(objectType: string, objectId: string): string | null {
  const base = OBJECT_ROUTES[objectType];
  return base && /^\d+$/.test(objectId) ? `${base}/${objectId}` : null;
}

function dueLabel(daysLeft: number): string {
  if (daysLeft <= 0) return "Due today";
  if (daysLeft === 1) return "Due tomorrow";
  return `Due in ${daysLeft} days`;
}

// ---------------------------------------------------------------- filters in the URL

function useDashboardFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const department = searchParams.get("department") ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";
  const invalidRange = !!dateFrom && !!dateTo && dateFrom > dateTo;

  const filters = useMemo<DashboardFilters>(() => {
    const f: DashboardFilters = {};
    if (department && Number(department) > 0) f.department = Number(department);
    if (!invalidRange) {
      if (dateFrom) f.date_from = dateFrom;
      if (dateTo) f.date_to = dateTo;
    }
    return f;
  }, [department, dateFrom, dateTo, invalidRange]);

  const set = (key: "department" | "date_from" | "date_to", value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const clear = () => setSearchParams(new URLSearchParams(), { replace: true });

  return { department, dateFrom, dateTo, invalidRange, filters, set, clear, active: !!(department || dateFrom || dateTo) };
}

// ---------------------------------------------------------------- page

export default function DashboardPage() {
  const { user } = useAuth();
  if (user?.role === "ACTION_OWNER") return <ActionOwnerDashboard user={user} />;
  return <FullDashboard user={user} />;
}

function FullDashboard({ user }: { user: Me | null }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const f = useDashboardFilters();
  const { filters } = f;
  const departments = useDepartmentOptions();

  const summary = useQuery({
    queryKey: ["dashboard", "summary", filters],
    queryFn: () => dashboardApi.summary(filters),
    placeholderData: (prev) => prev,
  });
  const status = useQuery({
    queryKey: ["dashboard", "status-distribution", filters],
    queryFn: () => dashboardApi.statusDistribution(filters),
    placeholderData: (prev) => prev,
  });
  const deptCompliance = useQuery({
    queryKey: ["dashboard", "department-compliance", filters],
    queryFn: () => dashboardApi.departmentCompliance(filters),
    placeholderData: (prev) => prev,
  });
  const risk = useQuery({
    queryKey: ["dashboard", "risk-distribution", filters],
    queryFn: () => dashboardApi.riskDistribution(filters),
    placeholderData: (prev) => prev,
  });
  const trend = useQuery({
    queryKey: ["dashboard", "monthly-trend", filters],
    queryFn: () => dashboardApi.monthlyTrend(filters),
    placeholderData: (prev) => prev,
  });
  const overdue = useQuery({
    queryKey: ["dashboard", "overdue-actions", filters],
    queryFn: () => dashboardApi.overdueActions(filters),
    placeholderData: (prev) => prev,
  });
  const upcoming = useQuery({ queryKey: ["dashboard", "upcoming-audits"], queryFn: dashboardApi.upcomingAudits });
  const activity = useQuery({ queryKey: ["dashboard", "recent-activity"], queryFn: dashboardApi.recentActivity });

  const s = summary.data;
  const target = s?.compliance_target ?? null;

  /** Append the dashboard's department filter to list links. */
  const go = (path: string) => () => {
    if (!filters.department) return navigate(path);
    const sep = path.includes("?") ? "&" : "?";
    navigate(`${path}${sep}department=${filters.department}`);
  };

  const num = (value: number | undefined) => (summary.isLoading || value === undefined ? "—" : value.toLocaleString());

  return (
    <>
      <PageHeader
        title={greeting(user)}
        description={
          <>
            {user?.organization?.name && <span className="font-medium text-slate-700">{user.organization.name}</span>}
            {user?.organization?.name && " · "}
            {scopeCopy(user)}
          </>
        }
        actions={
          can("view_reports") ? (
            <Button variant="secondary" icon={<FileSearch className="h-4 w-4" />} onClick={() => navigate("/reports")}>
              Reports
            </Button>
          ) : undefined
        }
      />

      {user?.role !== "EXECUTIVE" && <MyWorkPanel />}

      {/* Filter bar */}
      <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Department"
          placeholder="All departments"
          options={departments.data ?? []}
          value={f.department}
          onChange={(e) => f.set("department", e.target.value)}
        />
        <Input
          label="From"
          type="date"
          value={f.dateFrom}
          max={f.dateTo || undefined}
          onChange={(e) => f.set("date_from", e.target.value)}
        />
        <Input
          label="To"
          type="date"
          value={f.dateTo}
          min={f.dateFrom || undefined}
          onChange={(e) => f.set("date_to", e.target.value)}
          error={f.invalidRange ? "End date must be on or after the start date — date range ignored." : undefined}
        />
        <div className="flex items-end gap-2">
          {f.active ? (
            <Button variant="ghost" icon={<FilterX className="h-4 w-4" />} onClick={f.clear}>
              Clear filters
            </Button>
          ) : (
            <p className="pb-2 text-xs text-slate-500">
              Date range applies to audit due/start dates, finding creation and action due dates.
            </p>
          )}
        </div>
      </div>

      {/* KPIs */}
      {summary.error && !s ? (
        <div className="card mb-6">
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <ComplianceCard summary={s} loading={summary.isLoading} />
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 xl:grid-cols-3">
              <StatCard
                label="Total audits"
                value={num(s?.total_audits)}
                hint={s ? `${s.draft_audits} draft · ${s.cancelled_audits} cancelled` : undefined}
                icon={<ClipboardList className="h-5 w-5" />}
                onClick={go("/audits")}
              />
              <StatCard
                label="Scheduled"
                value={num(s?.scheduled_audits)}
                icon={<CalendarClock className="h-5 w-5" />}
                onClick={go("/audits?status=SCHEDULED")}
              />
              <StatCard
                label="In progress"
                value={num(s?.in_progress_audits)}
                hint="Includes rework required"
                icon={<Clock className="h-5 w-5" />}
                onClick={go("/audits?status=IN_PROGRESS")}
              />
              <StatCard
                label="Awaiting review"
                value={num(s?.awaiting_review_audits)}
                tone={s && s.awaiting_review_audits > 0 ? "warning" : "default"}
                icon={<ClipboardCheck className="h-5 w-5" />}
                onClick={go("/audits?status=SUBMITTED")}
              />
              <StatCard
                label="Completed"
                value={num(s?.completed_audits)}
                hint="Approved or completed"
                tone={s && s.completed_audits > 0 ? "success" : "default"}
                icon={<CheckCircle2 className="h-5 w-5" />}
                onClick={go("/audits?status=COMPLETED")}
              />
              <StatCard
                label="Overdue audits"
                value={num(s?.overdue_audits)}
                tone={s && s.overdue_audits > 0 ? "danger" : "default"}
                icon={<Timer className="h-5 w-5" />}
                onClick={go("/audits?overdue=true")}
              />
            </div>
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Open findings"
              value={num(s?.open_findings)}
              icon={<FileSearch className="h-5 w-5" />}
              onClick={go("/findings?open=true")}
            />
            <StatCard
              label="Critical & high findings"
              value={num(s?.critical_high_findings)}
              hint="Open, sorted by risk score"
              tone={s && s.critical_high_findings > 0 ? "danger" : "default"}
              icon={<ShieldAlert className="h-5 w-5" />}
              onClick={go("/findings?open=true&severity=CRITICAL,HIGH&ordering=-risk_score")}
            />
            <StatCard
              label="Open corrective actions"
              value={num(s?.open_actions)}
              icon={<Wrench className="h-5 w-5" />}
              onClick={go("/actions?open=true")}
            />
            <StatCard
              label="Overdue actions"
              value={num(s?.overdue_actions)}
              tone={s && s.overdue_actions > 0 ? "danger" : "default"}
              icon={<AlertTriangle className="h-5 w-5" />}
              onClick={go("/actions?overdue=true")}
            />
          </div>
        </>
      )}

      {/* Charts */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Audit status distribution" description="All audits in the current view by workflow status.">
          <StatusDonut
            data={status.data}
            loading={status.isLoading}
            error={status.error}
            onRetry={() => status.refetch()}
          />
        </Card>
        <Card title="Risk severity distribution" description="Open findings versus all findings, by severity.">
          <RiskBars data={risk.data} loading={risk.isLoading} error={risk.error} onRetry={() => risk.refetch()} />
        </Card>
        <Card
          title="Compliance by department"
          description={
            target !== null
              ? `Score of approved and completed audits. Dashed line marks the ${target}% target.`
              : "Score of approved and completed audits."
          }
        >
          <DepartmentComplianceChart
            rows={deptCompliance.data}
            loading={deptCompliance.isLoading}
            error={deptCompliance.error}
            onRetry={() => deptCompliance.refetch()}
            target={target}
          />
        </Card>
        <Card title="Monthly audit completion trend" description="Audits due versus completed (left axis) and compliance score (right axis), last 12 months.">
          <TrendChart
            data={trend.data}
            loading={trend.isLoading}
            error={trend.error}
            onRetry={() => trend.refetch()}
            target={target}
          />
        </Card>
      </div>

      {/* Lists */}
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card
          title="Upcoming audits"
          description="Next due dates for open audits."
          actions={
            <Link to="/audits" className="link text-xs">
              All audits
            </Link>
          }
          bodyClassName="p-0"
        >
          {upcoming.isLoading ? (
            <LoadingState />
          ) : upcoming.error ? (
            <ErrorState error={upcoming.error} onRetry={() => upcoming.refetch()} />
          ) : !upcoming.data?.length ? (
            <EmptyState title="No upcoming audits" description="Scheduled and in-progress audits with future due dates appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.data.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/audits/${a.id}`} className="link text-sm">
                        {a.reference}
                      </Link>
                      <p className="truncate text-sm text-slate-800" title={a.title}>
                        {a.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {a.department}
                        {a.lead_auditor ? ` · ${a.lead_auditor}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <AuditStatusBadge status={a.status} />
                      <p
                        className={clsx(
                          "mt-1 text-xs font-medium",
                          a.days_left <= 3 ? "text-amber-700" : "text-slate-500",
                        )}
                        title={formatDate(a.due_date)}
                      >
                        {dueLabel(a.days_left)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar value={a.completion_percentage} className="flex-1" />
                    <span className="w-9 text-right text-xs tabular-nums text-slate-500">{a.completion_percentage}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Overdue actions"
          description="Corrective actions past their due date."
          actions={
            <Link to="/actions?overdue=true" className="link text-xs">
              View all
            </Link>
          }
          bodyClassName="p-0"
        >
          {overdue.isLoading ? (
            <LoadingState />
          ) : overdue.error ? (
            <ErrorState error={overdue.error} onRetry={() => overdue.refetch()} />
          ) : !overdue.data?.length ? (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6 text-green-600" />}
              title="No overdue actions"
              description="Every open corrective action is within its due date."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {overdue.data.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/actions/${a.id}`} className="link text-sm">
                      {a.reference}
                    </Link>
                    <p className="truncate text-sm text-slate-800" title={a.title}>
                      {a.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.owner} · {a.department}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <SeverityBadge severity={a.finding_severity} />
                    <span className="text-xs font-medium text-red-600" title={`Due ${formatDate(a.due_date)}`}>
                      {a.days_overdue} {a.days_overdue === 1 ? "day" : "days"} overdue
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" description="Latest changes recorded in the audit trail." bodyClassName="p-0">
          {activity.isLoading ? (
            <LoadingState />
          ) : activity.error ? (
            <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
          ) : !activity.data?.length ? (
            <EmptyState title="No recent activity" description="Changes to audits you can see will appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.data.map((log) => {
                const to = objectLink(log.object_type, log.object_id);
                return (
                  <li key={log.id} className="px-5 py-3 text-sm">
                    <p className="text-slate-700">
                      <span className="font-medium text-slate-900">{log.actor || "System"}</span>{" "}
                      <span className="text-slate-500">·</span> {humanize(log.action)}
                    </p>
                    {log.object_repr && (
                      <p className="truncate text-xs">
                        {to ? (
                          <Link to={to} className="link">
                            {log.object_repr}
                          </Link>
                        ) : (
                          <span className="text-slate-600">{log.object_repr}</span>
                        )}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-slate-400" title={formatDate(log.created_at, "d MMM yyyy, HH:mm")}>
                      {timeAgo(log.created_at)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <DepartmentTable
        rows={deptCompliance.data}
        loading={deptCompliance.isLoading}
        error={deptCompliance.error}
        onRetry={() => deptCompliance.refetch()}
        target={target}
      />
    </>
  );
}

// ---------------------------------------------------------------- compliance score card

function ComplianceCard({ summary, loading }: { summary: DashboardSummary | undefined; loading: boolean }) {
  const score = summary?.compliance_score ?? null;
  const target = summary?.compliance_target ?? null;
  const effectiveTarget = target ?? 85;
  const delta = score !== null && target !== null ? score - target : null;

  return (
    <section className="card flex flex-col p-5" aria-labelledby="compliance-score-heading">
      <div className="flex items-start justify-between gap-3">
        <h2 id="compliance-score-heading" className="text-sm font-semibold text-slate-900">
          Overall compliance score
        </h2>
        <ListChecks className="h-5 w-5 text-slate-400" aria-hidden />
      </div>
      {loading ? (
        <LoadingState className="py-6" />
      ) : (
        <>
          <p className={clsx("mt-2 text-4xl font-semibold tabular-nums", scoreColor(score, effectiveTarget))}>
            {score === null ? "—" : formatPercent(score)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {score === null
              ? "No approved or completed audits in this view yet."
              : target === null
                ? "No compliance target configured."
                : delta! >= 0
                  ? `${delta!.toFixed(1)} pts above the ${target}% target`
                  : `${Math.abs(delta!).toFixed(1)} pts below the ${target}% target`}
          </p>

          <div className="relative mt-4 h-2.5 w-full rounded-full bg-slate-100" aria-hidden>
            <div
              className={clsx("h-full rounded-full", scoreBg(score, effectiveTarget))}
              style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }}
            />
            {target !== null && (
              <div
                className="absolute -top-1 w-0.5 bg-slate-700"
                style={{ left: `${Math.max(0, Math.min(100, target))}%`, height: "1.125rem" }}
                title={`Target ${target}%`}
              />
            )}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>0%</span>
            {target !== null && <span>Target {target}%</span>}
            <span>100%</span>
          </div>

          {summary && (
            <p className="mt-3 text-xs text-slate-500">
              {summary.failed_checks.toLocaleString()} failed {summary.failed_checks === 1 ? "check" : "checks"} across{" "}
              {summary.completed_audits.toLocaleString()} approved/completed {summary.completed_audits === 1 ? "audit" : "audits"}.
            </p>
          )}

          {(summary?.scoring_explanation || summary?.risk_explanation) && (
            <details className="group mt-auto pt-4">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                <Info className="h-3.5 w-3.5" aria-hidden /> How are these calculated?
              </summary>
              <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                {summary.scoring_explanation && (
                  <p>
                    <span className="font-semibold text-slate-700">Compliance score: </span>
                    {summary.scoring_explanation}
                  </p>
                )}
                {summary.risk_explanation && (
                  <p>
                    <span className="font-semibold text-slate-700">Risk severity: </span>
                    {summary.risk_explanation}
                  </p>
                )}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- compliance by department chart

function DepartmentComplianceChart({
  rows,
  loading,
  error,
  onRetry,
  target,
}: {
  rows: DepartmentRow[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  target: number | null;
}) {
  const all = rows ?? [];
  const scored = all
    .filter((r): r is DepartmentRow & { compliance_score: number } => r.compliance_score !== null)
    .sort((a, b) => b.compliance_score - a.compliance_score);
  const unscored = all.filter((r) => r.compliance_score === null);
  const height = Math.max(180, scored.length * 34 + 80);

  const legend =
    target !== null
      ? [
          { value: `At or above target (${target}%)`, type: "square" as const, id: "ok", color: "#16a34a" },
          { value: "Within 15 pts of target", type: "square" as const, id: "near", color: "#f59e0b" },
          { value: "More than 15 pts below", type: "square" as const, id: "low", color: "#dc2626" },
        ]
      : [{ value: "Compliance score", type: "square" as const, id: "score", color: CHART_COLORS.blue }];

  return (
    <>
      <ChartFrame
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={scored.length === 0}
        emptyTitle={all.length === 0 ? "No departments in this view" : "No completed audits yet"}
        emptyDescription={
          all.length === 0
            ? "Departments you can access will appear here."
            : "Department scores appear once audits are approved or completed."
        }
        height={height}
        label={`Compliance score by department: ${scored.map((r) => `${r.department} ${r.compliance_score.toFixed(1)}%`).join(", ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={scored} layout="vertical" margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            >
              <Label value="Compliance score (%)" position="insideBottom" offset={-8} style={AXIS_TICK} />
            </XAxis>
            <YAxis
              type="category"
              dataKey="department"
              width={130}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              cursor={{ fill: "#f1f5f9" }}
              formatter={(value) => [`${Number(value).toFixed(1)}%`, "Compliance score"]}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} payload={legend} />
            {target !== null && (
              <ReferenceLine
                x={target}
                stroke="#334155"
                strokeDasharray="4 4"
                label={{ value: `Target ${target}%`, position: "top", fontSize: 11, fill: "#334155" }}
              />
            )}
            <Bar dataKey="compliance_score" name="Compliance score" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
              {scored.map((r) => (
                <Cell key={r.department_id} fill={scoreHex(r.compliance_score, target)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      {!loading && !error && unscored.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">No completed audits: </span>
          {unscored.map((r, i) => (
            <span key={r.department_id}>
              {i > 0 && ", "}
              <Link to={`/departments/${r.department_id}`} className="link font-normal">
                {r.department}
              </Link>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- department comparison table

type SortKey = Exclude<keyof DepartmentRow, "department_id" | "is_active">;

const DEPT_COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "department", label: "Department" },
  { key: "total_audits", label: "Audits", numeric: true },
  { key: "completed_audits", label: "Completed", numeric: true },
  { key: "compliance_score", label: "Score", numeric: true },
  { key: "failed_checks", label: "Failed checks", numeric: true },
  { key: "open_findings", label: "Open findings", numeric: true },
  { key: "critical_findings", label: "Critical", numeric: true },
  { key: "high_findings", label: "High", numeric: true },
  { key: "open_actions", label: "Open actions", numeric: true },
  { key: "overdue_actions", label: "Overdue actions", numeric: true },
];

function DepartmentTable({
  rows,
  loading,
  error,
  onRetry,
  target,
}: {
  rows: DepartmentRow[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  target: number | null;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "department", dir: "asc" });

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      // Nulls (no completed audits) always sort last.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, sort]);

  const toggle = (key: SortKey, numeric?: boolean) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" },
    );

  return (
    <Card title="Department comparison" description="Click a column header to sort." bodyClassName="p-0">
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !sorted.length ? (
        <EmptyState title="No departments in this view" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                {DEPT_COLUMNS.map((col) => {
                  const active = sort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={clsx(col.numeric && "text-right")}
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(col.key, col.numeric)}
                        className={clsx(
                          "inline-flex items-center gap-1 uppercase hover:text-slate-700",
                          col.numeric && "flex-row-reverse",
                        )}
                      >
                        {col.label}
                        {active ? (
                          sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sorted.map((r) => (
                <tr key={r.department_id}>
                  <td className="whitespace-nowrap">
                    <Link to={`/departments/${r.department_id}`} className="link">
                      {r.department}
                    </Link>
                  </td>
                  <Num value={r.total_audits} />
                  <Num value={r.completed_audits} />
                  <td className="text-right tabular-nums">
                    {r.compliance_score === null ? (
                      <span className="text-xs text-slate-400">No completed audits</span>
                    ) : (
                      <span className={clsx("font-semibold", scoreColor(r.compliance_score, target ?? 85))}>
                        {formatPercent(r.compliance_score)}
                      </span>
                    )}
                  </td>
                  <Num value={r.failed_checks} />
                  <Num value={r.open_findings} />
                  <Num value={r.critical_findings} danger />
                  <Num value={r.high_findings} warn />
                  <Num value={r.open_actions} />
                  <Num value={r.overdue_actions} danger />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Num({ value, danger, warn }: { value: number; danger?: boolean; warn?: boolean }) {
  return (
    <td
      className={clsx(
        "text-right tabular-nums",
        value > 0 && danger && "font-semibold text-red-600",
        value > 0 && warn && "font-semibold text-orange-600",
      )}
    >
      {value.toLocaleString()}
    </td>
  );
}

// ---------------------------------------------------------------- action owner dashboard

function ActionOwnerDashboard({ user }: { user: Me }) {
  const navigate = useNavigate();
  const listParams = { mine: true, open: true, page_size: 10, ordering: "due_date" };
  const myActions = useQuery({ queryKey: ["actions", listParams], queryFn: () => actionsApi.list(listParams) });

  const countQuery = (key: string, params: Record<string, string | number | boolean>) => ({
    queryKey: ["actions", { ...params, page_size: 1, _count: key }],
    queryFn: () => actionsApi.list({ ...params, page_size: 1 }),
  });
  const overdue = useQuery(countQuery("overdue", { mine: true, overdue: true }));
  const pending = useQuery(countQuery("pending", { mine: true, status: "PENDING_VERIFICATION" }));
  const rework = useQuery(countQuery("rework", { mine: true, status: "REWORK_REQUIRED" }));
  const findingParams = { owner: user.id, open: true, page_size: 1 };
  const myFindings = useQuery({ queryKey: ["findings", findingParams], queryFn: () => findingsApi.list(findingParams) });

  const count = (q: { data?: { count: number }; isLoading: boolean }) => (q.isLoading ? "—" : (q.data?.count ?? 0));

  return (
    <>
      <PageHeader
        title={greeting(user)}
        description={
          <>
            {user.organization?.name && <span className="font-medium text-slate-700">{user.organization.name} · </span>}
            Corrective actions assigned to you. Keep progress updated and submit for verification when done.
          </>
        }
        actions={
          <Button icon={<Wrench className="h-4 w-4" />} onClick={() => navigate("/actions?mine=true")}>
            All my actions
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="My open actions"
          value={count(myActions)}
          icon={<Wrench className="h-5 w-5" />}
          onClick={() => navigate("/actions?mine=true&open=true")}
        />
        <StatCard
          label="Overdue"
          value={count(overdue)}
          tone={(overdue.data?.count ?? 0) > 0 ? "danger" : "default"}
          icon={<AlertTriangle className="h-5 w-5" />}
          onClick={() => navigate("/actions?mine=true&overdue=true")}
        />
        <StatCard
          label="Rework required"
          value={count(rework)}
          tone={(rework.data?.count ?? 0) > 0 ? "warning" : "default"}
          icon={<Clock className="h-5 w-5" />}
          onClick={() => navigate("/actions?mine=true&status=REWORK_REQUIRED")}
        />
        <StatCard
          label="Awaiting verification"
          value={count(pending)}
          icon={<ClipboardCheck className="h-5 w-5" />}
          onClick={() => navigate("/actions?mine=true&status=PENDING_VERIFICATION")}
        />
        <StatCard
          label="Findings I own"
          value={count(myFindings)}
          hint="Open findings"
          icon={<FileSearch className="h-5 w-5" />}
          onClick={() => navigate(`/findings?open=true&owner=${user.id}`)}
        />
      </div>

      {(overdue.data?.count ?? 0) > 0 && (
        <div className="mb-4">
          <Notice tone="warning">
            You have {overdue.data!.count} overdue {overdue.data!.count === 1 ? "action" : "actions"}. Update progress or
            agree a new date with the action's verifier.
          </Notice>
        </div>
      )}

      <Card
        title="My actions"
        description="Open actions assigned to you, earliest due first."
        actions={
          <Link to="/actions?mine=true&open=true" className="link text-xs">
            View all
          </Link>
        }
        bodyClassName="p-0"
      >
        {myActions.isLoading ? (
          <LoadingState />
        ) : myActions.error ? (
          <ErrorState error={myActions.error} onRetry={() => myActions.refetch()} />
        ) : !myActions.data?.results.length ? (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6 text-green-600" />}
            title="Nothing open"
            description="You have no open corrective actions. New assignments will appear here and in your notifications."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Action</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {myActions.data.results.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/actions/${a.id}`)}>
                    <td className="whitespace-nowrap">
                      <Link to={`/actions/${a.id}`} className="link" onClick={(e) => e.stopPropagation()}>
                        {a.reference}
                      </Link>
                    </td>
                    <td>
                      <div className="min-w-[200px]">
                        <p className="font-medium text-slate-800">{a.title}</p>
                        <p className="text-xs text-slate-500">
                          {a.finding.reference} · {a.department.name}
                        </p>
                      </div>
                    </td>
                    <td>
                      <SeverityBadge severity={a.finding.severity} />
                    </td>
                    <td>
                      <PriorityBadge priority={a.priority} />
                    </td>
                    <td>
                      <ActionStatusBadge status={a.status} />
                    </td>
                    <td>
                      <div className="flex w-28 items-center gap-2">
                        <ProgressBar value={a.progress} className="flex-1" />
                        <span className="text-xs tabular-nums text-slate-500">{a.progress}%</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <span>{formatDate(a.due_date)}</span>
                        {a.is_overdue && <OverdueBadge />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

