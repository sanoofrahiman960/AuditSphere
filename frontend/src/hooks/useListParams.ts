import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

export const PAGE_SIZE = 20;

/**
 * List state (page, search, ordering, filters) kept in the URL so filtered views can be
 * bookmarked and survive navigation. Returns `params` ready to pass to an API list call.
 */
export function useListParams(filterKeys: string[] = [], defaults: { ordering?: string } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page") || "1");
  const search = searchParams.get("search") || "";
  const ordering = searchParams.get("ordering") ?? defaults.ordering ?? "";

  const filters = useMemo(() => {
    const result: Record<string, string> = {};
    for (const key of filterKeys) {
      const value = searchParams.get(key);
      if (value) result[key] = value;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, filterKeys.join(",")]);

  const update = useCallback(
    (changes: Record<string, string | number | undefined | null>, resetPage = true) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === null || value === "") next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage && !("page" in changes)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // A comma-separated URL value (e.g. severity=CRITICAL,HIGH) becomes a multi-value API filter.
  const params = useMemo(() => {
    const apiFilters: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(filters)) apiFilters[key] = value.includes(",") ? value.split(",") : value;
    return { page, page_size: PAGE_SIZE, search: search || undefined, ordering: ordering || undefined, ...apiFilters };
  }, [page, search, ordering, filters]);

  return {
    page,
    search,
    ordering,
    filters,
    params,
    setPage: (p: number) => update({ page: p }, false),
    setSearch: (s: string) => update({ search: s }),
    setOrdering: (o: string) => update({ ordering: o }),
    setFilter: (key: string, value: string | number | undefined | null) => update({ [key]: value }),
    /** Change several filters in one navigation (separate setFilter calls in one tick overwrite each other). */
    setFilters: (changes: Record<string, string | number | undefined | null>) => update(changes),
    clearFilters: () => update(Object.fromEntries([...filterKeys, "search"].map((k) => [k, undefined]))),
  };
}

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
