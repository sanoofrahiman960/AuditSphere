import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { findingsApi } from "@/api/endpoints";
import { SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { applyServerErrors, Input, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { InlineError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useUserOptions } from "@/hooks/useLookups";
import type { FindingDetail, RiskCategory } from "@/types/api";
import { IMPACT_LABELS, LIKELIHOOD_LABELS, RISK_CATEGORY_LABELS, options, severityForScore } from "@/utils/format";

const schema = z.object({
  title: z.string().trim().min(3, "Give the finding a short title").max(255),
  description: z.string().trim().min(1, "Describe the finding"),
  expected_requirement: z.string().optional(),
  observed_condition: z.string().optional(),
  root_cause: z.string().optional(),
  business_impact: z.string().optional(),
  risk_category: z.string(),
  likelihood: z.coerce.number().int().min(1).max(5),
  impact: z.coerce.number().int().min(1).max(5),
  owner: z.string().optional(),
  recommended_action: z.string().optional(),
  target_date: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

const SCALE = LIKELIHOOD_LABELS.map((label, i) => ({ value: i + 1, label: `${i + 1} — ${label}` }));
const IMPACT_SCALE = IMPACT_LABELS.map((label, i) => ({ value: i + 1, label: `${i + 1} — ${label}` }));

/**
 * Create a finding for an audit (optionally linked to a checklist question), or edit an existing one.
 * Create: pass auditId (+ question). Edit: pass finding.
 */
export function FindingFormModal({
  open,
  onClose,
  auditId,
  question,
  finding,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  auditId?: number;
  question?: { id: number; code: string; text: string; guidance?: string; risk_category?: RiskCategory } | null;
  finding?: FindingDetail;
  onSaved?: (finding: FindingDetail) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const owners = useUserOptions();
  const [formError, setFormError] = useState<string | null>(null);
  const { data: matrix } = useQuery({ queryKey: ["risk-matrix"], queryFn: findingsApi.riskMatrix, staleTime: 10 * 60_000 });
  const editing = !!finding;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset(
      finding
        ? {
            title: finding.title,
            description: finding.description,
            expected_requirement: finding.expected_requirement,
            observed_condition: finding.observed_condition,
            root_cause: finding.root_cause,
            business_impact: finding.business_impact,
            risk_category: finding.risk_category,
            likelihood: finding.likelihood,
            impact: finding.impact,
            owner: finding.owner ? String(finding.owner.id) : "",
            recommended_action: finding.recommended_action,
            target_date: finding.target_date ?? "",
          }
        : {
            title: question ? `Control exception: ${question.text.slice(0, 120)}` : "",
            description: "",
            expected_requirement: question?.guidance ?? "",
            observed_condition: "",
            root_cause: "",
            business_impact: "",
            risk_category: question?.risk_category ?? "COMPLIANCE",
            likelihood: 3,
            impact: 3,
            owner: "",
            recommended_action: "",
            target_date: "",
          },
    );
    // Reset only when the modal opens or the target changes — not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, finding?.id, question?.id, reset]);

  const likelihood = Number(watch("likelihood") || 3);
  const impact = Number(watch("impact") || 3);
  const score = likelihood * impact;

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        ...values,
        risk_category: values.risk_category as RiskCategory,
        owner: values.owner ? Number(values.owner) : null,
        target_date: values.target_date || null,
      };
      return editing
        ? findingsApi.update(finding!.id, payload)
        : findingsApi.create({ ...payload, audit: auditId, question: question?.id ?? null });
    },
    onSuccess: (saved) => {
      toast.success(editing ? "Finding updated" : `Finding ${saved.reference} recorded`);
      queryClient.invalidateQueries({ queryKey: ["findings"] });
      queryClient.invalidateQueries({ queryKey: ["finding", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["finding-history", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => {
      const err = toApiError(e);
      setFormError(applyServerErrors(err.fieldErrors, setError as never, FIELDS) ?? (Object.keys(err.fieldErrors).length ? null : err.message));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit finding ${finding!.reference}` : "Record finding"}
      description={question ? `${question.code ? `${question.code} · ` : ""}${question.text}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit((v) => mutation.mutate(v))} loading={mutation.isPending}>
            {editing ? "Save changes" : "Record finding"}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
        <InlineError message={formError} />
        <Input label="Title" required error={errors.title?.message} {...register("title")} />
        <Textarea label="Description" required rows={3} error={errors.description?.message} {...register("description")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Textarea label="Expected requirement" rows={2} {...register("expected_requirement")} />
          <Textarea label="Observed condition" rows={2} {...register("observed_condition")} />
          <Textarea label="Root cause" rows={2} {...register("root_cause")} />
          <Textarea label="Business impact" rows={2} {...register("business_impact")} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Likelihood" options={SCALE} {...register("likelihood")} />
            <Select label="Impact" options={IMPACT_SCALE} {...register("impact")} />
            <Select label="Risk category" options={options(RISK_CATEGORY_LABELS)} {...register("risk_category")} />
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            Risk score <strong className="tabular-nums">{likelihood} × {impact} = {score}</strong>
            <span aria-hidden>→</span>
            <SeverityBadge severity={severityForScore(score, matrix)} />
            {editing && finding!.severity_overridden && (
              <span className="text-xs text-amber-700">Severity was overridden; saving new values recalculates it.</span>
            )}
          </p>
          {matrix && <p className="mt-1 text-xs text-slate-500">{matrix.explanation}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Responsible owner" placeholder="Unassigned" options={owners.data ?? []} {...register("owner")} />
          <Input label="Target resolution date" type="date" error={errors.target_date?.message} {...register("target_date")} />
        </div>
        <Textarea label="Recommended action" rows={2} {...register("recommended_action")} />
      </form>
    </Modal>
  );
}
