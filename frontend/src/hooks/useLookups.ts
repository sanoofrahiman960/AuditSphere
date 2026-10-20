import { useQuery } from "@tanstack/react-query";
import { categoriesApi, departmentsApi, templatesApi, usersApi } from "@/api/endpoints";
import type { Role } from "@/types/api";

/** Reference lists for selects. Cached for 5 minutes; scoped server-side to what the user may see. */

export function useDepartmentOptions(includeInactive = false) {
  return useQuery({
    queryKey: ["lookup", "departments", includeInactive],
    queryFn: () => departmentsApi.list({ page_size: 500, is_active: includeInactive ? undefined : true }),
    staleTime: 5 * 60_000,
    select: (data) => data.results.map((d) => ({ value: d.id, label: d.name })),
  });
}

export function useUserOptions(roles?: Role[]) {
  return useQuery({
    queryKey: ["lookup", "users", roles?.join(",") ?? "all"],
    queryFn: () => usersApi.list({ page_size: 500, is_active: true, role: roles }),
    staleTime: 5 * 60_000,
    select: (data) => data.results.map((u) => ({ value: u.id, label: u.job_title ? `${u.full_name} — ${u.job_title}` : u.full_name })),
  });
}

export function useCategoryOptions() {
  return useQuery({
    queryKey: ["lookup", "categories"],
    queryFn: () => categoriesApi.list({ page_size: 500, is_active: true }),
    staleTime: 5 * 60_000,
    select: (data) => data.results.map((c) => ({ value: c.id, label: c.name })),
  });
}

/** Templates that have an approved version, as options keyed by the approved version id. */
export function useApprovedTemplateVersionOptions(departmentId?: number | null) {
  return useQuery({
    queryKey: ["lookup", "template-versions", departmentId ?? "all"],
    queryFn: () => templatesApi.list({ page_size: 500, is_active: true }),
    staleTime: 60_000,
    select: (data) =>
      data.results
        .filter((t) => t.current_version && (!departmentId || !t.department || t.department === departmentId))
        .map((t) => ({
          value: t.current_version!.id,
          label: `${t.name} (v${t.current_version!.version})${t.department_name ? "" : " — all departments"}`,
        })),
  });
}

export const AUDITOR_ROLES: Role[] = ["AUDITOR", "AUDIT_ADMIN", "SUPER_ADMIN"];
export const REVIEWER_ROLES: Role[] = ["REVIEWER", "AUDIT_ADMIN", "SUPER_ADMIN"];
