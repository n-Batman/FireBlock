import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlockRail } from "./BlockRail";
import { properties } from "@/data/properties";
import { applyScans } from "@/lib/scanStore";

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
      ["Ridge Top", 78],
      ["South Slope", 71],
      ["Old Vine Row", 58],
      ["Cabernet East", 49],
      ["Creek Bottom", 33],
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
    expect(pressed[0]).toHaveTextContent("South Slope");
  });

  it("lists habitat as no-mow and not as a clickable row", () => {
    renderRail();
    expect(screen.getByText("Oak woodland habitat")).toBeInTheDocument();
    expect(screen.getByText("Protected habitat: do not mow.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("shows the savings line under the countdown, linked to the plan", () => {
    renderRail();
    expect(screen.getByRole("link", { name: /Mow 2 blocks, not 5\. Save \$1,728\./ })).toHaveAttribute(
      "href",
      "/plan?property=adelaida-hills",
    );
  });

  it("recounts the savings when a scan pushes another block to High", () => {
    // Old Vine Row is 58. Three risks add 18, so it becomes High at 76.
    const scanned = applyScans(adelaida, {
      "adelaida-hills:adelaida-4": { risks: 3, clears: 0, at: "2026-11-14T10:00:00-08:00" },
    });
    renderRail({ property: scanned });
    expect(screen.getByRole("link", { name: /Mow 3 blocks, not 5\./ })).toBeInTheDocument();
  });

  it("uses the singular for one block", () => {
    // Highway Edge is 55. Three risks add 18, so it becomes the only High block of 3.
    const scanned = applyScans(properties[1], {
      "paso-hwy-46-east:paso-1": { risks: 3, clears: 0, at: "2026-11-14T10:00:00-08:00" },
    });
    renderRail({ property: scanned });
    expect(screen.getByRole("link", { name: /Mow 1 block, not 3\./ })).toBeInTheDocument();
  });

  it("says there is no urgent mowing at a property with no High blocks", () => {
    renderRail({ property: properties[2] });
    const line = screen.getByRole("link", { name: /No High-risk blocks\. No urgent mowing\./ });
    expect(line).toHaveAttribute("href", "/plan?property=edna-valley");
    expect(screen.queryByText(/Save/)).toBeNull();
  });
});
