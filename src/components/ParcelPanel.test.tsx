import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ParcelUnit } from "@/data/types";
import { scaleColor } from "@/lib/riskScale";
import { PARCEL_RESET_KEY, PARCEL_SCAN_KEY } from "@/lib/parcelScanStore";
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

// This jsdom has no working localStorage, so the tests use a small in-memory one (as in useParcels.test.tsx).
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", memoryStorage);
});

describe("ParcelPanel before and after", () => {
  // The ring above is a triangle; (35.632, -120.853) is inside it.
  const scanAt = (risks: number, clears: number, at: string) => ({ lat: 35.632, lon: -120.853, risks, clears, at });
  const save = (...scans: ReturnType<typeof scanAt>[]) => window.localStorage.setItem(PARCEL_SCAN_KEY, JSON.stringify(scans));
  const scanned = { score: 25, level: "low" as const, source: { kind: "scan" as const, at: "2026-11-16T10:00:00Z", risks: 1, clears: 3 } };

  it("shows no row with fewer than two scans in the parcel", () => {
    save(scanAt(3, 1, "2026-11-14T10:00:00Z"));
    render(<ParcelPanel parcel={parcel()} onClose={() => {}} />);
    expect(screen.queryByTestId("before-after")).toBeNull();
  });

  it("shows the first and newest scan's scores, and links the rescan with rescan=1", () => {
    save(scanAt(3, 1, "2026-11-14T10:00:00Z"), scanAt(1, 3, "2026-11-16T10:00:00Z"));
    render(<ParcelPanel parcel={parcel({ score: scanned })} onClose={() => {}} />);
    const row = screen.getByTestId("before-after");
    expect(row).toHaveTextContent("Before 75");
    expect(row).toHaveTextContent("After 25");
    expect(screen.getByRole("link", { name: "Scan again" })).toHaveAttribute("href", "/scan?parcel=014-331-010&rescan=1");
  });

  it("Start over hides the row, keeps the scans and saves a marker for this parcel only", async () => {
    save(scanAt(3, 1, "2026-11-14T10:00:00Z"), scanAt(1, 3, "2026-11-16T10:00:00Z"));
    render(<ParcelPanel parcel={parcel()} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.queryByTestId("before-after")).toBeNull();
    expect(Object.keys(JSON.parse(window.localStorage.getItem(PARCEL_RESET_KEY)!))).toEqual(["014-331-010"]);
    expect(JSON.parse(window.localStorage.getItem(PARCEL_SCAN_KEY)!)).toHaveLength(2);
  });

  it("stays hidden on a remount after a reset", () => {
    save(scanAt(3, 1, "2026-11-14T10:00:00Z"), scanAt(1, 3, "2026-11-16T10:00:00Z"));
    window.localStorage.setItem(PARCEL_RESET_KEY, JSON.stringify({ "014-331-010": "2026-11-17T00:00:00Z" }));
    render(<ParcelPanel parcel={parcel()} onClose={() => {}} />);
    expect(screen.queryByTestId("before-after")).toBeNull();
  });
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

  it("colours the level chip on Nick's 0 to 100 scale, so it matches his parcel fill", () => {
    const score = { score: 12, level: "low" as const, source: { kind: "risk-map" as const, asOf: "2026-11-14T20:14:00Z", modelId: "m1", coverage: 1 } };
    render(<ParcelPanel parcel={parcel({ score })} onClose={() => {}} />);
    const want = document.createElement("i");
    want.style.color = scaleColor(12);
    expect(screen.getByText("Low").style.color).toBe(want.style.color);
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
