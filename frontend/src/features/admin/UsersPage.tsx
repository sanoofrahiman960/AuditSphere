import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, FilterX, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { usersApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { applyServerErrors, Checkbox, Field, Input, Select } from "@/components/ui/Form";
import { Avatar } from "@/components/ui/Misc";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { InlineError, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { PAGE_SIZE, useDebounce, useListParams } from "@/hooks/useListParams";
import type { Capability, Role, User, UserWrite } from "@/types/api";
import { CAPABILITY_LABELS, ROLE_LABELS, ROLE_TONE, formatDateTime, options, timeAgo } from "@/utils/format";

const FILTERS = ["role", "is_active"];


// Mirrors backend/apps/accounts/roles.py (CAPABILITIES) — used for the reference panel only.
const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  SUPER_ADMIN: [
    "manage_users",
    "manage_settings",
    "manage_departments",
    "manage_templates",
    "manage_audits",
    "perform_audits",
    "review_audits",
    "manage_findings",
    "manage_actions",
    "verify_actions",
    "view_activity_logs",
    "view_reports",
    "use_ai",
  ],
  AUDIT_ADMIN: [
    "manage_departments",
    "manage_templates",
    "manage_audits",
    "perform_audits",
    "review_audits",
    "manage_findings",
    "manage_actions",
    "verify_actions",
    "view_activity_logs",
    "view_reports",
    "use_ai",
  ],
  AUDITOR: ["perform_audits", "manage_findings", "view_reports", "use_ai"],
  REVIEWER: ["review_audits", "manage_findings", "verify_actions", "view_reports", "use_ai"],
  DEPT_MANAGER: ["manage_actions", "view_reports", "use_ai"],
  ACTION_OWNER: [],
  EXECUTIVE: ["view_reports"],
};

const ROLE_SUMMARY: Record<Role, string> = {
  SUPER_ADMIN: "Full control of the organisation, including users, roles and organisation settings.",
  AUDIT_ADMIN: "Runs the audit programme: departments, templates, audit planning, reviews and the activity log.",
  AUDITOR: "Performs assigned audits, records responses and evidence, and raises findings.",
  REVIEWER: "Reviews submitted audits (approve or request rework) and verifies corrective actions.",
  DEPT_MANAGER: "Sees their departments' audits and findings and manages corrective actions for them.",
  ACTION_OWNER: "Works on corrective actions assigned to them: updates progress, comments and uploads evidence.",
  EXECUTIVE: "Read-only, organisation-wide view of dashboards and reports.",
};


// ---------------------------------------------------------------- password helpers

function passwordProblems(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (/^\d+$/.test(password)) return "The password cannot be entirely numeric.";
  return null;
}

function passwordStrength(password: string): { score: number; label: string; tone: string } {
  if (!password) return { score: 0, label: "", tone: "bg-slate-200" };
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (password.length < 10) score = Math.min(score, 1);
  const levels = [
    { label: "Too short", tone: "bg-red-500" },
    { label: "Weak", tone: "bg-red-500" },
    { label: "Fair", tone: "bg-amber-500" },
    { label: "Good", tone: "bg-lime-500" },
    { label: "Strong", tone: "bg-green-600" },
    { label: "Very strong", tone: "bg-green-700" },
  ];
  return { score, ...levels[score] };
}

function PasswordInput({
  label,
  value,
  onChange,
  error,
  required,
  showStrength,
  autoComplete = "new-password",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  showStrength?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  const id = `pw-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Field label={label} required={required} error={error} htmlFor={id} hint={hint}>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className={"input pr-10" + (error ? " input-error" : "")}
          autoComplete={autoComplete}
          value={value}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {showStrength && value && (
        <div className="mt-1.5 flex items-center gap-2" aria-live="polite">
          <div className="flex h-1.5 flex-1 gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={"h-full flex-1 rounded-full " + (i <= strength.score ? strength.tone : "bg-slate-200")} />
            ))}
          </div>
          <span className="w-20 text-right text-xs text-slate-500">{strength.label}</span>
        </div>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------- user form

const PASSWORD_HINT =
  "At least 10 characters, not entirely numeric, not a common password and not too similar to the user's name or email.";

const userSchema = z
  .object({
    mode: z.enum(["create", "edit"]),
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
    first_name: z.string().trim().min(1, "First name is required").max(150),
    last_name: z.string().trim().min(1, "Last name is required").max(150),
    role: z.string().min(1, "Choose a role"),
    job_title: z.string().max(150).optional(),
    phone: z.string().max(50).optional(),
    password: z.string().optional(),
    is_active: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const password = values.password ?? "";
    if (values.mode === "create" && !password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "An initial password is required." });
      return;
    }
    if (password) {
      const problem = passwordProblems(password);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: problem });
    }
  });
type UserFormValues = z.infer<typeof userSchema>;
const USER_FIELDS = ["email", "first_name", "last_name", "role", "job_title", "phone", "password", "is_active"];

function UserFormModal({ open, onClose, user }: { open: boolean; onClose: () => void; user?: User }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = !!user;
  const isSelf = editing && user!.id === me?.id;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UserFormValues>({ resolver: zodResolver(userSchema) });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset({
      mode: editing ? "edit" : "create",
      email: user?.email ?? "",
      first_name: user?.first_name ?? "",
      last_name: user?.last_name ?? "",
      role: user?.role ?? "AUDITOR",
      job_title: user?.job_title ?? "",
      phone: user?.phone ?? "",
      password: "",
      is_active: user?.is_active ?? true,
    });
  }, [open, user, editing, reset]);

  const mutation = useMutation({
    mutationFn: (values: UserFormValues) => {
      const payload: Partial<UserWrite> = {
        email: values.email.trim().toLowerCase(),
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        job_title: values.job_title?.trim() ?? "",
        phone: values.phone?.trim() ?? "",
      };
      // The server refuses changes to your own role/active state; never send them for yourself.
      if (!isSelf) {
        payload.role = values.role as Role;
        payload.is_active = values.is_active;
      }
      if (values.password) payload.password = values.password;
      return editing ? usersApi.update(user!.id, payload) : usersApi.create(payload as UserWrite);
    },
    onSuccess: (saved) => {
      toast.success(editing ? `${saved.full_name} updated` : `${saved.full_name} can now sign in`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["lookup"] });
      onClose();
    },
    onError: (e) => {
      const err = toApiError(e);
      setFormError(
        applyServerErrors(err.fieldErrors, setError as never, USER_FIELDS) ??
          (Object.keys(err.fieldErrors).length ? null : err.message),
      );
    },
  });

  // The password uses a custom input (show/hide + strength), so register it without spreading props.
  useEffect(() => {
    register("password");
  }, [register]);

  const submit = handleSubmit((v) => mutation.mutate(v));
  const role = watch("role") as Role | undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${user!.full_name}` : "Add user"}
      description={editing ? user!.email : "The user signs in with this email and the initial password you set."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {editing ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <InlineError message={formError} />
        <Input label="Email" type="email" required autoComplete="off" error={errors.email?.message} {...register("email")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" required error={errors.first_name?.message} {...register("first_name")} />
          <Input label="Last name" required error={errors.last_name?.message} {...register("last_name")} />
          <Input label="Job title" error={errors.job_title?.message} {...register("job_title")} />
          <Input label="Phone" type="tel" error={errors.phone?.message} {...register("phone")} />
        </div>
        {isSelf ? (
          <Notice>
            You are editing your own account. Your role (<strong>{ROLE_LABELS[user!.role]}</strong>) and active status can
            only be changed by another Super Administrator.
          </Notice>
        ) : (
          <>
            <Select
              label="Role"
              required
              options={options(ROLE_LABELS)}
              error={errors.role?.message}
              hint={role ? ROLE_SUMMARY[role] : undefined}
              {...register("role")}
            />
            {editing && (
              <Checkbox
                label="Active"
                description="Inactive users cannot sign in. Their history and assignments are kept."
                {...register("is_active")}
              />
            )}
          </>
        )}
        <div className={editing ? "rounded-lg border border-slate-200 bg-slate-50 p-4" : undefined}>
          {editing && <p className="mb-2 text-sm font-medium text-slate-800">Set new password</p>}
          <PasswordInput
            label={editing ? "New password (optional)" : "Initial password"}
            required={!editing}
            showStrength
            value={watch("password") ?? ""}
            onChange={(v) => setValue("password", v, { shouldValidate: !!errors.password })}
            error={errors.password?.message}
            hint={editing ? `Leave empty to keep the current password. ${PASSWORD_HINT}` : PASSWORD_HINT}
          />
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- page

export default function UsersPage() {
  const { user: me } = useAuth();
  const list = useListParams(FILTERS, { ordering: "first_name" });
  const [searchInput, setSearchInput] = useState(list.search);
  const debouncedSearch = useDebounce(searchInput);
  const [modal, setModal] = useState<{ user?: User } | null>(null);
  const [showRoles, setShowRoles] = useState(false);

  useEffect(() => {
    if (debouncedSearch !== list.search) list.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ["users", list.params],
    queryFn: () => usersApi.list(list.params),
    placeholderData: (prev) => prev,
  });

  const columns: Column<User>[] = [
    {
      key: "name",
      header: "User",
      sortKey: "first_name",
      render: (u) => (
        <div className="flex min-w-[220px] items-center gap-3">
          <Avatar name={u.full_name || u.email} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium text-slate-800">
              {u.full_name || "—"}
              {u.id === me?.id && <Badge tone="blue">You</Badge>}
            </p>
            <p className="truncate text-xs text-slate-500">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortKey: "role",
      render: (u) => <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role] ?? u.role_display}</Badge>,
    },
    { key: "job", header: "Job title", render: (u) => u.job_title || <span className="text-slate-400">—</span> },
    {
      key: "departments",
      header: "Departments",
      render: (u) => <span className="tabular-nums">{u.department_ids.length}</span>,
    },
    {
      key: "login",
      header: "Last login",
      sortKey: "last_login",
      render: (u) =>
        u.last_login ? (
          <span title={formatDateTime(u.last_login)} className="whitespace-nowrap">
            {timeAgo(u.last_login)}
          </span>
        ) : (
          <span className="text-slate-400">Never</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => (u.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>),
    },
    {
      key: "edit",
      header: <span className="sr-only">Edit</span>,
      render: (u) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Pencil className="h-3.5 w-3.5" />}
          onClick={(e) => {
            e.stopPropagation();
            setModal({ user: u });
          }}
          aria-label={`Edit ${u.full_name}`}
        >
          Edit
        </Button>
      ),
    },
  ];

  const hasFilters = Object.keys(list.filters).length > 0 || !!list.search;

  return (
    <>
      <PageHeader
        title="Users"
        description="People in your organisation and what they can do. Users are never deleted — deactivate them instead."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Administration" }, { label: "Users" }]}
        actions={
          <>
            <Button variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setShowRoles((v) => !v)}>
              {showRoles ? "Hide role permissions" : "Role permissions"}
            </Button>
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setModal({})}>
              Add user
            </Button>
          </>
        }
      />

      {showRoles && (
        <Card
          className="mb-4"
          title="Role permissions"
          description="What each role can do. Department-level visibility is further limited by department membership."
        >
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <li key={role} className="rounded-lg border border-slate-200 p-3">
                <Badge tone={ROLE_TONE[role]}>{ROLE_LABELS[role]}</Badge>
                <p className="mt-2 text-sm text-slate-600">{ROLE_SUMMARY[role]}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {ROLE_CAPABILITIES[role].length ? (
                    ROLE_CAPABILITIES[role].map((cap) => (
                      <span key={cap} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                        {CAPABILITY_LABELS[cap]}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-500">Assigned corrective actions only</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="user-search">
            Search
          </label>
          <input
            id="user-search"
            type="search"
            className="input"
            placeholder="Name, email or job title…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          label="Role"
          placeholder="All roles"
          options={options(ROLE_LABELS)}
          value={list.filters.role ?? ""}
          onChange={(e) => list.setFilter("role", e.target.value)}
        />
        <Select
          label="Status"
          placeholder="Active and inactive"
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "Inactive" },
          ]}
          value={list.filters.is_active ?? ""}
          onChange={(e) => list.setFilter("is_active", e.target.value)}
        />
        {hasFilters && (
          <div className="flex items-end lg:col-span-4">
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

      <DataTable
        columns={columns}
        rows={query.data?.results}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        ordering={list.ordering}
        onOrderingChange={list.setOrdering}
        onRowClick={(u) => setModal({ user: u })}
        emptyTitle={hasFilters ? "No users match these filters" : "No users yet"}
        emptyDescription={hasFilters ? "Try clearing some filters." : undefined}
        pagination={{ page: list.page, pageSize: PAGE_SIZE, count: query.data?.count ?? 0, onPageChange: list.setPage }}
      />

      <div className="mt-4">
        <Notice>
          Role and status changes are recorded in the activity log. You cannot change your own role or deactivate your
          own account.
        </Notice>
      </div>

      <UserFormModal open={!!modal} onClose={() => setModal(null)} user={modal?.user} />
    </>
  );
}
