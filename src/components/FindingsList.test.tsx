import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { RiskArea } from "@/lib/fuelMask";
import type { Track } from "@/lib/scan";
import { AreaFindingsList, FindingsList } from "./FindingsList";

const area = (id: number, pctOfRisk: number): RiskArea => ({
  id,
  box: [0, 0, 0.5, 0.5],
  pctOfRisk,
  pctOfFrame: 10,
  where: "bottom left",
});
/** Every "N% of the dry fuel" on screen, summed. */
const shownTotal = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => Number(/(\d+)% of the dry fuel/.exec(li.textContent ?? "")?.[1] ?? 0))
    .reduce((a, b) => a + b, 0);

describe("AreaFindingsList", () => {
  it("leads with the biggest area's action and keeps reasons in closed details", () => {
    render(<AreaFindingsList areas={[{...area(1, 80), reasons:["SAM: dry grass", "colour: straw"]}, area(2, 20)]} notes={[
      {area:2,label:"Brush",reason:"Small patch",action:"Clear brush"},
      {area:1,label:"Dry grass",reason:"Dry stems",action:"Mow this patch"},
    ]} />);
    expect(screen.getByText("Do first: Mow this patch")).toHaveClass("font-semibold");
    expect(screen.getAllByText(/Mow this patch/)).toHaveLength(1);
    expect(within(screen.getAllByRole("listitem")[1]).getByText("Clear brush")).toBeInTheDocument();
    const details = screen.getByText("Dry stems").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("SAM: dry grass · colour: straw")).toBeInTheDocument();
    expect(within(details).getByText("Why")).toHaveClass("min-h-11");
  });

  it("folds a 2% area into smaller patches", () => {
    render(<AreaFindingsList areas={[area(1, 90), area(2, 2)]} notes={[]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Smaller patches: 10%/)).toBeInTheDocument();
    expect(shownTotal()).toBe(100);
  });

  it("always lists the first area and waits for its notes before leading with an action", () => {
    render(<AreaFindingsList areas={[area(1, 2), area(2, 1)]} notes={null} />);
    expect(screen.getByText("bottom left · 2% of the dry fuel")).toBeInTheDocument();
    expect(screen.getByText("Writing the findings…")).toHaveClass("scan-shimmer");
    expect(screen.queryByText(/Do first:/)).toBeNull();
  });

  it("shows what fired in an area under its line", () => {
    render(<AreaFindingsList areas={[{ ...area(1, 100), reasons: ["SAM: dry grass", "colour: straw", "GPT: dry tile"] }]} notes={[]} />);
    expect(screen.getByText("SAM: dry grass · colour: straw · GPT: dry tile")).toBeInTheDocument();
  });

  it("adds a Smaller patches line when 5% or more of the dry fuel is in unlisted areas", () => {
    render(<AreaFindingsList areas={[area(1, 60), area(2, 25)]} notes={[]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent("Smaller patches: 15% of the dry fuel");
    expect(shownTotal()).toBe(100);
  });

  it("leaves it out under 5%, and the percents still add up to 100 give or take 1", () => {
    render(<AreaFindingsList areas={[area(1, 70), area(2, 29)]} notes={[]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/Smaller patches/)).toBeNull();
    expect(Math.abs(shownTotal() - 100)).toBeLessThanOrEqual(1);
  });
});

const track = (id: number, over: Partial<Track> = {}): Track => ({
  id,
  missed: 0,
  label: "Dry grass",
  severity: "risk",
  action: "Mow by June 1",
  bbox: [100, 100, 500, 500],
  confidence: 0.9,
  ...over,
});

describe("FindingsList", () => {
  it("lists each finding as one line: name, then the action", () => {
    render(
      <FindingsList
        tracks={[
          track(1),
          track(2, { label: "Green cover crop", severity: "clear", action: "Keep it trimmed" }),
        ]}
        empty="Nothing yet."
      />,
    );
    const items = within(screen.getByRole("list", { name: "Findings" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Dry grass, mow by June 1");
    expect(items[1]).toHaveTextContent("Green cover crop, keep it trimmed");
  });

  it("says what each line is for people who cannot see the colour", () => {
    render(
      <FindingsList
        tracks={[track(1), track(2, { confidence: 0.7 }), track(3, { severity: "clear" })]}
        empty="Nothing yet."
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Risk");
    expect(items[1]).toHaveTextContent("Watch");
    expect(items[2]).toHaveTextContent("Clear");
  });

  it("shows the empty message when there are no findings", () => {
    render(<FindingsList tracks={[]} empty="Looking for fuels in view..." />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Looking for fuels in view...")).toBeInTheDocument();
  });
});
