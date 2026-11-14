import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BreakdownPanel } from "./BreakdownPanel";
import { properties } from "@/data/properties";
import { formatAsOf } from "@/lib/format";

const block = properties[0].blocks.find((b) => b.id === "adelaida-3")!;
const renderPanel = (onClose = () => {}) =>
  render(<BreakdownPanel block={block} propertyId="adelaida-hills" onClose={onClose} />);

describe("BreakdownPanel", () => {
  it("shows the block's score, level and summary", () => {
    renderPanel();
    expect(screen.getByTestId("score")).toHaveTextContent("78");
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText(block.summary)).toBeInTheDocument();
  });

  it("shows five factor rows whose points add up to the score", () => {
    renderPanel();
    const rows = screen.getAllByTestId("factor-row");
    expect(rows).toHaveLength(5);
    const total = rows
      .map((r) => Number(within(r).getByTestId("factor-points").textContent!.replace("+", "")))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(78);
  });

  it("gives every factor its plain-words reason, source and timestamp", () => {
    renderPanel();
    const rows = screen.getAllByTestId("factor-row");
    block.factors.forEach((f, i) => {
      expect(rows[i]).toHaveTextContent(f.reason);
      expect(rows[i]).toHaveTextContent(f.source);
      expect(rows[i]).toHaveTextContent(formatAsOf(f.asOf));
    });
  });

  it("keeps weights collapsed and leaves a slot for the photo correction", () => {
    renderPanel();
    expect(screen.getByText("Adjust weights").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("photo-slot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add photos from the rows/ })).toBeInTheDocument();
  });

  it("links to the plan for this property", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /See plan/ })).toHaveAttribute(
      "href",
      "/plan?property=adelaida-hills",
    );
  });

  it("calls onClose from the close button", async () => {
    const onClose = vi.fn();
    renderPanel(onClose);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
