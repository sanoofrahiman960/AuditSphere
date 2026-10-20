import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { organizationApi } from "@/api/endpoints";
import { SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { applyServerErrors, Checkbox, Input } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, InlineError, LoadingState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import type { Organization, OrganizationSettings } from "@/types/api";
import { formatDateTime, timeAgo } from "@/utils/format";

/** "7, 3, 1" → [7, 3, 1]; null when any item is invalid. */
function parseDays(value: string): number[] | null {
  const parts = value
    .split(/[,\s;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const days: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 365) return null;
    days.push(n);
  }
  return Array.from(new Set(days)).sort((a, b) => b - a);
}

const daysField = z.string().refine((v) => parseDays(v) !== null, {
  message: "Enter whole numbers of days between 0 and 365, separated by commas (e.g. 7, 3, 1).",
});

const threshold = z.coerce
  .number({ invalid_type_error: "Enter a number" })
  .int("Use a whole number")
  .min(1, "Minimum is 1")
  .max(25, "Maximum is 25");

const schema = z
  .object({
    name: z.string().trim().min(1, "Organisation name is required").max(200),
    risk_critical_threshold: threshold,
    risk_high_threshold: threshold,
    risk_medium_threshold: threshold,
    compliance_target: z.coerce
      .number({ invalid_type_error: "Enter a number" })
      .int("Use a whole number")
      .min(0, "Minimum is 0")
      .max(100, "Maximum is 100"),
    audit_reminder_days: daysField,
    action_reminder_days: daysField,
    overdue_reminder_interval_days: z.coerce
      .number({ invalid_type_error: "Enter a number" })
      .int("Use a whole number")
      .min(1, "Minimum is 1 day")
      .max(365, "Maximum is 365 days"),
    allow_self_verification: z.boolean(),
    email_notifications_enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!(v.risk_critical_threshold > v.risk_high_threshold)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["risk_critical_threshold"],
        message: "Critical must be greater than High.",
      });
    }
    if (!(v.risk_high_threshold > v.risk_medium_threshold)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["risk_high_threshold"],
        message: "High must be greater than Medium.",
      });
    }
  });

type FormValues = z.infer<typeof schema>;
type FormInput = z.input<typeof schema>;
const FIELDS = Object.keys(schema.innerType().shape);

function toFormValues(org: Organization): FormInput {
  const s = org.settings;
  return {
    name: org.name,
    risk_critical_threshold: s.risk_critical_threshold,
    risk_high_threshold: s.risk_high_threshold,
    risk_medium_threshold: s.risk_medium_threshold,
    compliance_target: s.compliance_target,
    audit_reminder_days: s.audit_reminder_days.join(", "),
    action_reminder_days: s.action_reminder_days.join(", "),
    overdue_reminder_interval_days: s.overdue_reminder_interval_days,
    allow_self_verification: s.allow_self_verification,
    email_notifications_enabled: s.email_notifications_enabled,
  };
}

