import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoadingState } from "@/components/ui/States";
import { EmptyState } from "@/components/ui/States";
import { useAuth } from "@/features/auth/AuthContext";
import type { Capability } from "@/types/api";
import { ShieldAlert } from "lucide-react";

/** Requires a signed-in user; otherwise redirects to /login and returns afterwards. */
export function ProtectedRoute() {
  const { user, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return <LoadingState label="Restoring your session…" className="min-h-screen" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/**
 * Hides a page from users without the capability. This is a UX convenience only —
 * the API enforces the same rule and returns 403.
 */
export function RequireCapability({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(capability)) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-6 w-6" />}
        title="You don't have access to this page"
        description="Ask a Super Administrator if you need this permission."
      />
    );
  }
  return <>{children}</>;
}
