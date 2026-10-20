import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Bell, ChevronRight, Eye, EyeOff, KeyRound, Save } from "lucide-react";
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { authApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, DetailList } from "@/components/ui/Card";
import { applyServerErrors, Field, Input } from "@/components/ui/Form";
import { Avatar } from "@/components/ui/Misc";
import { PageHeader } from "@/components/ui/PageHeader";
import { InlineError, LoadingState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { CAPABILITY_LABELS, ROLE_LABELS, formatDateTime } from "@/utils/format";
import { useAuth } from "./AuthContext";

// ---------------------------------------------------------------- profile form

const profileSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(150),
  last_name: z.string().trim().min(1, "Last name is required").max(150),
  job_title: z.string().max(150).optional(),
  phone: z.string().max(50).optional(),
});
type ProfileValues = z.infer<typeof profileSchema>;
const PROFILE_FIELDS = Object.keys(profileSchema.shape);

function ProfileCard() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) });

  useEffect(() => {
    if (user) {
      reset({ first_name: user.first_name, last_name: user.last_name, job_title: user.job_title, phone: user.phone });
    }
  }, [user, reset]);

  const mutation = useMutation({
    mutationFn: (v: ProfileValues) =>
      authApi.updateMe({
        first_name: v.first_name.trim(),
        last_name: v.last_name.trim(),
        job_title: v.job_title?.trim() ?? "",
        phone: v.phone?.trim() ?? "",
      }),
    onSuccess: async () => {
      setFormError(null);
      await refreshUser();
      toast.success("Profile updated");
    },
    onError: (e) => {
      const err = toApiError(e);
      setFormError(
        applyServerErrors(err.fieldErrors, setError as never, PROFILE_FIELDS) ??
          (Object.keys(err.fieldErrors).length ? null : err.message),
      );
    },
  });

  if (!user) return null;
  const submit = handleSubmit((v) => mutation.mutate(v));

  return (
    <Card title="Profile" description="Your name and contact details as shown to colleagues.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <InlineError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" required autoComplete="given-name" error={errors.first_name?.message} {...register("first_name")} />
          <Input label="Last name" required autoComplete="family-name" error={errors.last_name?.message} {...register("last_name")} />
          <Input label="Job title" autoComplete="organization-title" error={errors.job_title?.message} {...register("job_title")} />
          <Input label="Phone" type="tel" autoComplete="tel" error={errors.phone?.message} {...register("phone")} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" icon={<Save className="h-4 w-4" />} loading={mutation.isPending} disabled={!isDirty}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- password form

const PasswordField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }>(
  function PasswordField({ label, error, hint, id, ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    const inputId = id ?? `pw-${label.replace(/\W+/g, "-").toLowerCase()}`;
    return (
      <Field label={label} required error={error} hint={hint} htmlFor={inputId}>
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            aria-invalid={!!error}
            className={"input pr-10" + (error ? " input-error" : "")}
            {...rest}
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
      </Field>
    );
  },
);

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z
      .string()
      .min(10, "Use at least 10 characters")
      .refine((v) => !/^\d+$/.test(v), "The password cannot be entirely numeric"),
    confirm_password: z.string().min(1, "Confirm the new password"),
  })
  .superRefine((v, ctx) => {
    if (v.new_password && v.confirm_password && v.new_password !== v.confirm_password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirm_password"], message: "Passwords do not match" });
    }
    if (v.current_password && v.new_password && v.current_password === v.new_password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["new_password"], message: "Choose a different password" });
    }
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordCard() {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const mutation = useMutation({
    mutationFn: (v: PasswordValues) => authApi.changePassword(v.current_password, v.new_password),
    onSuccess: (res) => {
      setFormError(null);
      reset();
      toast.success(res.detail || "Password changed");
    },
    onError: (e) => {
      const err = toApiError(e);
      setFormError(
        applyServerErrors(err.fieldErrors, setError as never, ["current_password", "new_password"]) ??
          (Object.keys(err.fieldErrors).length ? null : err.message),
      );
    },
  });

  const submit = handleSubmit((v) => mutation.mutate(v));

  return (
    <Card title="Change password" description="You stay signed in here; other devices will need the new password.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <InlineError message={formError} />
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          error={errors.current_password?.message}
          {...register("current_password")}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          error={errors.new_password?.message}
          hint="At least 10 characters, not entirely numeric, not a common password and not similar to your name or email."
          {...register("new_password")}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirm_password?.message}
          {...register("confirm_password")}
        />
        <div className="flex justify-end">
          <Button type="submit" icon={<KeyRound className="h-4 w-4" />} loading={mutation.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- page

export default function ProfilePage() {
  const { user } = useAuth();
  if (!user) return <LoadingState />;

  return (
    <>
      <PageHeader
        title="My profile"
        description="Your account details, password and notification settings."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Profile" }]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ProfileCard />
          <PasswordCard />
        </div>

        <div className="space-y-6">
          <Card title="Account">
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={user.full_name || user.email} className="h-11 w-11 text-sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{user.full_name || user.email}</p>
                <p className="truncate text-sm text-slate-500">{user.job_title || "No job title"}</p>
              </div>
            </div>
            <DetailList
              columns={1}
              items={[
                { label: "Email", value: user.email },
                { label: "Role", value: <Badge tone="blue">{ROLE_LABELS[user.role] ?? user.role_display}</Badge> },
                { label: "Organisation", value: user.organization?.name ?? "—" },
                { label: "Last sign-in", value: formatDateTime(user.last_login) },
              ]}
            />
            <p className="mt-4 text-xs text-slate-500">
              Email, role and organisation are managed by your Super Administrator.
            </p>
          </Card>

          <Card title="What you can do" description="Permissions granted by your role.">
            {user.capabilities.length ? (
              <div className="flex flex-wrap gap-1.5">
                {user.capabilities.map((cap) => (
                  <Badge key={cap} tone="gray">
                    {CAPABILITY_LABELS[cap] ?? cap}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                You can work on corrective actions assigned to you and view records you are involved in.
              </p>
            )}
          </Card>

          <Link
            to="/notifications"
            className="card flex items-center gap-3 px-5 py-4 transition hover:border-brand-300 hover:bg-brand-50/40"
          >
            <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
              <Bell className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">Notification preferences</span>
              <span className="block text-xs text-slate-500">Choose which events reach you in the app and by email.</span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
          </Link>
        </div>
      </div>
    </>
  );
}
