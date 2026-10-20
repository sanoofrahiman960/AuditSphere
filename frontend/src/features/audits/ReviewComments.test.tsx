import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import type { ReviewComment } from "@/types/api";
import { ReviewComments } from "./ReviewComments";

const reviewer = { id: 2, email: "r@acme.test", full_name: "Rita Reviewer", role: "REVIEWER" as const, job_title: "" };

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 1,
    question: 10,
    question_code: "Q1",
    body: "Attach the sample list",
    author: reviewer,
    is_resolved: false,
    resolution_note: "",
    resolved_by: null,
    resolved_at: null,
    created_at: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}

describe("ReviewComments", () => {
  it("lets the reviewer add a comment", async () => {
    const onAdd = vi.fn().mockResolvedValue({});
    renderWithProviders(
      <ReviewComments comments={[]} canAdd canResolve={false} onAdd={onAdd} onResolve={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add review comment/i }));
    const button = screen.getByRole("button", { name: /^add comment$/i });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Review comment"), "Evidence is outdated");
    await userEvent.click(button);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("Evidence is outdated"));
  });

  it("lets the audit team resolve an open comment with a note", async () => {
    const onResolve = vi.fn().mockResolvedValue({});
    const c = comment();
    renderWithProviders(<ReviewComments comments={[c]} canAdd={false} canResolve onAdd={vi.fn()} onResolve={onResolve} />);
    expect(screen.getByText("Attach the sample list")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /mark resolved/i }));
    await userEvent.type(screen.getByLabelText("Resolution note"), "Attached");
    await userEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(c, "Attached"));
  });

  it("shows resolved comments without a resolve button", () => {
    renderWithProviders(
      <ReviewComments
        comments={[comment({ is_resolved: true, resolved_by: reviewer, resolved_at: "2026-10-21T09:00:00Z", resolution_note: "Done" })]}
        canAdd={false}
        canResolve
        onAdd={vi.fn()}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText(/Resolved by Rita Reviewer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark resolved/i })).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing to show or do", () => {
    const { container } = renderWithProviders(
      <ReviewComments comments={[]} canAdd={false} canResolve={false} onAdd={vi.fn()} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".space-y-2")).toBeNull();
  });
});
