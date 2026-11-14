import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Track } from "@/lib/scan";
import { ScanOverlay } from "./ScanOverlay";

const track = (id: number, over: Partial<Track> = {}): Track => ({
  id,
  missed: 0,
  label: "Dry grass",
  severity: "risk",
  action: "Mow by June 1",
  bbox: [100, 300, 500, 600],
  confidence: 0.9,
  ...over,
});

const SCREEN = { w: 390, h: 844 };
const VIDEO = { w: 390, h: 844 };

beforeEach(() => {
  // jsdom has no layout: report a phone-sized overlay as soon as it is observed.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width: SCREEN.w, height: SCREEN.h } }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderOverlay = (tracks: Track[]) =>
  render(<ScanOverlay videoSize={VIDEO} tracks={tracks} running />);

const pillOf = (name: string) => screen.getByText(name).closest("[data-pill]") as HTMLElement;
const offset = (el: HTMLElement) => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform)!;
  return { x: Number(m[1]), y: Number(m[2]) };
};

describe("ScanOverlay", () => {
  it("draws four corner brackets per finding, not a full rectangle", () => {
    renderOverlay([track(1), track(2, { label: "Green rows", severity: "clear", bbox: [600, 300, 900, 600] })]);
    expect(screen.getAllByTestId("bracket")).toHaveLength(8);
  });

  it("fills risk and clear regions equally", () => {
    renderOverlay([track(1), track(2, { label: "Green rows", severity: "clear", bbox: [600, 300, 900, 600] })]);
    expect(screen.getAllByTestId("fill")).toHaveLength(2);
  });

  it("colours by tone: red risk, amber watch, green clear", () => {
    renderOverlay([
      track(1, { label: "Risk one" }),
      track(2, { label: "Watch one", confidence: 0.7, bbox: [550, 300, 900, 600] }),
      track(3, { label: "Clear one", severity: "clear", bbox: [100, 650, 400, 950] }),
    ]);
    expect(pillOf("Risk one").dataset.tone).toBe("risk");
    expect(pillOf("Watch one").dataset.tone).toBe("watch");
    expect(pillOf("Clear one").dataset.tone).toBe("clear");
  });

  it("shows only the name on the camera. The action lives in the card.", () => {
    renderOverlay([track(1)]);
    expect(screen.getByText("Dry grass")).toBeInTheDocument();
    expect(screen.queryByText("Mow by June 1")).toBeNull();
  });

  it("keeps a label inside the screen when its box hugs the right edge", () => {
    renderOverlay([track(1, { label: "Brush near the barn wall", bbox: [880, 300, 999, 600] })]);
    const pill = pillOf("Brush near the barn wall");
    expect(offset(pill).x + parseFloat(pill.style.width)).toBeLessThanOrEqual(SCREEN.w - 12);
    expect(offset(pill).x).toBeGreaterThanOrEqual(12);
  });

  it("puts the label below the box when the box touches the top", () => {
    renderOverlay([track(1, { bbox: [100, 0, 500, 300] })]);
    expect(offset(pillOf("Dry grass")).y).toBeGreaterThanOrEqual(0.3 * SCREEN.h);
  });

  it("renders nothing for findings until the screen size is known", () => {
    render(<ScanOverlay videoSize={null} tracks={[track(1)]} running />);
    expect(screen.queryByTestId("bracket")).toBeNull();
    expect(within(document.body).queryByText("Dry grass")).toBeNull();
  });
});
