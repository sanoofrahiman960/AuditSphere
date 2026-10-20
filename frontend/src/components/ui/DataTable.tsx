import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState, ErrorState, LoadingState } from "./States";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Backend ordering field; enables a sortable header. */
  sortKey?: string;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T extends { id: number | string }>({
  columns,
  rows,
  loading,
  error,
  onRetry,
  emptyTitle = "No records found",
  emptyDescription,
  emptyAction,
  ordering,
  onOrderingChange,
  onRowClick,
  pagination,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  ordering?: string;
  onOrderingChange?: (ordering: string) => void;
  onRowClick?: (row: T) => void;
  pagination?: { page: number; pageSize: number; count: number; onPageChange: (page: number) => void };
}) {
  const toggleSort = (sortKey: string) => {
    if (!onOrderingChange) return;
    if (ordering === sortKey) onOrderingChange(`-${sortKey}`);
    else if (ordering === `-${sortKey}`) onOrderingChange("");
    else onOrderingChange(sortKey);
  };

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((col) => {
                const active = ordering === col.sortKey || ordering === `-${col.sortKey}`;
                const desc = ordering === `-${col.sortKey}`;
                return (
                  <th
                    key={col.key}
                    className={col.headerClassName}
                    scope="col"
                    aria-sort={active ? (desc ? "descending" : "ascending") : undefined}
                  >
                    {col.sortKey && onOrderingChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sortKey!)}
                        className="inline-flex items-center gap-1 uppercase hover:text-slate-700"
                      >
                        {col.header}
                        {active ? (
                          desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {!loading &&
              !error &&
              rows?.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx(onRowClick && "cursor-pointer hover:bg-slate-50")}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={col.className}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {loading && <LoadingState />}
      {!loading && error != null && <ErrorState error={error} onRetry={onRetry} />}
      {!loading && !error && rows?.length === 0 && (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      )}
      {pagination && !error && <Pagination {...pagination} />}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  count,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-600">
      <span>
        {from}–{to} of {count}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          icon={<ChevronLeft className="h-4 w-4" />}
        />
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
          icon={<ChevronRight className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}
