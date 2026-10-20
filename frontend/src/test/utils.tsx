import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import type { Capability, Me, Role } from "@/types/api";

export function makeUser(role: Role, capabilities: Capability[] = []): Me {
  return {
    id: 1,
    email: "user@acme.test",
    first_name: "Test",
    last_name: "User",
    full_name: "Test User",
    role,
    role_display: role,
    job_title: "",
    phone: "",
    organization: { id: 1, name: "Acme", slug: "acme" },
    capabilities,
    managed_department_ids: [],
    last_login: null,
  };
}

export function renderWithProviders(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
