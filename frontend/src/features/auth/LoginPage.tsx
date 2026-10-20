import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardList, Lock } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { toApiError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { InlineError, Notice } from "@/components/ui/States";
import { useAuth } from "./AuthContext";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { user, login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from || "/";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to={from} replace />;

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch (e) {
      const apiError = toApiError(e);
      setError(apiError.status === 429 ? "Too many attempts. Please wait a minute and try again." : apiError.message);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
            <ClipboardList className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">AuditSphere</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Audit management for every department.</h1>
          <p className="mt-4 text-slate-300">
            Plan audits, run digital checklists, track findings and corrective actions, and report on compliance across
            IT, Finance, Operations, HR and beyond.
          </p>
        </div>
        <p className="text-xs text-slate-500">Compliance scores are internal indicators, not certification.</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ClipboardList className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold text-slate-900">AuditSphere</span>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your organisation account.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            {sessionExpired && !error && <Notice tone="warning">Your session expired. Please sign in again.</Notice>}
            <InlineError message={error} />
            <Input label="Email" type="email" autoComplete="username" autoFocus error={errors.email?.message} {...register("email")} />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register("password")}
            />
            <Button type="submit" className="w-full" loading={isSubmitting} icon={<Lock className="h-4 w-4" />}>
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
