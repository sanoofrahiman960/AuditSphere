// Chart building blocks shared by the dashboard and the department detail page.
// Every chart takes API data as-is and renders an explicit empty state when there is nothing to plot.
import { BarChart3 } from "lucide-react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import type { RiskCount, StatusCount, TrendPoint } from "@/types/api";
import { AUDIT_STATUS_COLORS, SEVERITY_COLORS } from "@/utils/format";

export const CHART_COLORS = {
  blue: "#2563eb",
  amber: "#f59e0b",
  green: "#16a34a",
  slate: "#94a3b8",
  grid: "#e2e8f0",
  axis: "#64748b",
};

export const AXIS_TICK = { fontSize: 12, fill: CHART_COLORS.axis };
export const TOOLTIP_STYLE = {
  contentStyle: { borderRadius: 8, borderColor: "#e2e8f0", fontSize: 12 },
  labelStyle: { color: "#0f172a", fontWeight: 600 },
};

/** "2026-03" → "Mar 2026", "2026-Q1" → "Q1 2026". */
export function formatPeriod(period: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[Number(month[2]) - 1] ?? month[2]} ${month[1]}`;
  }
  const quarter = /^(\d{4})-(Q\d)$/.exec(period);
  if (quarter) return `${quarter[2]} ${quarter[1]}`;
  return period;
}

export function ChartEmpty({ title = "No data to chart", description }: { title?: string; description?: ReactNode }) {
  return (
    <EmptyState
      className="py-10"
      icon={<BarChart3 className="h-6 w-6" />}
      title={title}
      description={description ?? "Nothing matches the current filters yet."}
    />
  );
}

/** Wraps a chart with loading / error / empty handling. */
export function ChartFrame({
  loading,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyDescription,
  height = 280,
  label,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  height?: number;
  label: string;
  children: ReactNode;
}) {
  if (loading) return <LoadingState className="py-16" />;
  if (error) return <ErrorState error={error} onRetry={onRetry} className="py-10" />;
  if (empty) return <ChartEmpty title={emptyTitle} description={emptyDescription} />;
  return (
    <figure aria-label={label} style={{ height }} className="w-full">
      {children}
    </figure>
  );
}

// ---------------------------------------------------------------- audit status donut
export function StatusDonut({
  data,
  loading,
  error,
  onRetry,
  height = 280,
}: {
  data: StatusCount[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  height?: number;
}) {
  const slices = (data ?? []).filter((d) => d.count > 0);
  const total = slices.reduce((sum, d) => sum + d.count, 0);
  return (
    <ChartFrame
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={slices.length === 0}
      emptyTitle="No audits in this view"
      height={height}
      label={`Audit status distribution: ${slices.map((s) => `${s.label} ${s.count}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="count"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={slices.length > 1 ? 2 : 0}
            stroke="#fff"
            isAnimationActive={false}
          >
            {slices.map((s) => (
              <Cell key={s.status} fill={AUDIT_STATUS_COLORS[s.status]} />
            ))}
            <Label
              position="center"
              content={(props) => {
                const vb = props.viewBox as { cx?: number; cy?: number } | undefined;
                if (vb?.cx === undefined || vb?.cy === undefined) return null;
                return (
                  <text x={vb.cx} y={vb.cy} textAnchor="middle" dominantBaseline="central">
                    <tspan x={vb.cx} dy="-0.5em" className="fill-slate-900" fontSize={22} fontWeight={600}>
                      {total}
                    </tspan>
                    <tspan x={vb.cx} dy="1.6em" className="fill-slate-500" fontSize={12}>
                      audits
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value) => {
              const n = Number(value);
              return [`${n} (${total ? Math.round((n * 100) / total) : 0}%)`, "Audits"];
            }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------- risk severity
export function RiskBars({
  data,
  loading,
  error,
  onRetry,
  height = 280,
}: {
  data: RiskCount[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  height?: number;
}) {
  const rows = data ?? [];
  const empty = rows.every((r) => r.total === 0 && r.open === 0);
  return (
    <ChartFrame
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={empty}
      emptyTitle="No findings recorded"
      height={height}
      label={`Findings by severity: ${rows.map((r) => `${r.label} ${r.open} open of ${r.total}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }} barGap={4}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }}>
            <Label value="Severity" position="insideBottom" offset={-4} style={AXIS_TICK} />
          </XAxis>
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44}>
            <Label value="Findings" angle={-90} position="insideLeft" style={{ ...AXIS_TICK, textAnchor: "middle" }} />
          </YAxis>
          <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "#f1f5f9" }} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
            payload={[
              { value: "Open (coloured by severity)", type: "square", id: "open", color: SEVERITY_COLORS.HIGH },
              { value: "Total (all statuses)", type: "square", id: "total", color: "#cbd5e1" },
            ]}
          />
          <Bar dataKey="open" name="Open" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.severity} fill={SEVERITY_COLORS[r.severity]} />
            ))}
          </Bar>
          <Bar dataKey="total" name="Total" fill="#cbd5e1" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------- completion trend
export function TrendChart({
  data,
  loading,
  error,
  onRetry,
  target,
  height = 300,
}: {
  data: TrendPoint[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  target?: number | null;
  height?: number;
}) {
  const rows = (data ?? []).map((p) => ({ ...p, periodLabel: formatPeriod(p.period) }));
  const empty = rows.every((p) => p.due === 0 && p.completed === 0 && p.compliance_score === null);
  return (
    <ChartFrame
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={empty}
      emptyTitle="No audits due or completed in this period"
      height={height}
      label="Audits due versus completed per period, with compliance score"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="periodLabel" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} />
          <YAxis yAxisId="count" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44}>
            <Label value="Audits" angle={-90} position="insideLeft" style={{ ...AXIS_TICK, textAnchor: "middle" }} />
          </YAxis>
          <YAxis
            yAxisId="score"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
          >
            <Label value="Compliance %" angle={90} position="insideRight" style={{ ...AXIS_TICK, textAnchor: "middle" }} />
          </YAxis>
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: "#f1f5f9" }}
            formatter={(value, name) =>
              name === "Compliance score"
                ? [value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`, name]
                : [value, name]
            }
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {target != null && (
            <ReferenceLine
              yAxisId="score"
              y={target}
              stroke={CHART_COLORS.amber}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: `Target ${target}%`, position: "insideTopRight", fontSize: 11, fill: "#b45309" }}
            />
          )}
          <Bar yAxisId="count" dataKey="due" name="Due" fill={CHART_COLORS.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar
            yAxisId="count"
            dataKey="completed"
            name="Completed"
            fill={CHART_COLORS.green}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="compliance_score"
            name="Compliance score"
            stroke={CHART_COLORS.amber}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
