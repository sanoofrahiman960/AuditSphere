import clsx from "clsx";
import {
  Bell,
  Bot,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileStack,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  User as UserIcon,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Suspense, useEffect, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Avatar } from "@/components/ui/Misc";
import { LoadingState } from "@/components/ui/States";
import { useAuth } from "@/features/auth/AuthContext";
import type { Capability } from "@/types/api";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  capability?: Capability;
  hideForRoles?: string[];
  end?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/audits", label: "Audits", icon: ClipboardCheck, hideForRoles: ["ACTION_OWNER"] },
  { to: "/findings", label: "Findings", icon: ShieldAlert },
  { to: "/actions", label: "Corrective Actions", icon: Wrench },
  { to: "/departments", label: "Departments", icon: Building2, hideForRoles: ["ACTION_OWNER"] },
  { to: "/templates", label: "Audit Templates", icon: FileStack, hideForRoles: ["ACTION_OWNER", "EXECUTIVE", "DEPT_MANAGER"] },
  { to: "/reports", label: "Reports", icon: FileBarChart, capability: "view_reports" },
  { to: "/assistant", label: "Policy Assistant", icon: Bot, capability: "use_ai" },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users", label: "Users & Roles", icon: Users, capability: "manage_users" },
  { to: "/admin/activity", label: "Activity Log", icon: History, capability: "view_activity_logs" },
  { to: "/admin/settings", label: "Settings", icon: Settings, capability: "manage_settings" },
];

function readCollapsed() {
  try {
    return localStorage.getItem("auditsphere.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem("auditsphere.sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  if (!user) return null;
  const visible = (item: NavItem) =>
    (!item.capability || can(item.capability)) && !(item.hideForRoles ?? []).includes(user.role);
  const adminItems = ADMIN_NAV.filter(visible);

  const navLinks = (items: NavItem[], compact: boolean) =>
    items.filter(visible).map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        title={compact ? item.label : undefined}
        className={({ isActive }) =>
          clsx(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
            isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
            compact && "justify-center px-2",
          )
        }
      >
        <item.icon className="h-[18px] w-[18px] shrink-0" />
        {!compact && <span className="truncate">{item.label}</span>}
      </NavLink>
    ));

  const sidebar = (compact: boolean) => (
    <div className="flex h-full flex-col bg-navy-900">
      <div className={clsx("flex h-16 items-center gap-2 px-4", compact && "justify-center px-2")}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
          <ClipboardList className="h-4 w-4 text-white" />
        </div>
        {!compact && (
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">AuditSphere</p>
            <p className="truncate text-[11px] text-slate-400">{user.organization?.name}</p>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main">
        {navLinks(MAIN_NAV, compact)}
        {adminItems.length > 0 && (
          <>
            {!compact && (
              <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Administration
              </p>
            )}
            {compact && <div className="my-3 border-t border-white/10" />}
            {navLinks(adminItems, compact)}
          </>
        )}
      </nav>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="hidden items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-slate-400 hover:text-white lg:flex"
        aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
      >
        {compact ? <ChevronsRight className="mx-auto h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={clsx("sticky top-0 hidden h-screen shrink-0 transition-[width] lg:block", collapsed ? "w-[72px]" : "w-64")}>
        {sidebar(collapsed)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-64">
            {sidebar(false)}
            <button
              className="absolute right-3 top-4 text-slate-300"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button className="text-slate-500 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Avatar name={user.full_name || user.email} />
                <span className="hidden text-left md:block">
                  <span className="block text-sm font-medium leading-tight text-slate-800">{user.full_name}</span>
                  <span className="block text-xs leading-tight text-slate-500">{user.role_display}</span>
                </span>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="menu">
                    <div className="border-b border-slate-100 px-3 py-2">
                      <p className="truncate text-sm font-medium text-slate-800">{user.full_name}</p>
                      <p className="truncate text-xs text-slate-500">{user.email}</p>
                    </div>
                    <button
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => navigate("/profile")}
                    >
                      <UserIcon className="h-4 w-4" /> Profile & password
                    </button>
                    <button
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => navigate("/notifications")}
                    >
                      <Bell className="h-4 w-4" /> Notifications
                    </button>
                    <button
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      onClick={async () => {
                        await logout();
                        navigate("/login", { replace: true });
                      }}
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
