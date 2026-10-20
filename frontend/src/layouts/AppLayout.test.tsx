import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeUser, renderWithProviders } from "@/test/utils";
import type { Capability, Me } from "@/types/api";
import { AppLayout } from "./AppLayout";

let currentUser: Me = makeUser("AUDITOR");

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    user: currentUser,
    can: (c: Capability) => currentUser.capabilities.includes(c),
    logout: vi.fn(),
  }),
}));

vi.mock("@/api/endpoints", () => ({
  notificationsApi: {
    unreadCount: () => Promise.resolve({ count: 3 }),
    list: () => Promise.resolve({ count: 0, next: null, previous: null, results: [] }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
  searchApi: { search: () => Promise.resolve({ query: "", results: [] }) },
}));

function navLabels() {
  const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
  return within(nav)
    .getAllByRole("link")
    .map((a) => a.textContent);
}

describe("AppLayout navigation", () => {
  it("shows administration links to a super administrator", () => {
    currentUser = makeUser("SUPER_ADMIN", [
      "manage_users", "manage_settings", "view_activity_logs", "view_reports", "use_ai", "manage_templates",
    ]);
    renderWithProviders(<AppLayout />);
    expect(navLabels()).toEqual(
      expect.arrayContaining(["Dashboard", "Audits", "Reports", "Users & Roles", "Activity Log", "Settings"]),
    );
  });

  it("hides administration and template links from an executive viewer", () => {
    currentUser = makeUser("EXECUTIVE", ["view_reports"]);
    renderWithProviders(<AppLayout />);
    const labels = navLabels();
    expect(labels).toContain("Reports");
    expect(labels).not.toContain("Users & Roles");
    expect(labels).not.toContain("Audit Templates");
    expect(labels).not.toContain("Policy Assistant");
  });

  it("gives an action owner a focused menu", () => {
    currentUser = makeUser("ACTION_OWNER");
    renderWithProviders(<AppLayout />);
    expect(navLabels()).toEqual(["Dashboard", "Findings", "Corrective Actions"]);
  });

  it("shows the unread notification count", async () => {
    currentUser = makeUser("AUDITOR");
    renderWithProviders(<AppLayout />);
    expect(await screen.findByLabelText("Notifications (3 unread)")).toBeInTheDocument();
  });
});
