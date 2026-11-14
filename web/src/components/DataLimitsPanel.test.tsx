import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataLimitsPanel } from "./DataLimitsPanel";

describe("DataLimitsPanel", () => {
  it("shows the Data & limits text verbatim when open", () => {
    render(<DataLimitsPanel open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Data & limits" })).toBeInTheDocument();
    expect(screen.getByText(/interim data, final maps expected 2026/)).toBeInTheDocument();
    expect(screen.getByText(/It is not a fire prediction\./)).toBeInTheDocument();
    expect(
      screen.getByText("Demo version: 3 properties, sample data cached Nov 13, 2026."),
    ).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<DataLimitsPanel open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/It is not a fire prediction\./)).toBeNull();
  });

  it("calls onClose on Escape and on the close button", async () => {
    const onClose = vi.fn();
    render(<DataLimitsPanel open onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
