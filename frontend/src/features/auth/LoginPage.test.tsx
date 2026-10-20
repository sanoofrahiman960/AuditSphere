import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { renderWithProviders } from "@/test/utils";
import LoginPage from "./LoginPage";

const login = vi.fn();
let sessionExpired = false;

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ user: null, login, sessionExpired }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    login.mockReset();
    sessionExpired = false;
  });

  it("validates the form before calling the API", async () => {
    renderWithProviders(<LoginPage />, { route: "/login" });
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("submits credentials", async () => {
    login.mockResolvedValue({});
    renderWithProviders(<LoginPage />, { route: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "auditor1@acme.test");
    await userEvent.type(screen.getByLabelText("Password"), "secret-password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("auditor1@acme.test", "secret-password"));
  });

  it("shows the server's error message", async () => {
    login.mockRejectedValue(new ApiError(401, { detail: "Invalid email or password.", code: "no_active_account", errors: null }, ""));
    renderWithProviders(<LoginPage />, { route: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "a@acme.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("explains rate limiting", async () => {
    login.mockRejectedValue(new ApiError(429, { detail: "Request was throttled.", code: "throttled", errors: null }, ""));
    renderWithProviders(<LoginPage />, { route: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "a@acme.test");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
  });

  it("tells the user when the session expired", () => {
    sessionExpired = true;
    renderWithProviders(<LoginPage />, { route: "/login" });
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
  });
});
