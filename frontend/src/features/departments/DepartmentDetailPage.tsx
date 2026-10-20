import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  Pencil,
  Power,
  PowerOff,
  ShieldAlert,
  Timer,
  UserPlus,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { auditsApi, departmentsApi, templatesApi } from "@/api/endpoints";
import { AuditStatusBadge, Badge, OverdueBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, DetailList, StatCard } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { Avatar, ProgressBar, Tabs } from "@/components/ui/Misc";
import { ConfirmDialog } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useUserOptions } from "@/hooks/useLookups";
import { useAuth } from "@/features/auth/AuthContext";
import { RiskBars, StatusDonut, TrendChart } from "@/features/dashboard/charts";
import type { AuditListItem, AuditTemplate, Department, DepartmentMembership } from "@/types/api";
import { ROLE_LABELS, formatDate, formatDateTime, formatPercent, scoreColor } from "@/utils/format";
import { DepartmentFormModal, DepartmentStatusDialog, invalidateDepartments } from "./DepartmentFormModal";

type TabId = "overview" | "members" | "audits" | "templates";
const TAB_IDS: TabId[] = ["overview", "members", "audits", "templates"];

export default function DepartmentDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const { can } = useAuth();
  const canManage = can("manage_departments");
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TabId | null;
  const tab: TabId = tabParam && TAB_IDS.includes(tabParam) ? tabParam : "overview";
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState<Department | null>(null);

  const dept = useQuery({
    queryKey: ["department", id],
    queryFn: () => departmentsApi.get(id),
    enabled: Number.isFinite(id) && id > 0,
  });

  const setTab = (next: TabId) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "overview") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  if (!Number.isFinite(id) || id <= 0) {
    return <ErrorState error={new Error("Invalid department link.")} />;
  }
  if (dept.isLoading) return <LoadingState />;
  if (dept.error || !dept.data) {
    return (
      <>
        <PageHeader title="Department" breadcrumbs={[{ label: "Departments", to: "/departments" }, { label: "Department" }]} />
        <div className="card">
          <ErrorState error={dept.error} onRetry={() => dept.refetch()} />
        </div>
      </>
    );
  }

  const d = dept.data;

  return (
    <>
      <PageHeader
        title={d.name}
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Departments", to: "/departments" }, { label: d.name }]}
        meta={
          <>
            {d.code && <Badge tone="indigo">{d.code}</Badge>}
            {d.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
            {d.manager_detail && <span className="text-xs text-slate-500">Managed by {d.manager_detail.full_name}</span>}
          </>
        }
        actions={
          canManage ? (
            <>
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant={d.is_active ? "secondary" : "success"}
                className={d.is_active ? "text-red-600" : undefined}
                icon={d.is_active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                onClick={() => setToggling(d)}
              >
                {d.is_active ? "Deactivate" : "Activate"}
              </Button>
            </>
          ) : undefined
        }
      />

      {!d.is_active && (
        <div className="mb-4">
          <Notice tone="warning">This department is inactive. Its history is kept, but it is not available for new audits.</Notice>
        </div>
      )}

      <Tabs<TabId>
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "members", label: "Members", count: d.member_count },
          { id: "audits", label: "Audits", count: d.audit_count },
          { id: "templates", label: "Templates" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" && <OverviewTab department={d} />}
      {tab === "members" && <MembersTab department={d} canManage={canManage} />}
      {tab === "audits" && <AuditsTab departmentId={d.id} />}
      {tab === "templates" && <TemplatesTab departmentId={d.id} />}

      {canManage && (
        <>
          <DepartmentFormModal open={editing} department={d} onClose={() => setEditing(false)} />
          <DepartmentStatusDialog department={toggling} onClose={() => setToggling(null)} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- overview

function OverviewTab({ department }: { department: Department }) {
  const navigate = useNavigate();
  const stats = useQuery({
    queryKey: ["department-stats", department.id],
    queryFn: () => departmentsApi.stats(department.id),
  });
  const s = stats.data?.summary;
  const target = s?.compliance_target ?? null;
  const score = s?.compliance_score ?? null;
  const num = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());
  const go = (path: string) => () => navigate(`${path}${path.includes("?") ? "&" : "?"}department=${department.id}`);

  const scoreTone: "default" | "success" | "warning" | "danger" =
    score === null ? "default" : score >= (target ?? 85) ? "success" : score >= (target ?? 85) - 15 ? "warning" : "danger";

  return (
    <div className="space-y-6">
      <Card title="Details">
        <DetailList
          columns={3}
          items={[
            {
              label: "Description",
              value: department.description ? (
                <span className="whitespace-pre-line">{department.description}</span>
              ) : (
                <span className="text-slate-400">No description</span>
              ),
            },
            {
              label: "Manager",
              value: department.manager_detail ? (
                <span className="flex items-center gap-2">
                  <Avatar name={department.manager_detail.full_name} className="h-6 w-6 text-[10px]" />
                  <span>
                    {department.manager_detail.full_name}
                    <span className="block text-xs text-slate-500">{department.manager_detail.email}</span>
                  </span>
                </span>
              ) : (
                <span className="text-slate-400">Not assigned</span>
              ),
            },
            { label: "Code", value: department.code || "—" },
            { label: "Members", value: department.member_count },
            { label: "Created", value: formatDateTime(department.created_at) },
            { label: "Last updated", value: formatDateTime(department.updated_at) },
          ]}
        />
      </Card>

      {stats.error ? (
        <div className="card">
          <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Compliance score"
            value={
              stats.isLoading ? "—" : <span className={scoreColor(score, target ?? 85)}>{score === null ? "—" : formatPercent(score)}</span>
            }
            hint={
              score === null
                ? "No approved or completed audits yet"
                : target !== null
                  ? `Target ${target}% · ${s?.failed_checks ?? 0} failed checks`
                  : `${s?.failed_checks ?? 0} failed checks`
            }
            tone={scoreTone}
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
          <StatCard label="Total audits" value={num(s?.total_audits)} icon={<ClipboardList className="h-5 w-5" />} onClick={go("/audits")} />
          <StatCard
            label="Completed audits"
            value={num(s?.completed_audits)}
            hint={s ? `${s.in_progress_audits} in progress · ${s.awaiting_review_audits} in review` : undefined}
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
          <StatCard label="Open findings" value={num(s?.open_findings)} icon={<FileSearch className="h-5 w-5" />} onClick={go("/findings?open=true")} />
          <StatCard
            label="Critical & high findings"
            value={num(s?.critical_high_findings)}
            tone={s && s.critical_high_findings > 0 ? "danger" : "default"}
            icon={<ShieldAlert className="h-5 w-5" />}
            onClick={go("/findings?open=true&ordering=-risk_score")}
          />
          <StatCard label="Open actions" value={num(s?.open_actions)} icon={<Wrench className="h-5 w-5" />} onClick={go("/actions?open=true")} />
          <StatCard
            label="Overdue actions"
            value={num(s?.overdue_actions)}
            tone={s && s.overdue_actions > 0 ? "danger" : "default"}
            icon={<AlertTriangle className="h-5 w-5" />}
            onClick={go("/actions?overdue=true")}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Audit status distribution">
          <StatusDonut data={stats.data?.status_distribution} loading={stats.isLoading} error={stats.error} height={240} />
        </Card>
        <Card title="Risk severity distribution" description="Open versus all findings, by severity.">
          <RiskBars data={stats.data?.risk_distribution} loading={stats.isLoading} error={stats.error} height={240} />
        </Card>
      </div>
      <Card title="Six-month completion trend" description="Audits due versus completed (left axis) and compliance score (right axis).">
        <TrendChart data={stats.data?.trend} loading={stats.isLoading} error={stats.error} target={target} height={280} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- members

function MembersTab({ department, canManage }: { department: Department; canManage: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const users = useUserOptions();
  const [userId, setUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"MEMBER" | "MANAGER">("MEMBER");
  const [removing, setRemoving] = useState<DepartmentMembership | null>(null);

  const members = useQuery({
    queryKey: ["department-members", department.id],
    queryFn: () => departmentsApi.members(department.id),
  });

  const add = useMutation({
    mutationFn: () => departmentsApi.addMember(department.id, Number(userId), memberRole),
    onSuccess: (m) => {
      toast.success(`${m.user_detail.full_name} added as ${m.member_role === "MANAGER" ? "manager" : "member"}`);
      setUserId("");
      setMemberRole("MEMBER");
      invalidateDepartments(queryClient, department.id);
    },
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: (m: DepartmentMembership) => departmentsApi.removeMember(department.id, m.id),
    onSuccess: (_, m) => {
      toast.success(`${m.user_detail.full_name} removed from ${department.name}`);
      setRemoving(null);
      invalidateDepartments(queryClient, department.id);
    },
    onError: (e) => toast.error(e),
  });

  const memberIds = new Set((members.data ?? []).map((m) => m.user));
  const available = (users.data ?? []).filter((o) => !memberIds.has(o.value));

  const columns: Column<DepartmentMembership>[] = [
    {
      key: "user",
      header: "User",
      render: (m) => (
        <div className="flex items-center gap-3">
          <Avatar name={m.user_detail.full_name} />
          <div className="min-w-0">
            <p className="font-medium text-slate-800">{m.user_detail.full_name}</p>
            <p className="text-xs text-slate-500">
              {m.user_detail.email}
              {m.user_detail.job_title ? ` · ${m.user_detail.job_title}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role in department",
      render: (m) => (m.member_role === "MANAGER" ? <Badge tone="blue">Manager</Badge> : <Badge>Member</Badge>),
    },
    { key: "app-role", header: "Application role", render: (m) => ROLE_LABELS[m.user_detail.role] ?? m.user_detail.role },
    { key: "since", header: "Member since", render: (m) => formatDate(m.created_at) },
  ];
  if (canManage) {
    columns.push({
      key: "remove",
      header: <span className="sr-only">Actions</span>,
      headerClassName: "w-px",
      render: (m) => (
        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setRemoving(m)}>
          Remove
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <Card title="Add member" description="Department managers can see the department's audits, findings and actions.">
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (userId) add.mutate();
            }}
          >
            <Select
              label="User"
              placeholder={users.isLoading ? "Loading users…" : available.length ? "Select a user" : "All active users are members"}
              options={available}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
            <Select
              label="Role in department"
              options={[
                { value: "MEMBER", label: "Member" },
                { value: "MANAGER", label: "Manager" },
              ]}
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as "MEMBER" | "MANAGER")}
            />
            <Button type="submit" icon={<UserPlus className="h-4 w-4" />} loading={add.isPending} disabled={!userId}>
              Add member
            </Button>
          </form>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={members.data}
        loading={members.isLoading}
        error={members.error}
        onRetry={() => members.refetch()}
        emptyTitle="No members yet"
        emptyDescription={canManage ? "Add people who work in this department." : "No one has been added to this department."}
      />

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        tone="danger"
        title="Remove member?"
        confirmLabel="Remove"
        message={
          <>
            <strong>{removing?.user_detail.full_name}</strong> will lose department-based access to {department.name}.
            {removing && department.manager === removing.user && " They are the department manager, so the department will have no manager."}
          </>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- audits

function AuditsTab({ departmentId }: { departmentId: number }) {
  const navigate = useNavigate();
  const params = { department: departmentId, page_size: 50, ordering: "-due_date" };
  const audits = useQuery({ queryKey: ["audits", params], queryFn: () => auditsApi.list(params) });

  const columns: Column<AuditListItem>[] = [
    {
      key: "reference",
      header: "Reference",
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
        <div className="min-w-[200px]">
          <p className="font-medium text-slate-800">{a.title}</p>
          <p className="text-xs text-slate-500">{a.template.name}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <div className="flex flex-wrap gap-1">
          <AuditStatusBadge status={a.status} />
          {a.is_overdue && <OverdueBadge />}
        </div>
      ),
    },
    { key: "lead", header: "Lead auditor", render: (a) => a.lead_auditor?.full_name ?? <span className="text-slate-400">—</span> },
    { key: "due", header: "Due", render: (a) => <span className="whitespace-nowrap">{formatDate(a.due_date)}</span> },
    {
      key: "progress",
      header: "Progress",
      render: (a) => (
        <div className="flex w-28 items-center gap-2">
          <ProgressBar value={a.completion_percentage} className="flex-1" />
          <span className="text-xs tabular-nums text-slate-500">{a.completion_percentage}%</span>
        </div>
      ),
    },
    {
      key: "score",
      header: "Score",
      render: (a) =>
        a.compliance_score === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className={clsx("font-semibold tabular-nums", scoreColor(Number(a.compliance_score)))}>
            {formatPercent(a.compliance_score)}
          </span>
        ),
    },
    { key: "findings", header: "Findings", className: "tabular-nums", render: (a) => a.findings_count },
  ];

  const count = audits.data?.count ?? 0;
  const shown = audits.data?.results.length ?? 0;

  return (
    <div className="space-y-3">
      {count > shown && (
        <p className="text-sm text-slate-600">
          Showing the {shown} most recent of {count} audits.{" "}
          <Link to={`/audits?department=${departmentId}`} className="link">
            View all in the audit register
          </Link>
        </p>
      )}
      <DataTable
        columns={columns}
        rows={audits.data?.results}
        loading={audits.isLoading}
        error={audits.error}
        onRetry={() => audits.refetch()}
        onRowClick={(a) => navigate(`/audits/${a.id}`)}
        emptyTitle="No audits for this department"
        emptyDescription="Audits planned for this department will appear here."
      />
    </div>
  );
}

// ---------------------------------------------------------------- templates

function TemplatesTab({ departmentId }: { departmentId: number }) {
  const navigate = useNavigate();
  const params = { department: departmentId, page_size: 100 };
  const templates = useQuery({ queryKey: ["templates", params], queryFn: () => templatesApi.list(params) });

  const columns: Column<AuditTemplate>[] = [
    {
      key: "name",
      header: "Template",
      render: (t) => (
        <div className="min-w-[200px]">
          <Link to={`/templates/${t.id}`} className="link" onClick={(e) => e.stopPropagation()}>
            {t.name}
          </Link>
          {t.description && <p className="line-clamp-1 text-xs text-slate-500">{t.description}</p>}
        </div>
      ),
    },
    { key: "category", header: "Category", render: (t) => t.category_name ?? <span className="text-slate-400">—</span> },
    {
      key: "version",
      header: "Approved version",
      render: (t) =>
        t.current_version ? (
          <span className="whitespace-nowrap">
            v{t.current_version.version}
            {t.current_version.applicable_standard && (
              <span className="text-xs text-slate-500"> · {t.current_version.applicable_standard}</span>
            )}
          </span>
        ) : (
          <Badge tone="amber">No approved version</Badge>
        ),
    },
    { key: "versions", header: "Versions", className: "tabular-nums", render: (t) => t.version_count },
    {
      key: "status",
      header: "Status",
      render: (t) => (t.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>),
    },
  ];

  return (
    <div className="space-y-3">
      <Notice>
        Templates listed here are specific to this department. Templates with no department apply to all departments —
        see the{" "}
        <Link to="/templates" className="link">
          template library
        </Link>
        .
      </Notice>
      <DataTable
        columns={columns}
        rows={templates.data?.results}
        loading={templates.isLoading}
        error={templates.error}
        onRetry={() => templates.refetch()}
        onRowClick={(t) => navigate(`/templates/${t.id}`)}
        emptyTitle="No department-specific templates"
        emptyDescription="This department uses the organisation-wide templates."
      />
    </div>
  );
}
