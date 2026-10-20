import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, CheckCheck, Mail, MonitorSmartphone, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notificationsApi } from "@/api/endpoints";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { PAGE_SIZE, useListParams } from "@/hooks/useListParams";
import type { Notification, NotificationPreference } from "@/types/api";
import { formatDateTime, timeAgo } from "@/utils/format";

const PREFERENCES_KEY = ["notification-preferences"];

export default function NotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useListParams(["show", "notification_type"]);
  const show = list.filters.show === "unread" ? "unread" : "all";

  const params = useMemo(
    () => ({
      page: list.page,
      page_size: PAGE_SIZE,
      is_read: show === "unread" ? false : undefined,
      notification_type: list.filters.notification_type || undefined,
    }),
    [list.page, show, list.filters.notification_type],
  );

  const notifications = useQuery({
    queryKey: ["notifications", "list", params],
    queryFn: () => notificationsApi.list(params),
    placeholderData: (prev) => prev,
  });
  const unread = useQuery({ queryKey: ["notifications", "unread-count"], queryFn: notificationsApi.unreadCount });
  // The preference matrix also provides the human-readable type labels for the filter.
  const preferences = useQuery({ queryKey: PREFERENCES_KEY, queryFn: notificationsApi.preferences });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const markRead = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: invalidate });
  const markAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: (res) => {
      toast.success(res.updated ? `${res.updated} ${res.updated === 1 ? "notification" : "notifications"} marked as read` : "Nothing to mark");
      invalidate();
    },
    onError: (e) => toast.error(e),
  });

  const open = (n: Notification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const typeOptions = (preferences.data ?? []).map((p) => ({ value: p.notification_type, label: p.label }));
  const unreadCount = unread.data?.count ?? 0;
  const filtered = show === "unread" || !!list.filters.notification_type;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Assignments, deadlines, review outcomes and verification requests."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Notifications" }]}
        actions={
          <Button
            variant="secondary"
            icon={<CheckCheck className="h-4 w-4" />}
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
            disabled={unreadCount === 0}
          >
            Mark all as read
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="card overflow-hidden" aria-labelledby="notification-list-heading">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 id="notification-list-heading" className="text-sm font-semibold text-slate-900">
                Inbox
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {unreadCount ? `${unreadCount} unread` : "You're all caught up."}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div role="group" aria-label="Show" className="inline-flex rounded-lg border border-slate-300 p-0.5">
                {(["unread", "all"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={show === value}
                    onClick={() => list.setFilter("show", value === "all" ? undefined : value)}
                    className={clsx(
                      "rounded-md px-3 py-1 text-xs font-medium transition",
                      show === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {value === "unread" ? "Unread" : "All"}
                  </button>
                ))}
              </div>
              <Select
                aria-label="Notification type"
                className="w-56"
                placeholder="All types"
                options={typeOptions}
                value={list.filters.notification_type ?? ""}
                onChange={(e) => list.setFilter("notification_type", e.target.value)}
              />
            </div>
          </header>

          {notifications.isLoading ? (
            <LoadingState />
          ) : notifications.error ? (
            <ErrorState error={notifications.error} onRetry={() => notifications.refetch()} />
          ) : !notifications.data?.results.length ? (
            <EmptyState
              icon={<Bell className="h-6 w-6" />}
              title={filtered ? "No notifications match" : "No notifications yet"}
              description={
                show === "unread"
                  ? "You have read everything. Switch to All to see earlier notifications."
                  : filtered
                    ? "Try another notification type."
                    : "You'll be notified about assignments, deadlines and reviews here."
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.data.results.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={clsx(
                      "flex w-full gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50",
                      !n.is_read && "bg-brand-50/40",
                    )}
                  >
                    <span
                      className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.is_read ? "bg-transparent" : "bg-brand-600")}
                      aria-label={n.is_read ? undefined : "Unread"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <span className={clsx("text-sm text-slate-900", !n.is_read && "font-semibold")}>{n.title}</span>
                        <span className="shrink-0 text-xs text-slate-400" title={formatDateTime(n.created_at)}>
                          {timeAgo(n.created_at)}
                        </span>
                      </span>
                      {n.message && <span className="mt-0.5 block text-sm text-slate-600">{n.message}</span>}
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge tone="gray">{n.type_display}</Badge>
                        {n.link && <span className="text-xs font-medium text-brand-700">Open →</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!notifications.error && (
            <Pagination
              page={list.page}
              pageSize={PAGE_SIZE}
              count={notifications.data?.count ?? 0}
              onPageChange={list.setPage}
            />
          )}
        </section>

        <PreferencesCard
          data={preferences.data}
          loading={preferences.isLoading}
          error={preferences.error}
          onRetry={() => preferences.refetch()}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- preferences

function PreferencesCard({
  data,
  loading,
  error,
  onRetry,
}: {
  data: NotificationPreference[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<NotificationPreference[]>([]);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(data ?? []), [draft, data]);

  const save = useMutation({
    mutationFn: () =>
      notificationsApi.updatePreferences(
        draft.map((p) => ({ notification_type: p.notification_type, in_app: p.in_app, email: p.email })),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(PREFERENCES_KEY, saved);
      toast.success("Notification preferences saved");
    },
    onError: (e) => toast.error(e),
  });

  const toggle = (type: string, channel: "in_app" | "email") =>
    setDraft((rows) => rows.map((r) => (r.notification_type === type ? { ...r, [channel]: !r[channel] } : r)));

  const setAll = (channel: "in_app" | "email", value: boolean) =>
    setDraft((rows) => rows.map((r) => ({ ...r, [channel]: value })));

  const allOn = (channel: "in_app" | "email") => draft.length > 0 && draft.every((r) => r[channel]);

  return (
    <Card
      title="Notification preferences"
      description="Choose how you are told about each event. Email delivery also depends on your organisation's settings."
      bodyClassName="p-0"
      className="self-start"
    >
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !draft.length ? (
        <EmptyState title="No notification types" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col" className="text-center">
                    <span className="inline-flex items-center gap-1">
                      <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden /> In-app
                    </span>
                  </th>
                  <th scope="col" className="text-center">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" aria-hidden /> Email
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                <tr className="bg-slate-50/60">
                  <td className="text-xs font-medium text-slate-500">All events</td>
                  <td className="text-center">
                    <Switch
                      checked={allOn("in_app")}
                      onChange={(v) => setAll("in_app", v)}
                      label="All events in-app"
                    />
                  </td>
                  <td className="text-center">
                    <Switch checked={allOn("email")} onChange={(v) => setAll("email", v)} label="All events by email" />
                  </td>
                </tr>
                {draft.map((p) => (
                  <tr key={p.notification_type}>
                    <td className="text-sm text-slate-700">{p.label}</td>
                    <td className="text-center">
                      <Switch
                        checked={p.in_app}
                        onChange={() => toggle(p.notification_type, "in_app")}
                        label={`${p.label}: in-app`}
                      />
                    </td>
                    <td className="text-center">
                      <Switch
                        checked={p.email}
                        onChange={() => toggle(p.notification_type, "email")}
                        label={`${p.label}: email`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
            {dirty && <span className="mr-auto text-xs text-amber-700">Unsaved changes</span>}
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="h-4 w-4" />}
              disabled={!dirty || save.isPending}
              onClick={() => data && setDraft(data)}
            >
              Discard
            </Button>
            <Button size="sm" icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save preferences
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-brand-600" : "bg-slate-300",
      )}
    >
      <span
        className={clsx(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
