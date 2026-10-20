import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { auditsApi } from "@/api/endpoints";
import { AuditStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { applyServerErrors, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import {
  AUDITOR_ROLES,
  REVIEWER_ROLES,
  useApprovedTemplateVersionOptions,
  useDepartmentOptions,
  useUserOptions,
} from "@/hooks/useLookups";
import type { AuditDetail, AuditType, AuditWrite, Priority } from "@/types/api";
import { AUDIT_TYPE_LABELS, PRIORITY_LABELS, options } from "@/utils/format";

const base = z.object({
  title: z.string().trim().min(3, "Enter a title of at least 3 characters").max(255),
  department: z.string().min(1, "Select a department"),
  template_version: z.string().min(1, "Select an approved template"),
  audit_type: z.string().min(1, "Select an audit type"),
  priority: z.string().min(1, "Select a priority"),
  period_start: z.string().optional(),
  period_end: z.string().optional(),
  planned_start_date: z.string().min(1, "Planned start date is required"),
  due_date: z.string().min(1, "Due date is required"),
  lead_auditor: z.string().optional(),
  reviewer: z.string().optional(),
  department_contact: z.string().optional(),
  team_member_ids: z.array(z.number()),
  scope: z.string().optional(),
  objectives: z.string().optional(),
});

const schema = base.superRefine((v, ctx) => {
  if (v.planned_start_date && v.due_date && v.due_date < v.planned_start_date) {
    ctx.addIssue({ code: "custom", path: ["due_date"], message: "Due date cannot be before the planned start date." });
  }
  if (v.period_start && v.period_end && v.period_end < v.period_start) {
    ctx.addIssue({ code: "custom", path: ["period_end"], message: "Period end cannot be before period start." });
  }
  if (v.lead_auditor && v.reviewer && v.lead_auditor === v.reviewer) {
    ctx.addIssue({ code: "custom", path: ["reviewer"], message: "The reviewer must be independent of the lead auditor." });
  }
  if (v.reviewer && v.team_member_ids.includes(Number(v.reviewer))) {
    ctx.addIssue({ code: "custom", path: ["team_member_ids"], message: "The reviewer cannot also be on the audit team." });
  }
});

type FormValues = z.infer<typeof schema>;
const FIELDS = Object.keys(base.shape);

const EMPTY: FormValues = {
  title: "",
  department: "",
  template_version: "",
  audit_type: "INTERNAL",
  priority: "MEDIUM",
  period_start: "",
  period_end: "",
  planned_start_date: "",
  due_date: "",
  lead_auditor: "",
  reviewer: "",
  department_contact: "",
  team_member_ids: [],
  scope: "",
  objectives: "",
};

function toFormValues(audit: AuditDetail): FormValues {
  return {
    title: audit.title,
    department: String(audit.department.id),
    template_version: String(audit.template.version_id),
    audit_type: audit.audit_type,
    priority: audit.priority,
    period_start: audit.period_start ?? "",
    period_end: audit.period_end ?? "",
    planned_start_date: audit.planned_start_date,
    due_date: audit.due_date,
    lead_auditor: audit.lead_auditor ? String(audit.lead_auditor.id) : "",
    reviewer: audit.reviewer ? String(audit.reviewer.id) : "",
    department_contact: audit.department_contact ? String(audit.department_contact.id) : "",
    team_member_ids: audit.team.filter((t) => t.is_active && t.assignment_role === "AUDITOR").map((t) => t.user.id),
    scope: audit.scope,
    objectives: audit.objectives,
  };
}

const optionalId = (value?: string) => (value ? Number(value) : null);

export default function AuditFormPage() {
  const { id } = useParams();
  const auditId = id ? Number(id) : null;
  const editing = auditId !== null;

  const auditQuery = useQuery({
    queryKey: ["audit", auditId],
    queryFn: () => auditsApi.get(auditId!),
    enabled: editing,
  });

  if (editing && auditQuery.isLoading) return <LoadingState />;
  if (editing && auditQuery.error) return <ErrorState error={auditQuery.error} onRetry={() => auditQuery.refetch()} />;
  return <AuditForm audit={editing ? auditQuery.data : undefined} />;
}

function AuditForm({ audit }: { audit?: AuditDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = !!audit;
  const structureLocked = !!audit && !["DRAFT", "SCHEDULED"].includes(audit.status);
  const canScheduleAfterSave = !audit || audit.status === "DRAFT";

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    getValues,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: audit ? toFormValues(audit) : EMPTY });

  useEffect(() => {
    if (audit) reset(toFormValues(audit));
  }, [audit, reset]);

  const department = watch("department");
  const templateVersion = watch("template_version");
  const lead = watch("lead_auditor");
  const reviewer = watch("reviewer");
  const team = watch("team_member_ids");
  const plannedStart = watch("planned_start_date");
  const periodStart = watch("period_start");

  const departments = useDepartmentOptions();
  const templates = useApprovedTemplateVersionOptions(department ? Number(department) : null);
  const auditors = useUserOptions(AUDITOR_ROLES);
  const reviewers = useUserOptions(REVIEWER_ROLES);
  const allUsers = useUserOptions();

  // Keep the audit's current department / template selectable even if it is no longer active or approved.
  const departmentChoices = useMemo(() => {
    const opts = departments.data ?? [];
    if (audit && !opts.some((o) => o.value === audit.department.id)) {
      return [{ value: audit.department.id, label: audit.department.name }, ...opts];
    }
    return opts;
  }, [departments.data, audit]);

  const templateChoices = useMemo(() => {
    const opts = templates.data ?? [];
    if (
      audit &&
      String(audit.department.id) === department &&
      !opts.some((o) => o.value === audit.template.version_id)
    ) {
      return [{ value: audit.template.version_id, label: `${audit.template.name} (v${audit.template.version})` }, ...opts];
    }
    return opts;
  }, [templates.data, audit, department]);

  // When the department changes, drop a template that does not apply to it.
  useEffect(() => {
    if (!templates.data || !templateVersion) return;
    if (!templateChoices.some((o) => String(o.value) === templateVersion)) {
      setValue("template_version", "", { shouldDirty: true });
    }
  }, [templates.data, templateChoices, templateVersion, setValue]);

  // The lead auditor is never also a co-auditor.
  useEffect(() => {
    if (lead && team.includes(Number(lead))) {
      setValue(
        "team_member_ids",
        team.filter((m) => m !== Number(lead)),
        { shouldDirty: true },
      );
    }
  }, [lead, team, setValue]);

  const coAuditorChoices = (auditors.data ?? []).filter((o) => String(o.value) !== lead);

  const toggleMember = (userId: number, checked: boolean) => {
    const current = getValues("team_member_ids");
    setValue("team_member_ids", checked ? [...current, userId] : current.filter((m) => m !== userId), {
      shouldDirty: true,
      shouldValidate: !!errors.team_member_ids,
    });
  };

  const mutation = useMutation({
    mutationFn: async ({ values, schedule }: { values: FormValues; schedule: boolean }) => {
      const payload: AuditWrite = {
        title: values.title.trim(),
        department: Number(values.department),
        template_version: Number(values.template_version),
        audit_type: values.audit_type as AuditType,
        priority: values.priority as Priority,
        period_start: values.period_start || null,
        period_end: values.period_end || null,
        planned_start_date: values.planned_start_date,
        due_date: values.due_date,
        lead_auditor: optionalId(values.lead_auditor),
        reviewer: optionalId(values.reviewer),
        department_contact: optionalId(values.department_contact),
        team_member_ids: values.team_member_ids.filter((m) => String(m) !== values.lead_auditor),
        scope: values.scope ?? "",
        objectives: values.objectives ?? "",
      };
      let saved: AuditDetail;
      if (audit) {
        const update: Partial<AuditWrite> = { ...payload };
        if (structureLocked) {
          delete update.department;
          delete update.template_version;
        }
        saved = await auditsApi.update(audit.id, update);
      } else {
        saved = await auditsApi.create(payload);
      }
      let scheduleError: unknown = null;
      if (schedule) {
        try {
          saved = await auditsApi.schedule(saved.id);
        } catch (err) {
          scheduleError = err;
        }
      }
      return { saved, scheduleError, scheduled: schedule && !scheduleError };
    },
    onSuccess: ({ saved, scheduleError, scheduled }) => {
      queryClient.setQueryData(["audit", saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ["audits"] });
      queryClient.invalidateQueries({ queryKey: ["audit", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["workspace", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (scheduleError) {
        toast.success(`Audit ${saved.reference} saved as draft`);
        toast.error(scheduleError);
      } else {
        toast.success(
          scheduled
            ? `Audit ${saved.reference} saved and scheduled`
            : editing
              ? `Audit ${saved.reference} updated`
              : `Audit ${saved.reference} created`,
        );
      }
      navigate(`/audits/${saved.id}`);
    },
    onError: (e) => {
      const err = toApiError(e);
      const unmatched = applyServerErrors(err.fieldErrors, setError as never, FIELDS);
      setFormError(unmatched ?? (Object.keys(err.fieldErrors).length ? null : err.message));
    },
  });

  const submit = (schedule: boolean) =>
    handleSubmit((values) => {
      setFormError(null);
      if (schedule) {
        let missing = false;
        if (!values.lead_auditor) {
          setError("lead_auditor", { type: "manual", message: "Required to schedule the audit." });
          missing = true;
        }
        if (!values.reviewer) {
          setError("reviewer", { type: "manual", message: "Required to schedule the audit." });
          missing = true;
        }
        if (missing) return;
      }
      mutation.mutate({ values, schedule });
    });

  const title = editing ? `Edit ${audit.reference}` : "New audit";
  const cancelTo = editing ? `/audits/${audit.id}` : "/audits";

  if (audit && !audit.permissions.can_edit) {
    return (
      <>
        <PageHeader
          title={title}
          breadcrumbs={[
            { label: "Audits", to: "/audits" },
            { label: audit.reference, to: `/audits/${audit.id}` },
            { label: "Edit" },
          ]}
        />
        <Card>
          <Notice tone="warning">
            This audit is {audit.status_display.toLowerCase()} and can no longer be edited.
            {audit.permissions.can_reopen ? " Reopen it first to make changes." : ""}
          </Notice>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => navigate(`/audits/${audit.id}`)}>
              Back to audit
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        description={
          editing ? audit.title : "Plan an audit from an approved checklist template and assign the audit team."
        }
        breadcrumbs={
          editing
            ? [
                { label: "Audits", to: "/audits" },
                { label: audit.reference, to: `/audits/${audit.id}` },
                { label: "Edit" },
              ]
            : [{ label: "Audits", to: "/audits" }, { label: "New audit" }]
        }
        meta={editing ? <AuditStatusBadge status={audit.status} /> : undefined}
      />

      <form
        className="space-y-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false)();
        }}
      >
        <InlineError message={formError} />

        <Card title="Audit details" description="What is being audited, against which checklist.">
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Title"
              required
              className="md:col-span-2"
              placeholder="e.g. Q3 procurement controls review"
              error={errors.title?.message}
              {...register("title")}
            />
            {structureLocked && audit ? (
              <>
                <Input label="Department" value={audit.department.name} disabled readOnly hint="Locked once the audit has started." />
                <Input
                  label="Checklist template"
                  value={`${audit.template.name} (v${audit.template.version})`}
                  disabled
                  readOnly
                  hint="Locked once the audit has started."
                />
              </>
            ) : (
              <>
                <Select
                  label="Department"
                  required
                  placeholder="Select department"
                  options={departmentChoices}
                  error={errors.department?.message}
                  {...register("department")}
                />
                <Select
                  label="Checklist template"
                  required
                  placeholder={
                    !department
                      ? "Select a department first"
                      : templates.isLoading
                        ? "Loading templates…"
                        : "Select approved template"
                  }
                  options={department ? templateChoices : []}
                  hint={
                    department && templates.data && templateChoices.length === 0
                      ? "No approved templates apply to this department."
                      : "Only approved template versions are listed."
                  }
                  error={errors.template_version?.message}
                  {...register("template_version")}
                />
              </>
            )}
            <Select
              label="Audit type"
              required
              options={options(AUDIT_TYPE_LABELS)}
              error={errors.audit_type?.message}
              {...register("audit_type")}
            />
            <Select
              label="Priority"
              required
              options={options(PRIORITY_LABELS)}
              error={errors.priority?.message}
              {...register("priority")}
            />
          </div>
        </Card>

        <Card title="Schedule" description="The period under review and when fieldwork happens.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Period start" type="date" error={errors.period_start?.message} {...register("period_start")} />
            <Input
              label="Period end"
              type="date"
              min={periodStart || undefined}
              error={errors.period_end?.message}
              {...register("period_end")}
            />
            <Input
              label="Planned start"
              type="date"
              required
              error={errors.planned_start_date?.message}
              {...register("planned_start_date")}
            />
            <Input
              label="Due date"
              type="date"
              required
              min={plannedStart || undefined}
              error={errors.due_date?.message}
              {...register("due_date")}
            />
          </div>
        </Card>

        <Card title="Audit team" description="The reviewer must be independent of the audit team.">
          <div className="grid gap-4 md:grid-cols-3">
            <Select
              label="Lead auditor"
              placeholder="Unassigned"
              options={auditors.data ?? []}
              hint="Required before scheduling."
              error={errors.lead_auditor?.message}
              {...register("lead_auditor")}
            />
            <Select
              label="Reviewer"
              placeholder="Unassigned"
              options={(reviewers.data ?? []).filter((o) => String(o.value) !== lead)}
              hint="Required before scheduling."
              error={errors.reviewer?.message}
              {...register("reviewer")}
            />
            <Select
              label="Department contact"
              placeholder="None"
              options={allUsers.data ?? []}
              error={errors.department_contact?.message}
              {...register("department_contact")}
            />
          </div>

          <Field label="Co-auditors" className="mt-4" error={errors.team_member_ids?.message}>
            {auditors.isLoading ? (
              <p className="text-sm text-slate-500">Loading auditors…</p>
            ) : coAuditorChoices.length === 0 ? (
              <p className="text-sm text-slate-500">No other auditors available.</p>
            ) : (
              <fieldset className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 p-2">
                <legend className="sr-only">Co-auditors</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {coAuditorChoices.map((option) => {
                    const userId = Number(option.value);
                    const isReviewer = String(userId) === reviewer;
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={team.includes(userId)}
                          disabled={isReviewer && !team.includes(userId)}
                          onChange={(e) => toggleMember(userId, e.target.checked)}
                        />
                        <span className="truncate">{option.label}</span>
                        {isReviewer && <span className="text-xs text-slate-400">(reviewer)</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </Field>
        </Card>

        <Card title="Scope & objectives">
          <div className="grid gap-4 md:grid-cols-2">
            <Textarea label="Scope" rows={5} placeholder="Processes, locations and systems in scope…" {...register("scope")} />
            <Textarea label="Objectives" rows={5} placeholder="What the audit aims to establish…" {...register("objectives")} />
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={() => navigate(cancelTo)} disabled={mutation.isPending}>
            Cancel
          </Button>
          {canScheduleAfterSave && (
            <Button
              variant="secondary"
              onClick={() => void submit(true)()}
              loading={mutation.isPending && mutation.variables?.schedule === true}
              disabled={mutation.isPending}
            >
              Save and schedule
            </Button>
          )}
          <Button
            type="submit"
            loading={mutation.isPending && mutation.variables?.schedule === false}
            disabled={mutation.isPending || (editing && !isDirty)}
          >
            {editing ? "Save changes" : "Create audit"}
          </Button>
        </div>
      </form>
    </>
  );
}
