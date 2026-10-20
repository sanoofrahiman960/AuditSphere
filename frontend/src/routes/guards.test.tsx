import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { makeUser, renderWithProviders } from "@/test/utils";
import type { Capability, Me } from "@/types/api";
import { ProtectedRoute, RequireCapability } from "./guards";

let auth: { user: Me | null; initializing: boolean; can: (c: Capability) => boolean } = {
  user: null,
  initializing: false,
  can: () => false,
};

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => auth }));

function setUser(user: Me | null) {
  auth = { user, initializing: false, can: (c) => !!user?.capabilities.includes(c) };
}

describe("ProtectedRoute", () => {
  it("redirects anonymous users to the login page", () => {
    setUser(null);
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<p>login screen</p>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/audits" element={<p>audits</p>} />
        </Route>
      </Routes>,
      { route: "/audits" },
    );
    expect(screen.getByText("login screen")).toBeInTheDocument();
  });

  it("renders the page for signed-in users", () => {
    setUser(makeUser("AUDITOR"));
    renderWithProviders(
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/audits" element={<p>audits</p>} />
        </Route>
      </Routes>,
      { route: "/audits" },
    );
    expect(screen.getByText("audits")).toBeInTheDocument();
  });
});

describe("RequireCapability", () => {
  it("hides content without the capability", () => {
    setUser(makeUser("EXECUTIVE", ["view_reports"]));
    renderWithProviders(
      <RequireCapability capability="manage_users">
        <p>user admin</p>
      </RequireCapability>,
    );
    expect(screen.queryByText("user admin")).not.toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it("shows content with the capability", () => {
    setUser(makeUser("SUPER_ADMIN", ["manage_users"]));
    renderWithProviders(
      <RequireCapability capability="manage_users">
        <p>user admin</p>
      </RequireCapability>,
    );
    expect(screen.getByText("user admin")).toBeInTheDocument();
  });
});
