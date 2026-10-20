import { AlertTriangle } from "lucide-react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/Button";

/** Shown when a route fails to load (e.g. a chunk download error after a deployment) or throws while rendering. */
export function RouteErrorPage() {
  const error = useRouteError();
  const chunkError = error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : chunkError
      ? "A new version of AuditSphere is available. Reload the page to continue."
      : "An unexpected error occurred while displaying this page.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="card max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Link to="/" className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