function RiskBands({ critical, high, medium }: { critical: number; high: number; medium: number }) {
  const valid =
    [critical, high, medium].every((n) => Number.isInteger(n) && n >= 1 && n <= 25) && critical > high && high > medium;
  if (!valid) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-amber-700">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Thresholds must satisfy Critical &gt; High &gt; Medium ≥ 1 (scores range 1–25).
      </p>
    );
  }
  const range = (from: number, to: number) => (from === to ? `${from}` : `${from}–${to}`);
  const bands = [
    { severity: "CRITICAL" as const, label: `score ≥ ${critical}`, width: 26 - critical },
    { severity: "HIGH" as const, label: range(high, critical - 1), width: critical - high },
    { severity: "MEDIUM" as const, label: range(medium, high - 1), width: high - medium },
    { severity: "LOW" as const, label: medium > 1 ? `score < ${medium}` : "none", width: medium - 1 },
  ];
  const colors = { CRITICAL: "bg-red-500", HIGH: "bg-orange-500", MEDIUM: "bg-amber-400", LOW: "bg-green-500" };
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
        {[...bands].reverse().map((b) =>
          b.width > 0 ? <span key={b.severity} className={colors[b.severity]} style={{ flexGrow: b.width }} /> : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-600">
        {bands.map((b) => (
          <li key={b.severity} className="flex items-center gap-1.5">
            <SeverityBadge severity={b.severity} />
            <span className="tabular-nums">{b.label}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Risk score = likelihood (1–5) × impact (1–5). Changing thresholds affects new and re-assessed findings.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["organization"], queryFn: organizationApi.get });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (query.data) reset(toFormValues(query.data));
  }, [query.data, reset]);

  const mutation = useMutation({
    mutationFn: (v: FormValues) => {
      const settings: Partial<OrganizationSettings> = {
        risk_critical_threshold: v.risk_critical_threshold,
        risk_high_threshold: v.risk_high_threshold,
        risk_medium_threshold: v.risk_medium_threshold,
        compliance_target: v.compliance_target,
        audit_reminder_days: parseDays(v.audit_reminder_days) ?? [],
        action_reminder_days: parseDays(v.action_reminder_days) ?? [],
        overdue_reminder_interval_days: v.overdue_reminder_interval_days,
        allow_self_verification: v.allow_self_verification,
        email_notifications_enabled: v.email_notifications_enabled,
      };
      return organizationApi.update({ name: v.name.trim(), settings });
    },
    onSuccess: (org) => {
      queryClient.setQueryData(["organization"], org);
      queryClient.invalidateQueries({ queryKey: ["risk-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setFormError(null);
      toast.success("Organisation settings saved");
    },
    onError: (e) => {
      const err = toApiError(e);
      setFormError(
        applyServerErrors(err.fieldErrors, setError as never, FIELDS) ??
          (Object.keys(err.fieldErrors).length ? null : err.message),
      );
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const org = query.data;
  const critical = Number(watch("risk_critical_threshold"));
  const high = Number(watch("risk_high_threshold"));
  const medium = Number(watch("risk_medium_threshold"));
  const selfVerification = watch("allow_self_verification");
  const submit = handleSubmit((v) => mutation.mutate(v));

  return (
    <>
      <PageHeader
        title="Organisation Settings"
        description="Risk scoring, compliance targets and reminder schedules for the whole organisation."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Administration" }, { label: "Settings" }]}
        meta={
          <span className="text-xs text-slate-500" title={formatDateTime(org.settings.updated_at)}>
            Last updated {timeAgo(org.settings.updated_at)} · {formatDateTime(org.settings.updated_at)}
          </span>
        }
      />

      <form onSubmit={submit} noValidate className="space-y-6">
        <InlineError message={formError} />

        <Card title="Organisation">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Organisation name" required error={errors.name?.message} {...register("name")} />
            <Input label="Identifier" value={org.slug} readOnly disabled hint="Used internally; cannot be changed." />
          </div>
        </Card>

        <Card
          title="Risk thresholds"
          description="Minimum risk score (likelihood × impact) for each severity. Must satisfy Critical > High > Medium ≥ 1."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Critical from"
              type="number"
              min={1}
              max={25}
              required
              error={errors.risk_critical_threshold?.message}
              {...register("risk_critical_threshold")}
            />
            <Input
              label="High from"
              type="number"
              min={1}
              max={25}
              required
              error={errors.risk_high_threshold?.message}
              {...register("risk_high_threshold")}
            />
            <Input
              label="Medium from"
              type="number"
              min={1}
              max={25}
              required
              error={errors.risk_medium_threshold?.message}
              {...register("risk_medium_threshold")}
            />
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <RiskBands critical={critical} high={high} medium={medium} />
          </div>
        </Card>

        <Card title="Compliance & reminders">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Compliance target (%)"
              type="number"
              min={0}
              max={100}
              required
              error={errors.compliance_target?.message}
              hint="Scores at or above this are shown as on target on dashboards."
              {...register("compliance_target")}
            />
            <Input
              label="Overdue reminder interval (days)"
              type="number"
              min={1}
              max={365}
              required
              error={errors.overdue_reminder_interval_days?.message}
              hint="Repeat reminders for overdue corrective actions every N days."
              {...register("overdue_reminder_interval_days")}
            />
            <Input
              label="Audit reminder days"
              placeholder="e.g. 7, 3, 1"
              error={errors.audit_reminder_days?.message}
              hint="Days before an audit's due date to remind the team. Comma-separated, 0–365."
              {...register("audit_reminder_days")}
            />
            <Input
              label="Corrective action reminder days"
              placeholder="e.g. 7, 3, 1"
              error={errors.action_reminder_days?.message}
              hint="Days before an action's due date to remind its owner. Comma-separated, 0–365."
              {...register("action_reminder_days")}
            />
          </div>
        </Card>

        <Card title="Controls & notifications">
          <div className="space-y-4">
            <div>
              <Checkbox
                label="Allow self-verification of corrective actions"
                description="Lets an action owner verify the effectiveness of their own corrective action."
                {...register("allow_self_verification")}
              />
              {selfVerification && (
                <p className="ml-6 mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  This weakens segregation of duties: the same person can implement and sign off a fix. Most audit
                  frameworks expect independent verification.
                </p>
              )}
            </div>
            <Checkbox
              label="Send email notifications"
              description="When off, notifications are only shown in the app. Users can also tune their own preferences."
              {...register("email_notifications_enabled")}
            />
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {isDirty && <span className="text-xs text-amber-700">You have unsaved changes.</span>}
          <Button variant="secondary" onClick={() => reset(toFormValues(org))} disabled={!isDirty || mutation.isPending}>
            Reset
          </Button>
          <Button type="submit" icon={<Save className="h-4 w-4" />} loading={mutation.isPending} disabled={!isDirty}>
            Save settings
          </Button>
        </div>
      </form>
    </>
  );
}
