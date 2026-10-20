import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { actionsApi } from "@/api/endpoints";
import { Button } from "@/components/ui/Button";
import { applyServerErrors, Input, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { InlineError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useUserOptions } from "@/hooks/useLookups";
import type { ActionType, CorrectiveActionDetail, Priority } from "@/types/api";
import { PRIORITY_LABELS, isoDate, options } from "@/utils/format";

const schema = z.object({
  title: z.string().trim().min(3, "Title is required").max(255),
  description: z.string().trim().min(1, "Describe the action"),
  action_type: z.enum(["CORRECTIVE", "PREVENTIVE"]),
  owner: z.string().min(1, "Choose an owner"),
  due_date: z.string().min(1, "Due date is required"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});
type FormValues = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

/**
 * Assign a new corrective/preventive action to a finding (pass findingId), or edit the
 * planning fields of an existing action (pass action; requires permissions.can_edit_all_fields).
 */
export function ActionFormModal({
  open,
  onClose,
  findingId,
  findingTitle,
  defaultDescription,
  action,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  findingId?: number;
  findingTitle?: string;
  defaultDescription?: string;
  action?: CorrectiveActionDetail;
  onSaved?: (action: CorrectiveActionDetail) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const owners = useUserOptions();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = !!action;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    const inThirtyDays = new Date();
    inThirtyDays.setDate(inThirtyDays.getDate() + 30);
    reset(
      action
        ? {
            title: action.title,
            description: action.description,
            action_type: action.action_type,
            owner: String(action.owner.id),
            due_date: action.due_date,
            priority: action.priority,
          }
        : {
            title: "",
            description: defaultDescription ?? "",
            action_type: "CORRECTIVE",
            owner: "",
            due_date: isoDate(inThirtyDays),
            priority: "MEDIUM",
          },
    );
  }, [open, action, defaultDescription, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        ...values,
        owner: Number(values.owner),
        action_type: values.action_type as ActionType,
        priority: values.priority as Priority,
      };
      return editing ? actionsApi.update(action!.id, payload) : actionsApi.create({ ...payload, finding: findingId });
    },
    onSuccess: (saved) => {
      toast.success(editing ? "Action updated" : `Action ${saved.reference} assigned to ${saved.owner.full_name}`);
      queryClient.invalidateQueries({ queryKey: ["actions"] });
      queryClient.invalidateQueries({ queryKey: ["action", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["finding"] });
      queryClient.invalidateQueries({ queryKey: ["findings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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
      title={editing ? `Edit action ${action!.reference}` : "Assign corrective action"}
      description={findingTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit((v) => mutation.mutate(v))} loading={mutation.isPending}>
            {editing ? "Save changes" : "Assign action"}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
        <InlineError message={formError} />
        <Input label="Title" required error={errors.title?.message} {...register("title")} />
        <Textarea label="Action description" required rows={3} error={errors.description?.message} {...register("description")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            options={[
              { value: "CORRECTIVE", label: "Corrective — fix the issue" },
              { value: "PREVENTIVE", label: "Preventive — stop recurrence" },
            ]}
            {...register("action_type")}
          />
          <Select label="Priority" options={options(PRIORITY_LABELS)} {...register("priority")} />
          <Select
            label="Owner"
            required
            placeholder="Choose an owner"
            options={owners.data ?? []}
            error={errors.owner?.message}
            {...register("owner")}
          />
          <Input label="Due date" type="date" required error={errors.due_date?.message} {...register("due_date")} />
        </div>
      </form>
    </Modal>
  );
}
