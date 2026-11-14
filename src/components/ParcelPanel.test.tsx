import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ParcelUnit } from "@/data/types";
import { ParcelPanel } from "./ParcelPanel";

const ring: [number, number][] = [
  [35.63, -120.86],
  [35.63, -120.85],
  [35.64, -120.85],
  [35.63, -120.86],
];
const parcel = (over: Partial<ParcelUnit> = {}): ParcelUnit => ({
  id: "014-331-010",
  parts: [[ring]],
  acres: 12.44,
  center: [35.635, -120.855],
  score: null,
  ...over,
});

describe("ParcelPanel", () => {
  it("names the parcel by its number and gives acres computed from the geometry", () => {
    render(<ParcelPanel parcel={parcel()} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Parcel 014-331-010" })).toBeInTheDocument();
    expect(screen.getByText("~12.4 acres")).toBeInTheDocument();
  });

  it("says plainly that an unscored parcel has no score, and shows no number", () => {
    render(<ParcelPanel parcel={parcel()} onClose={() => {}} />);
    expect(screen.getByText("Not scored yet. Scan the rows to score it.")).toBeInTheDocument();
    expect(screen.queryByTestId("score")).toBeNull();
    expect(screen.queryByText(/\/ 100/)).toBeNull();
  });

  it("links to the scanner for this parcel", () => {
    render(<ParcelPanel parcel={parcel()} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: "Scan the rows" })).toHaveAttribute("href", "/scan?parcel=014-331-010");
  });

  it("shows a scan score with the scan as its source", () => {
    const score = { score: 75, level: "high" as const, source: { kind: "scan" as const, at: "2026-11-14T10:00:00-08:00", risks: 3, clears: 1 } };
    render(<ParcelPanel parcel={parcel({ score })} onClose={() => {}} />);
    expect(screen.getByTestId("score")).toHaveTextContent("75");
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText(/Scan: 3 of 4 areas flagged/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scan again" })).toBeInTheDocument();
    expect(screen.queryByText("Not scored yet. Scan the rows to score it.")).toBeNull();
  });

  it("shows a risk-map score with the map and its coverage as the source", () => {
    const score = { score: 41, level: "medium" as const, source: { kind: "risk-map" as const, asOf: "2026-11-13T00:00:00Z", modelId: "m1", coverage: 0.82 } };
    render(<ParcelPanel parcel={parcel({ score })} onClose={() => {}} />);
    expect(screen.getByTestId("score")).toHaveTextContent("41");
    expect(screen.getByText(/Risk map: 82% of the parcel covered/)).toBeInTheDocument();
  });

  it("says the outline is a planning outline, not a survey", () => {
    render(<ParcelPanel parcel={parcel()} onClose={() => {}} />);
    expect(screen.getByText(/not a boundary survey/i)).toBeInTheDocument();
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<ParcelPanel parcel={parcel()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
