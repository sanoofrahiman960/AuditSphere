import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import type { MyWork } from "@/types/api";
import { MyWorkPanel } from "./MyWorkPanel";

let response: MyWork;

vi.mock("@/api/endpoints", () => ({
  dashboardApi: { myWork: () => Promise.resolve(response) },
}));

describe("MyWorkPanel", () => {
  it("lists the user's tasks by category with links", async () => {
    response = {
      total: 3,
      sections: [
        {
          key: "perform",
          title: "Audits to perform",
          count: 1,
          items: [{ kind: "rework", id: 7, reference: "AUD-2026-0007", title: "Payroll", department: "HR",
                    status: "REWORK_REQUIRED", due_date: "2026-10-25", days_left: 5, completion_percentage: 80 }],
        },
        { key: "review", title: "Audits to review", count: 0, items: [] },
        {
          key: "verify",
          title: "Actions awaiting your verification",
          count: 2,
          items: [{ kind: "verify", id: 3, reference: "CA-2026-0003", title: "Fix backups", department: "IT",
                    status: "PENDING_VERIFICATION", due_date: "2026-10-10", days_left: -10, owner: "Carlos", progress: 100 }],
        },
      ],
    };
    renderWithProviders(<MyWorkPanel />);
    expect(await screen.findByText("Payroll")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Payroll/ })).toHaveAttribute("href", "/audits/7/workspace");
    expect(screen.queryByRole("tab", { name: /Audits to review/ })).not.toBeInTheDocument(); // empty categories hidden

    await userEvent.click(screen.getByRole("tab", { name: /awaiting your verification/i }));
    expect(screen.getByRole("link", { name: /Fix backups/ })).toHaveAttribute("href", "/actions/3");
    expect(screen.getByText("10d overdue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all 2/i })).toHaveAttribute("href", "/actions?status=PENDING_VERIFICATION");
  });

  it("says when the user is all caught up", async () => {
    response = { total: 0, sections: [] };
    renderWithProviders(<MyWorkPanel />);
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });
});
