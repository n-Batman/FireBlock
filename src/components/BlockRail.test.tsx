import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlockRail } from "./BlockRail";
import { properties } from "@/data/properties";
import type { ParcelUnit } from "@/data/types";
import { scaleColor } from "@/lib/riskScale";
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

describe("BlockRail with county parcels", () => {
  const ring: [number, number][] = [
    [35.63, -120.86],
    [35.63, -120.85],
    [35.64, -120.85],
    [35.63, -120.86],
  ];
  const parcel = (id: string, over: Partial<ParcelUnit> = {}): ParcelUnit => ({
    id,
    parts: [[ring]],
    acres: 12.44,
    center: [35.635, -120.855],
    score: null,
    ...over,
  });
  const scan = { score: 75, level: "high" as const, source: { kind: "scan" as const, at: "2026-11-14T10:00:00-08:00", risks: 3, clears: 1 } };
  const riskMap = { score: 41, level: "medium" as const, source: { kind: "risk-map" as const, asOf: "2026-11-13T00:00:00Z", modelId: "m1", coverage: 0.82 } };

  const renderParcels = (parcels: ParcelUnit[], over: Partial<Parameters<typeof BlockRail>[0]> = {}) =>
    render(<BlockRail property={adelaida} parcels={parcels} selectedId={null} onSelect={() => {}} today={today} {...over} />);

  it("lists the parcels by parcel number, with acres from the geometry", () => {
    renderParcels([parcel("014-331-010"), parcel("014-331-011", { acres: 3.06 })]);
    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("014-331-010");
    expect(rows[0]).toHaveTextContent("~12.4 acres");
    expect(rows[1]).toHaveTextContent("~3.1 acres");
  });

  it("shows 'Not scored yet' for a parcel with no score, and no risk chip", () => {
    renderParcels([parcel("014-331-010")]);
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("Not scored yet. Scan the rows to score it.");
    expect(row).not.toHaveTextContent(/High|Medium|Low/);
  });

  it("shows a scored parcel's score and where it came from", () => {
    renderParcels([parcel("014-331-010", { score: scan }), parcel("014-331-011", { score: riskMap })]);
    const [a, b] = screen.getAllByRole("button");
    expect(a).toHaveTextContent("75");
    expect(a).toHaveTextContent("Scan: 3 of 4 areas flagged");
    expect(b).toHaveTextContent("41");
    expect(b).toHaveTextContent("Risk map: 82% of the parcel covered");
  });

  it("colours a scored parcel's chip on Nick's 0 to 100 scale, so it matches his parcel fill", () => {
    renderParcels([parcel("A-1", { score: scan })]); // 75
    const chip = screen.getByText("High");
    const want = document.createElement("i");
    want.style.color = scaleColor(75);
    want.style.backgroundColor = scaleColor(75, 0.18);
    expect(chip.style.color).toBe(want.style.color);
    expect(chip.style.backgroundColor).toBe(want.style.backgroundColor);
  });

  it("leaves the sample blocks' chips on the Low, Medium, High colours", () => {
    renderRail();
    expect(screen.getAllByText("High")[0].style.color).toBe("");
  });

  it("lists scored parcels first, highest score first, then the unscored by parcel number", () => {
    renderParcels([parcel("A-9"), parcel("A-1", { score: riskMap }), parcel("A-2", { score: scan }), parcel("A-0")]);
    const ids = screen.getAllByRole("button").map((r) => r.textContent?.match(/A-\d/)?.[0]);
    expect(ids).toEqual(["A-2", "A-1", "A-0", "A-9"]);
  });

  it("lists the parcel at the searched point first, labelled, even among scored ones", () => {
    renderParcels([parcel("A-1", { score: scan }), parcel("Z-9", { atPoint: true }), parcel("A-0")]);
    const rows = screen.getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Z-9");
    expect(rows[0]).toHaveTextContent("At your search");
    expect(rows[1]).toHaveTextContent("A-1");
    expect(rows[1]).not.toHaveTextContent("At your search");
  });

  it("selects a parcel by its id, and marks only that row as pressed", async () => {
    const onSelect = vi.fn();
    renderParcels([parcel("014-331-010"), parcel("014-331-011")], { onSelect, selectedId: "014-331-011" });
    await userEvent.click(screen.getByRole("button", { name: /014-331-010/ }));
    expect(onSelect).toHaveBeenCalledWith("014-331-010");
    const pressed = screen.getAllByRole("button").filter((r) => r.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent("014-331-011");
  });

  it("does not show the sample blocks or the sample mowing savings", () => {
    renderParcels([parcel("014-331-010")]);
    expect(screen.queryByText("Ridge Top")).toBeNull();
    expect(screen.queryByRole("link", { name: /Mow \d+ blocks?/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Parcels near your search" })).toBeInTheDocument();
  });

  it("says so when no parcels came back", () => {
    renderParcels([]);
    expect(screen.getByText("No parcels found within 300 m of that point.")).toBeInTheDocument();
  });
});
