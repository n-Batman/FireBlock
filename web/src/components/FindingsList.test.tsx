import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Track } from "@/lib/scan";
import { FindingsList } from "./FindingsList";

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
