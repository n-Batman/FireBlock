import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlockRail } from "./BlockRail";
import { properties } from "@/data/properties";

const adelaida = properties[0];
const today = new Date(2026, 10, 13);
const renderRail = (over: Partial<Parameters<typeof BlockRail>[0]> = {}) =>
  render(
    <BlockRail property={adelaida} selectedId={null} onSelect={() => {}} today={today} {...over} />,
  );

describe("BlockRail", () => {
  it("lists vine blocks worst-first with their scores", () => {
    renderRail();
    const rows = screen.getAllByRole("button");
    const expected: [string, number][] = [
      ["Block 3", 78],
      ["Block 5", 71],
      ["Block 4", 58],
      ["Block 1", 49],
      ["Block 2", 33],
    ];
    expect(rows).toHaveLength(5);
    expected.forEach(([name, score], i) => {
      expect(rows[i]).toHaveTextContent(name);
      expect(rows[i]).toHaveTextContent(String(score));
    });
  });

  it("shows the plain-words reason under every block, not just the score", () => {
    renderRail();
    const rows = screen.getAllByRole("button");
    for (const block of adelaida.blocks.filter((b) => b.kind === "vine")) {
      const row = rows.find((r) => r.textContent?.includes(block.name))!;
      expect(row).toHaveTextContent(block.reason);
    }
  });

  it("shows the June 1 countdown", () => {
    renderRail();
    expect(screen.getByTestId("deadline")).toHaveTextContent("200 days");
  });

  it("says the deadline is today on June 1", () => {
    renderRail({ today: new Date(2027, 5, 1) });
    expect(screen.getByTestId("deadline")).toHaveTextContent("Deadline is today");
  });

  it("calls onSelect with the block id when a row is clicked", async () => {
    const onSelect = vi.fn();
    renderRail({ onSelect });
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(onSelect).toHaveBeenCalledWith("adelaida-3");
  });

  it("marks only the selected row as pressed", () => {
    renderRail({ selectedId: "adelaida-5" });
    const pressed = screen.getAllByRole("button").filter((r) => r.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent("Block 5");
  });

  it("lists habitat as no-mow and not as a clickable row", () => {
    renderRail();
    expect(screen.getByText("Oak woodland habitat")).toBeInTheDocument();
    expect(screen.getByText("Protected habitat: do not mow.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
});
