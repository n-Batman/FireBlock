import { describe, expect, it } from "vitest";
import { CLEAR, NEUTRAL, RISK } from "@/lib/fuelMask";
import { paint } from "./FuelOverlay";

describe("paint", () => {
  it("washes clear green with a softer edge, fills risk red with a stronger edge, leaves neutral empty", () => {
    const w = 5;
    const labels = Uint8Array.from([
      CLEAR, CLEAR, NEUTRAL, NEUTRAL, NEUTRAL,
      CLEAR, CLEAR, RISK, RISK, RISK,
      NEUTRAL, NEUTRAL, RISK, RISK, RISK,
      NEUTRAL, NEUTRAL, RISK, RISK, RISK,
    ]);
    const out = new Uint8ClampedArray(labels.length * 4);
    paint({ w, h: 4, labels }, out);
    const at = (i: number) => [...out.slice(i * 4, i * 4 + 4)];
    expect(at(0)).toEqual([74, 222, 128, Math.round(0.32 * 255)]);
    expect(at(6)[3]).toBe(Math.round(0.18 * 255)); // clear next to risk: softer edge
    expect(at(2)).toEqual([0, 0, 0, 0]);
    expect(at(13)).toEqual([239, 68, 68, Math.round(0.38 * 255)]); // inside the risk patch
    expect(at(7)[3]).toBeGreaterThan(at(13)[3]); // on its edge
  });
});

describe("FuelOverlay", () => {
  it("places the map where contain-top puts the photo (top of the box), and where cover crops it by default", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { vi } = await import("vitest");
    const { FuelOverlay } = await import("./FuelOverlay");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
        observe() {
          this.cb([{ contentRect: { width: 390, height: 780 } }]);
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const map = { w: 4, h: 3, labels: new Uint8Array(12), verdict: { risk: 0, clear: 0, share: null, level: "none" as const, text: "" }, areas: [], colourOnly: false };
    const { unmount } = render(<FuelOverlay videoSize={{ w: 1024, h: 768 }} map={map} fit="contain-top" />);
    const contain = screen.getByTestId("fuel-overlay").style;
    expect([contain.left, contain.top, contain.width]).toEqual(["0px", "0px", "390px"]);
    unmount();
    render(<FuelOverlay videoSize={{ w: 1024, h: 768 }} map={map} />);
    expect(parseFloat(screen.getByTestId("fuel-overlay").style.left)).toBeLessThan(0); // cover crops the sides
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
