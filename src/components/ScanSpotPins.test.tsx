import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { act, render } from "@testing-library/react";
import { MapContainer, useMap } from "react-leaflet";
import { ScanSpotPins, type ScanSpots } from "./ScanSpotPins";

beforeEach(() => {
  vi.spyOn(L.Map.prototype, "getSize").mockReturnValue(L.point(400, 400));
});
afterEach(() => vi.restoreAllMocks());

const BEFORE = { lat: 35.632, lon: -120.853 };
const AFTER = { lat: 35.6322, lon: -120.8528 };

function mount(spots: ScanSpots | null) {
  const seen = { map: null as L.Map | null };
  function Probe() {
    seen.map = useMap();
    return null;
  }
  const view = render(
    <MapContainer center={[35.632, -120.853]} zoom={19} style={{ height: 400, width: 400 }}>
      <ScanSpotPins spots={spots} />
      <Probe />
    </MapContainer>,
  );
  return { ...seen, ...view };
}

describe("ScanSpotPins", () => {
  it("shows no pin without a scan", () => {
    const { container } = mount(null);
    expect(container.querySelectorAll(".leaflet-scan-spots-pane span")).toHaveLength(0);
  });

  it("shows one pin at the first scan, and a second in a different tone once there is a rescan", () => {
    const one = mount({ before: BEFORE });
    expect(one.container.querySelectorAll(".leaflet-scan-spots-pane span")).toHaveLength(1);
    one.unmount();
    const { container } = mount({ before: BEFORE, after: AFTER });
    const [before, after] = [...container.querySelectorAll<HTMLElement>(".leaflet-scan-spots-pane span")];
    expect(container.querySelectorAll(".leaflet-scan-spots-pane span")).toHaveLength(2);
    expect(before.className).toContain("border-ink/70");
    expect(after.className).toContain("border-low/70");
    expect(before.className).not.toBe(after.className);
  });

  it("puts the pins in their own pane, above the pills, and hides it while the map moves", () => {
    const { map, container } = mount({ before: BEFORE });
    const pane = map!.getPane("scan-spots")!;
    expect(pane.classList.contains("leaflet-scan-spots-pane")).toBe(true);
    expect(Number(pane.style.zIndex)).toBeGreaterThan(600);
    expect(pane.contains(container.querySelector(".leaflet-scan-spots-pane span"))).toBe(true);
    act(() => void map!.fire("movestart"));
    expect(pane.style.visibility).toBe("hidden");
    act(() => void map!.fire("moveend"));
    expect(pane.style.visibility).toBe("visible");
  });
});
