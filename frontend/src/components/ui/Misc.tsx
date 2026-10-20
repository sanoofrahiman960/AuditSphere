import clsx from "clsx";
import { Download, FileText, Paperclip, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { evidenceApi } from "@/api/endpoints";
import { formatBytes, formatDateTime } from "@/utils/format";
import { Button } from "./Button";
import { useToast } from "./Toast";

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="mb-4 overflow-x-auto border-b border-slate-200" role="tablist">
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active === tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
              active === tab.id
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{tab.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProgressBar({ value, className, tone = "brand" }: { value: number; className?: string; tone?: "brand" | "green" | "amber" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-slate-100", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx("h-full rounded-full", {
          brand: "bg-brand-600",
          green: "bg-green-600",
          amber: "bg-amber-500",
        }[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Small "choose file + upload" control. The caller performs the upload. */
export function FileUploadButton({
  onUpload,
  label = "Upload file",
  accept = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.msg,.eml",
  disabled,
  size = "sm",
}: {
  onUpload: (file: File) => Promise<unknown>;
  label?: string;
  accept?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={accept}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await onUpload(file);
            toast.success(`${file.name} uploaded`);
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        variant="secondary"
        size={size}
        loading={busy}
        disabled={disabled}
        onClick={() => input.current?.click()}
        icon={<Upload className="h-4 w-4" />}
      >
        {label}
      </Button>
    </>
  );
}

export interface FileItem {
  id: number;
  original_name: string;
  size: number;
  download_url: string;
  created_at: string;
  description?: string;
  uploaded_by?: { full_name: string } | null;
}

export function FileList({
  files,
  onDelete,
  canDelete,
  emptyText = "No files attached.",
}: {
  files: FileItem[];
  onDelete?: (file: FileItem) => void;
  /** Per-file check (e.g. only the uploader may remove); defaults to all files when onDelete is given. */
  canDelete?: (file: FileItem) => boolean;
  emptyText?: string;
}) {
  const toast = useToast();
  if (!files.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {files.map((file) => (
        <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-800">{file.original_name}</p>
            <p className="text-xs text-slate-500">
              {formatBytes(file.size)} · {file.uploaded_by?.full_name ?? "—"} · {formatDateTime(file.created_at)}
              {file.description ? ` · ${file.description}` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Download className="h-4 w-4" />}
            onClick={() => evidenceApi.download(file.download_url, file.original_name).catch(toast.error)}
          >
            Download
          </Button>
          {onDelete && (canDelete?.(file) ?? true) && (
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onDelete(file)}>
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AttachmentCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
      <Paperclip className="h-3 w-3" />
      {count}
    </span>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={clsx(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800",
        className,
      )}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}
