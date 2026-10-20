import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, ClipboardCheck, ClipboardList, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import { useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { dashboardApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/States";
import type { MyWorkItem, MyWorkSection } from "@/types/api";
import { formatDate } from "@/utils/format";

const SECTION_ICONS: Record<MyWorkSection["key"], ComponentType<{ className?: string }>> = {
  perform: ClipboardCheck,
  review: ClipboardList,
  verify: ShieldCheck,
  my_actions: Wrench,
  department_overdue: TriangleAlert,
};

const KIND_LABEL: Record<MyWorkItem["kind"], { label: string; tone: "blue" | "orange" | "purple" | "teal" | "red" | "gray" }> = {
  audit: { label: "Perform", tone: "blue" },
  rework: { label: "Rework", tone: "orange" },
  review: { label: "Review", tone: "purple" },
  complete: { label: "Complete", tone: "teal" },
  verify: { label: "Verify", tone: "purple" },
  action: { label: "Action", tone: "gray" },
  overdue: { label: "Overdue", tone: "red" },
};

function itemLink(item: MyWorkItem): string {
  if (item.kind === "audit" || item.kind === "rework") return `/audits/${item.id}/workspace`;
  if (item.kind === "review" || item.kind === "complete") return `/audits/${item.id}`;
  return `/actions/${item.id}`;
}

function dueText(days: number) {
  if (days < 0) return { text: `${-days}d overdue`, className: "text-red-600 font-medium" };
  if (days === 0) return { text: "Due today", className: "text-amber-700 font-medium" };
  if (days <= 7) return { text: `Due in ${days}d`, className: "text-amber-700" };
  return { text: `Due in ${days}d`, className: "text-slate-500" };
}

const VIEW_ALL: Partial<Record<MyWorkSection["key"], string>> = {
  perform: "/audits?mine=true",
  review: "/audits?mine=true&status=SUBMITTED",
  verify: "/actions?status=PENDING_VERIFICATION",
  my_actions: "/actions?mine=true&open=true",
  department_overdue: "/actions?overdue=true",
};

/** The signed-in user's personal to-do list, shown at the top of the dashboard. */
export function MyWorkPanel() {
  const { data, isLoading, error } = useQuery({ queryKey: ["dashboard", "my-work"], queryFn: dashboardApi.myWork });
  const sections = (data?.sections ?? []).filter((s) => s.count > 0);
  const [active, setActive] = useState<MyWorkSection["key"] | null>(null);
  const current = sections.find((s) => s.key === active) ?? sections[0];

  if (error) return null; // the rest of the dashboard still works
  if (isLoading) {
    return (
      <div className="card mb-6 flex items-center gap-2 p-4 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading your work…
      </div>
    );
  }
  if (!data || data.total === 0) {
    return (
      <div className="card mb-6 flex items-center gap-3 p-4 text-sm text-slate-600">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        You're all caught up — nothing is waiting for you.
      </div>
    );
  }

  return (
    <section className="card mb-6" aria-labelledby="my-work-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h2 id="my-work-title" className="text-sm font-semibold text-slate-900">
          My work <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{data.total}</span>
        </h2>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Work categories">
          {sections.map((s) => {
            const Icon = SECTION_ICONS[s.key];
            const selected = current?.key === s.key;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(s.key)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition",
                  selected ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100",
                  !selected && s.key === "department_overdue" && "text-red-700",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.title}
                <span className={clsx("rounded-full px-1.5", selected ? "bg-white/20" : "bg-slate-100")}>{s.count}</span>
              </button>
            );
          })}
        </div>
      </header>
      {current && (
        <div role="tabpanel">
          <ul className="divide-y divide-slate-100">
            {current.items.map((item) => {
              const due = dueText(item.days_left);
              const kind = KIND_LABEL[item.kind];
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <Link to={itemLink(item)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 hover:bg-slate-50">
                    <Badge tone={kind.tone}>{kind.label}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        <span className="font-mono text-xs text-slate-500">{item.reference}</span> {item.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {item.department}
                        {item.owner && item.kind !== "action" ? ` · ${item.owner}` : ""}
                      </span>
                    </span>
                    {item.completion_percentage !== undefined && (
                      <span className="flex w-28 items-center gap-2 text-xs text-slate-500">
                        <ProgressBar value={item.completion_percentage} />
                        {item.completion_percentage}%
                      </span>
                    )}
                    {item.progress !== undefined && (
                      <span className="flex w-28 items-center gap-2 text-xs text-slate-500">
                        <ProgressBar value={item.progress} />
                        {item.progress}%
                      </span>
                    )}
                    <span className={clsx("w-28 text-right text-xs", due.className)} title={formatDate(item.due_date)}>
                      {due.text}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {current.count > current.items.length && VIEW_ALL[current.key] && (
            <div className="border-t border-slate-100 px-5 py-2 text-right">
              <Link to={VIEW_ALL[current.key]!} className="link text-xs">
                View all {current.count}
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
