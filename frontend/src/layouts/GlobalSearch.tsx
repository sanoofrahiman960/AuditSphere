import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, ClipboardCheck, FileStack, Search, ShieldAlert, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchApi } from "@/api/endpoints";
import { Spinner } from "@/components/ui/States";
import { useDebounce } from "@/hooks/useListParams";
import type { SearchResult } from "@/types/api";

const ICONS: Record<SearchResult["type"], typeof Search> = {
  audit: ClipboardCheck,
  finding: ShieldAlert,
  action: Wrench,
  department: Building2,
  template: FileStack,
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounce(query.trim(), 250);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchApi.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
  const results = debounced.length >= 2 ? data?.results ?? [] : [];

  useEffect(() => setActive(0), [debounced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  const go = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    navigate(result.link);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            go(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search audits, findings, actions…  (Ctrl+K)"
        className="input h-9 pl-9"
        aria-label="Global search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="global-search-results"
      />
      {open && debounced.length >= 2 && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {isFetching && !data && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Searching…
            </div>
          )}
          {!isFetching && results.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No matches.</p>}
          {results.map((r, i) => {
            const Icon = ICONS[r.type];
            return (
              <button
                key={`${r.type}-${r.id}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={clsx("flex w-full items-start gap-3 px-3 py-2 text-left", i === active && "bg-slate-50")}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">{r.title}</span>
                  <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
