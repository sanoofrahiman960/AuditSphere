import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { FilterPanel } from "./FilterPanel";

describe("FilterPanel", () => {
  it("collapses filters behind a toggle that shows the active count", async () => {
    renderWithProviders(
      <FilterPanel activeCount={2}>
        <p>filter fields</p>
      </FilterPanel>,
    );
    const toggle = screen.getByRole("button", { name: "Filters (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("filter fields").parentElement).toHaveClass("hidden", "md:block");

    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide filters (2)" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("filter fields").parentElement).not.toHaveClass("hidden");
  });
});
