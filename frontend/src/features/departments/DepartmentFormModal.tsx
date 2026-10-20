import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { departmentsApi } from "@/api/endpoints";
import { Button } from "@/components/ui/Button";
import { applyServerErrors, Input, Select, Textarea } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { InlineError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useUserOptions } from "@/hooks/useLookups";
import type { Department } from "@/types/api";

const schema = z.object({
  name: z.string().trim().min(2, "Enter a department name").max(150),
  code: z.string().trim().max(20, "Use at most 20 characters").optional(),
  description: z.string().optional(),
  manager: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

/** Invalidate every cached view that shows department data. */
export function invalidateDepartments(queryClient: ReturnType<typeof useQueryClient>, id?: number) {
  queryClient.invalidateQueries({ queryKey: ["departments"] });
  queryClient.invalidateQueries({ queryKey: ["lookup", "departments"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  if (id) {
    queryClient.invalidateQueries({ queryKey: ["department", id] });
    queryClient.invalidateQueries({ queryKey: ["department-members", id] });
  }
}

/** Create a department, or edit one when `department` is given. */
export function DepartmentFormModal({
  open,
  onClose,
  department,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  department?: Department | null;
  onSaved?: (department: Department) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const users = useUserOptions();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = !!department;

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
    reset({
      name: department?.name ?? "",
      code: department?.code ?? "",
      description: department?.description ?? "",
      manager: department?.manager ? String(department.manager) : "",
    });
  }, [open, department, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        code: values.code ?? "",
        description: values.description ?? "",
        manager: values.manager ? Number(values.manager) : null,
      };
      return editing ? departmentsApi.update(department!.id, payload) : departmentsApi.create(payload);
    },
    onSuccess: (saved) => {
      toast.success(editing ? `${saved.name} updated` : `${saved.name} created`);
      invalidateDepartments(queryClient, saved.id);
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => {
      const err = toApiError(e);
      setFormError(
        applyServerErrors(err.fieldErrors, setError as never, FIELDS) ??
          (Object.keys(err.fieldErrors).length ? null : err.message),
      );
    },
  });

  // Keep the current manager selectable even if they are no longer in the active-user list.
  const managerOptions = [...(users.data ?? [])];
  if (department?.manager_detail && !managerOptions.some((o) => o.value === department.manager_detail!.id)) {
    managerOptions.unshift({ value: department.manager_detail.id, label: department.manager_detail.full_name });
  }

  const submit = handleSubmit((v) => mutation.mutate(v));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${department!.name}` : "New department"}
      description="The manager is automatically added to the department as its manager."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {editing ? "Save changes" : "Create department"}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <InlineError message={formError} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Name" required className="sm:col-span-2" error={errors.name?.message} {...register("name")} />
          <Input label="Code" placeholder="e.g. FIN" error={errors.code?.message} {...register("code")} />
        </div>
        <Textarea label="Description" rows={3} error={errors.description?.message} {...register("description")} />
        <Select
          label="Manager"
          placeholder="No manager"
          options={managerOptions}
          error={errors.manager?.message}
          {...register("manager")}
        />
      </form>
    </Modal>
  );
}

/** Confirm + perform deactivate/activate for a department. */
export function DepartmentStatusDialog({
  department,
  onClose,
  onDone,
}: {
  department: Department | null;
  onClose: () => void;
  onDone?: (department: Department) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const deactivating = !!department?.is_active;

  const mutation = useMutation({
    mutationFn: async (dept: Department) => {
      if (dept.is_active) {
        await departmentsApi.deactivate(dept.id);
        return { ...dept, is_active: false };
      }
      return departmentsApi.activate(dept.id);
    },
    onSuccess: (dept) => {
      toast.success(dept.is_active ? `${dept.name} reactivated` : `${dept.name} deactivated`);
      invalidateDepartments(queryClient, dept.id);
      onDone?.(dept);
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <ConfirmDialog
      open={!!department}
      onClose={onClose}
      onConfirm={() => department && mutation.mutate(department)}
      loading={mutation.isPending}
      tone={deactivating ? "danger" : "primary"}
      title={deactivating ? "Deactivate department?" : "Reactivate department?"}
      confirmLabel={deactivating ? "Deactivate" : "Reactivate"}
      message={
        deactivating ? (
          <>
            <strong>{department?.name}</strong> will no longer be available for new audits and will be hidden from
            dashboards. Existing audits, findings and actions are kept.
          </>
        ) : (
          <>
            <strong>{department?.name}</strong> will be available again for new audits and appear on dashboards.
          </>
        )
      }
    />
  );
}
