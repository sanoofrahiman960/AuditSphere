import clsx from "clsx";
import { AlertCircle, Inbox, Loader2, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/api/client";
import { Button } from "./Button";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-5 w-5 animate-spin text-brand-600", className)} aria-label="Loading" />;
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center justify-center gap-2 py-12 text-sm text-slate-500", className)} role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center justify-center px-4 py-12 text-center", className)}>
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const apiError = error instanceof ApiError ? error : null;
  const forbidden = apiError?.status === 403;
  const notFound = apiError?.status === 404;
  return (
    <div className={clsx("flex flex-col items-center justify-center px-4 py-12 text-center", className)} role="alert">
      <div className={clsx("mb-3 rounded-full p-3", forbidden ? "bg-amber-50 text-amber-500" : "bg-red-50 text-red-500")}>
        {forbidden ? <ShieldAlert className="h-6 w-6" /> : <AlertCircle className="h-6 w-6" />}
      </div>
      <p className="text-sm font-semibold text-slate-800">
        {forbidden ? "Access denied" : notFound ? "Not found" : "Something went wrong"}
      </p>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        {apiError?.message ?? (error instanceof Error ? error.message : "Unexpected error")}
      </p>
      {onRetry && !forbidden && !notFound && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "info" ? "border-blue-200 bg-blue-50 text-blue-800" : "border-amber-200 bg-amber-50 text-amber-800",
      )}
    >
      {children}
    </div>
  );
}
