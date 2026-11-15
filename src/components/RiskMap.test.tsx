import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MapContainer, useMap } from "react-leaflet";
import type { ParcelUnit } from "@/data/types";
import { scaleColor } from "@/lib/riskScale";
import RiskMap, { ParcelPolygons, ViewWatcher } from "./RiskMap";

vi.hoisted(() => {
  // Canvas pixels are mocked below. Avoid queued painting callbacks surviving
  // map teardown; projection, DOM events and Leaflet hit testing still run.
  let frame = 0;
  vi.stubGlobal("requestAnimationFrame", () => ++frame);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

beforeEach(() => {
  // jsdom has no drawing context; keep real Leaflet Canvas layers and hit testing.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    translate: vi.fn(), scale: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    setTransform: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(L.Map.prototype, "getSize").mockReturnValue(L.point(400, 400));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const SQUARE = (lat: number, lng: number, d: number): [number, number][] => [
  [lat, lng],
  [lat, lng + d],
  [lat + d, lng + d],
  [lat + d, lng],
  [lat, lng],
];
const unit = (id: string, over: Partial<ParcelUnit> = {}): ParcelUnit => ({
  id,
  parts: [[SQUARE(35.63, -120.86, 0.004)]],
  acres: 30,
  center: [35.632, -120.858],
  score: null,
  ...over,
});
const high = { score: 78, level: "high" as const, source: { kind: "scan" as const, at: "2026-11-14T10:00:00-08:00", risks: 4, clears: 1 } };

/** Collects the polygons and markers on the map, so the test can look at the real Leaflet layers. */
function mount(parcels: ParcelUnit[], selectedId: string | null = null, onSelect: (id: string) => void = () => {}) {
  const seen = { polygons: [] as L.Polygon[], markers: [] as L.Marker[], map: null as L.Map | null };
  // react-leaflet adds layers in effects, so the probe reads them in its own effect, which runs after.
  function Probe() {
    const map = useMap();
    seen.map = map;
    useEffect(() => {
      map.eachLayer((layer) => {
        if (layer instanceof L.Polygon) seen.polygons.push(layer);
        else if (layer instanceof L.Marker) seen.markers.push(layer);
      });
    }, [map]);
    return null;
  }
  const mounted = render(
    <MapContainer center={[35.63, -120.86]} zoom={17} style={{ height: 400, width: 400 }}>
      <ParcelPolygons parcels={parcels} selectedId={selectedId} onSelect={onSelect} />
      <Probe />
    </MapContainer>,
  );
  return { ...seen, ...mounted };
}
const interactive = (polys: L.Polygon[]) => polys.filter((p) => p.options.interactive !== false);
const color = (p: L.Polygon) => p.options.color;
const redraw = (seen: ReturnType<typeof mount>, parcels: ParcelUnit[], selectedId: string | null, onSelect: (id: string) => void) =>
  seen.rerender(<MapContainer center={[35.63, -120.86]} zoom={17} style={{height:400,width:400}}>
    <ParcelPolygons parcels={parcels} selectedId={selectedId} onSelect={onSelect}/>
  </MapContainer>);

describe("ViewWatcher", () => {
  it("reports the map view once, 400 ms after it stops moving", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onView = vi.fn();
    let map: L.Map | null = null;
    function Grab() {
      map = useMap();
      return null;
    }
    render(
      <MapContainer center={[35.63, -120.86]} zoom={15} style={{ height: 400, width: 400 }}>
        <ViewWatcher onView={onView} />
        <Grab />
      </MapContainer>,
    );
    expect(onView).toHaveBeenCalledTimes(1);
    onView.mockClear();
    act(() => {
      map!.fire("moveend");
      vi.advanceTimersByTime(300);
      map!.fire("moveend"); // moved again: the wait starts over
      vi.advanceTimersByTime(399);
    });
    expect(onView).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView.mock.calls[0][0]).toEqual({
      west: expect.any(Number),
      south: expect.any(Number),
      east: expect.any(Number),
      north: expect.any(Number),
      zoom: 15,
    });
    act(()=>{map!.fire('zoomend');});
    expect(onView).toHaveBeenCalledTimes(2); // zoom changes bypass the pan debounce
    vi.useRealTimers();
  });
});

describe("ParcelPolygons", () => {
  it("creates one parcel-pills pane at zIndex 600 and reuses it on remount", () => {
    const createPane = vi.spyOn(L.Map.prototype, "createPane");
    const parcels = [unit("a", {score: high}), unit("b", {score: high})], onSelect = vi.fn();
    const seen = mount(parcels, null, onSelect);
    const pane = seen.map!.getPane("parcel-pills")!;
    expect(pane.style.zIndex).toBe("600");
    seen.markers.forEach(marker => {
      expect(marker.options.pane).toBe("parcel-pills");
      expect(marker.getElement()!.parentElement).toBe(pane);
    });
    seen.rerender(<MapContainer center={[35.63,-120.86]} zoom={17}/>);
    redraw(seen, parcels, null, onSelect);
    expect(seen.map!.getPane("parcel-pills")).toBe(pane);
    expect(createPane.mock.calls.filter(([name]) => name === "parcel-pills")).toHaveLength(1);
  });

  it("hides only parcel pills during movement and restores them after pan and zoom", () => {
    const seen = mount([unit("a", {score: high})]);
    const map = seen.map!, pane = map.getPane("parcel-pills")!;
    const overlay = map.getPane("overlayPane")!, markerPane = map.getPane("markerPane")!;
    const sample = L.marker([35.63,-120.86], {icon: L.divIcon({html:"Sample block pill"})}).addTo(map);
    const controls = seen.container.querySelector<HTMLElement>(".leaflet-control-container")!;
    const overlayVisibility = overlay.style.visibility, controlsVisibility = controls.style.visibility;
    const markerElement = seen.markers[0].getElement();
    for (const [start, end] of [["movestart","moveend"],["zoomstart","zoomend"]]) {
      act(() => { map.fire(start); });
      expect(pane.style.visibility).toBe("hidden");
      expect(overlay.style.visibility).toBe(overlayVisibility);
      expect(controls.style.visibility).toBe(controlsVisibility);
      expect(sample.getElement()!.parentElement).toBe(markerPane);
      expect(markerPane.style.visibility).not.toBe("hidden");
      expect(getComputedStyle(sample.getElement()!).visibility).not.toBe("hidden");
      act(() => { map.fire(end); });
      expect(pane.style.visibility).toBe("visible");
      expect(seen.markers[0].getElement()).toBe(markerElement);
    }
  });

  it("removes pill movement listeners and restores visibility when parcel rendering unmounts", () => {
    const seen = mount([unit("a", {score: high})]);
    const map = seen.map!, pane = map.getPane("parcel-pills")!;
    const off = vi.spyOn(map, "off");
    act(() => { map.fire("movestart"); });
    expect(pane.style.visibility).toBe("hidden");
    seen.rerender(<MapContainer center={[35.63,-120.86]} zoom={17}/>);
    expect(pane.style.visibility).toBe("visible");
    expect(off).toHaveBeenCalledWith("movestart zoomstart", expect.any(Function));
    expect(off).toHaveBeenCalledWith("moveend zoomend", expect.any(Function));
    act(() => { map.fire("zoomstart"); });
    expect(pane.style.visibility).toBe("visible");
  });

  it("shares DivIcons across identical pills and reuses them after a selection round trip", () => {
    const parcels = [unit("a", {score: high}), unit("b", {score: high})], onSelect = vi.fn();
    const seen = mount(parcels, null, onSelect);
    const original = seen.markers[0].options.icon;
    expect(seen.markers[1].options.icon).toBe(original);
    redraw(seen, parcels, "a", onSelect);
    expect(seen.markers[0].options.icon).not.toBe(original);
    expect(seen.markers[1].options.icon).not.toBe(original);
    expect(seen.markers[0].options.icon).not.toBe(seen.markers[1].options.icon);
    redraw(seen, parcels, null, onSelect);
    expect(seen.markers[0].options.icon).toBe(original);
    expect(seen.markers[1].options.icon).toBe(original);
  });
  it("keeps pill DOM and polygon styles stable across identical parcel rerenders", () => {
    const parcels = [unit("a", {score: high}), unit("b", {score: high})], onSelect = vi.fn();
    const seen = mount(parcels, "a", onSelect);
    const styles = seen.polygons.map(poly => vi.spyOn(poly, "setStyle"));
    const icons = seen.markers.map(marker => vi.spyOn(marker, "setIcon"));
    const elements = seen.markers.map(marker => marker.getElement()!.firstElementChild);
    const cloned = parcels.map(parcel => ({...parcel, score: parcel.score && {...parcel.score}}));
    redraw(seen, cloned, "a", onSelect);
    styles.forEach(style => expect(style).not.toHaveBeenCalled());
    icons.forEach(icon => expect(icon).not.toHaveBeenCalled());
    seen.markers.forEach((marker, i) => expect(marker.getElement()!.firstElementChild).toBe(elements[i]));
  });

  it("updates only the changed parcel's icon, style and selected glow when its score changes", () => {
    const parcels = [unit("a", {score: high}), unit("b", {score: high})], onSelect = vi.fn();
    const seen = mount(parcels, "a", onSelect);
    const [a, b] = interactive(seen.polygons);
    const aStyle = vi.spyOn(a, "setStyle"), bStyle = vi.spyOn(b, "setStyle");
    const glowStyle = vi.spyOn(seen.polygons.find(poly => poly.options.weight === 14)!, "setStyle");
    const [aPill, bPill] = seen.markers;
    const aIcon = vi.spyOn(aPill, "setIcon"), bIcon = vi.spyOn(bPill, "setIcon");
    redraw(seen, [{...parcels[0], score: {...high, score: 40, level: "medium"}}, parcels[1]], "a", onSelect);
    expect(aStyle).toHaveBeenCalledTimes(1);expect(glowStyle).toHaveBeenCalledTimes(1);
    expect(aIcon).toHaveBeenCalledTimes(1);
    expect(bStyle).not.toHaveBeenCalled();expect(bIcon).not.toHaveBeenCalled();
    expect(a.options.color).toBe(scaleColor(40));
    expect((aPill.options.icon as L.DivIcon).options.html).toContain(">40<");
  });

  it("updates selection and dimming without refreshing unaffected parcel icons or styles", () => {
    const parcels = [unit("a", {score: high}), unit("b", {score: high}), unit("c", {score: high})], onSelect = vi.fn();
    const seen = mount(parcels, "a", onSelect);
    const [a, b, c] = interactive(seen.polygons);
    const styles = [a, b, c].map(poly => vi.spyOn(poly, "setStyle"));
    const icons = seen.markers.map(marker => vi.spyOn(marker, "setIcon"));
    redraw(seen, parcels, "b", onSelect);
    expect(styles[0]).toHaveBeenCalledTimes(1);expect(styles[1]).toHaveBeenCalledTimes(1);
    expect(styles[2]).not.toHaveBeenCalled();
    expect(icons[0]).toHaveBeenCalledTimes(1);expect(icons[1]).toHaveBeenCalledTimes(1);
    expect(icons[2]).not.toHaveBeenCalled();
    expect(a.options.opacity).toBe(.45);expect(b.options.weight).toBe(4);
    expect((seen.markers[1].options.icon as L.DivIcon).options.html).toContain("ring-2 ring-ink");
  });

  it("keeps click handlers current without replacing icons or reapplying styles", () => {
    const parcels = [unit("a", {score: high})], previous = vi.fn(), next = vi.fn();
    const seen = mount(parcels, null, previous);
    const [poly] = interactive(seen.polygons), [marker] = seen.markers;
    const style = vi.spyOn(poly, "setStyle"), icon = vi.spyOn(marker, "setIcon");
    redraw(seen, parcels, null, next);
    poly.fire("click");marker.fire("click");
    expect(previous).not.toHaveBeenCalled();expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledWith("a");
    expect(style).not.toHaveBeenCalled();expect(icon).not.toHaveBeenCalled();
  });
  it("shares one padded Canvas renderer across parcels and leaves the glow on SVG", () => {
    const seen = mount([unit("a"), unit("b")], "a");
    const [a, b] = interactive(seen.polygons);
    expect(a.options.renderer).toBeInstanceOf(L.Canvas);
    expect(b.options.renderer).toBe(a.options.renderer);
    expect(a.options.renderer!.options.padding).toBe(0.5);
    expect(seen.polygons.find(p => p.options.weight === 14)!.options.renderer).toBeUndefined();
    expect(seen.map!.options.preferCanvas).not.toBe(true);
    expect(seen.container.querySelectorAll("canvas")).toHaveLength(1);
    expect(seen.container.querySelector("svg")).not.toBeNull();
  });

  it("keeps Canvas parcel clicks and sticky tooltips working through hit testing", () => {
    const onSelect = vi.fn();
    const parcel = unit("canvas-click", { parts: [[SQUARE(35.629, -120.861, 0.002)]], center: [35.63, -120.86] });
    const seen = mount([parcel], null, onSelect);
    const canvas = seen.container.querySelector("canvas")!;
    const point = seen.map!.latLngToContainerPoint(parcel.center);
    fireEvent.mouseMove(canvas, { clientX: point.x, clientY: point.y });
    expect(interactive(seen.polygons)[0].getTooltip()!.options.sticky).toBe(true);
    expect(screen.getByText("Parcel canvas-click")).toBeInTheDocument();
    fireEvent.click(canvas, { clientX: point.x, clientY: point.y });
    expect(onSelect).toHaveBeenCalledWith("canvas-click");
  });

  it("keeps the Canvas renderer and parcel layer when unchanged positions are rerendered", () => {
    const parcels = [unit("a"), unit("b")], onSelect = vi.fn();
    const seen = mount(parcels, null, onSelect);
    const [first] = interactive(seen.polygons);
    const positions = vi.spyOn(first, "setLatLngs");
    const canvas = seen.container.querySelector("canvas");
    seen.rerender(<MapContainer center={[35.63, -120.86]} zoom={17} style={{height:400,width:400}}>
      <ParcelPolygons parcels={[...parcels]} selectedId="a" onSelect={onSelect}/>
    </MapContainer>);
    expect(seen.container.querySelector("canvas")).toBe(canvas);
    expect(seen.map!.hasLayer(first)).toBe(true);
    expect(positions).not.toHaveBeenCalled();
    expect(first.options.weight).toBe(4);
  });
  it("draws one clickable polygon per parcel", () => {
    const seen = mount([unit("a"), unit("b", { parts: [[SQUARE(35.64, -120.86, 0.004)]] })]);
    expect(interactive(seen.polygons)).toHaveLength(2);
  });

  it("hands Leaflet [lat, lng], so the first number of every point is a latitude", () => {
    const [poly] = interactive(mount([unit("a")]).polygons);
    // Leaflet nests it as polygon, then ring, then point.
    const first = (poly.getLatLngs() as L.LatLng[][][])[0][0][0];
    expect(first.lat).toBeCloseTo(35.63, 6);
    expect(first.lng).toBeCloseTo(-120.86, 6);
  });

  it("keeps every part and every hole of a MultiPolygon", () => {
    const multi = unit("m", {
      parts: [
        [SQUARE(35.63, -120.86, 0.04), SQUARE(35.64, -120.85, 0.01)], // outer ring with a hole
        [SQUARE(35.63, -120.8, 0.01)],
      ],
    });
    const [poly] = interactive(mount([multi]).polygons);
    const parts = poly.getLatLngs() as L.LatLng[][][];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(2); // outer + hole
    expect(parts[0][1][0].lat).toBeCloseTo(35.64, 6); // the hole, lat first
    expect(parts[1]).toHaveLength(1);
  });

  it("draws an unscored parcel as a neutral outline, not in a risk colour", () => {
    const [poly] = interactive(mount([unit("a")]).polygons);
    expect(color(poly)).toBe("#b7c5bc");
    expect(["#5db67f", "#e0a83a", "#e5675a"]).not.toContain(color(poly));
  });

  it("draws a scored parcel's outline and fill on Nick's 0 to 100 scale, so they match his fill and the pill", () => {
    const [poly] = interactive(mount([unit("a", { score: high })]).polygons); // 78
    expect(color(poly)).toBe(scaleColor(78));
    expect(poly.options.fillColor).toBe(scaleColor(78));
    expect(poly.options.weight).toBe(2);
    expect(poly.options.fillOpacity).toBe(0.15);
  });

  it("gives two scores two different colours, not one colour per level", () => {
    const seen = mount([
      unit("a", { score: { ...high, score: 40, level: "medium" } }),
      unit("b", { score: { ...high, score: 50, level: "medium" }, parts: [[SQUARE(35.64, -120.86, 0.004)]] }),
    ]);
    const [a, b] = interactive(seen.polygons);
    expect(color(a)).toBe(scaleColor(40));
    expect(color(b)).toBe(scaleColor(50));
    expect(color(a)).not.toBe(color(b));
  });

  it("gives the selected parcel the heavier casing and a glow, and fades the others", () => {
    const seen = mount([unit("a", { score: high }), unit("b", { parts: [[SQUARE(35.64, -120.86, 0.004)]] })], "a");
    const [a, b] = interactive(seen.polygons);
    expect(a.options.weight).toBe(4);
    expect(a.options.fillOpacity).toBe(0.22);
    expect(b.options.opacity).toBe(0.45);
    const glow = seen.polygons.find((p) => p.options.weight === 14);
    expect(glow).toBeDefined();
    expect(glow!.options.interactive).toBe(false);
    expect(glow!.options.color).toBe(scaleColor(78)); // the glow matches its parcel
  });

  it("calls onSelect with the parcel id when a parcel is clicked", () => {
    const onSelect = vi.fn();
    const [poly] = interactive(mount([unit("014-331-010")], null, onSelect).polygons);
    poly.fire("click");
    expect(onSelect).toHaveBeenCalledWith("014-331-010");
  });

  it("colours a parcel's score pill on Nick's 0 to 100 scale, so it matches his parcel fill", () => {
    const [marker] = mount([unit("a", { score: { ...high, score: 12, level: "low" } })]).markers;
    const html = (marker.options.icon as L.DivIcon).options.html as string;
    expect(html).toContain(`color:${scaleColor(12)}`);
    expect(html).toContain(`border-color:${scaleColor(12)}`);
    expect(html).toContain(">12<");
    expect(html).toContain("bg-[var(--glass-bg)]");
    expect(html).not.toContain("backdrop-blur-md");
  });

  it("puts a score pill only on a scored parcel", () => {
    expect(mount([unit("a")]).markers).toHaveLength(0);
    expect(mount([unit("a", { score: high })]).markers).toHaveLength(1);
  });
});

const overlay = vi.hoisted(() => ({ map: null as L.Map | null, mask: undefined as unknown, grid: false, active: null as ((active: boolean) => void) | null }));
vi.mock("@/lib/ParcelOverlay", () => ({
  ParcelOverlay: ({ onGridActive, parcelMask, showGrid }: { onGridActive: (active: boolean) => void; parcelMask: unknown; showGrid: boolean }) => {
    overlay.mask = parcelMask; overlay.grid = showGrid;
    overlay.map = useMap();
    overlay.active = onGridActive;
    return null;
  },
}));

describe("RiskMap opening", () => {
  const place = { lat: 35.63, lon: -120.86, label: "Chosen place", id: 1 };
  const property = { id: "test", name: "Test", center: [35.63, -120.86], blocks: [] } as unknown as import("@/data/types").Property;
  const props = { property, place, selectedId: null, onSelect: () => {}, panelOpen: false };
  const tiles = () => {
    let tile: L.TileLayer;
    overlay.map!.eachLayer(layer => { if (layer instanceof L.TileLayer) tile = layer; });
    return tile!;
  };
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));

  it("toggles boundaries independently and removes their grid mask", () => {
    render(<RiskMap {...props} parcels={[unit("a")]} />);
    const polygons = () => {
      const layers: L.Polygon[] = [];
      overlay.map!.eachLayer(layer => { if(layer instanceof L.Polygon) layers.push(layer); });
      return layers;
    };
    expect(polygons()).toHaveLength(1);
    expect(overlay.mask).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", {name:"Property boundaries"}));
    expect(polygons()).toHaveLength(0);
    expect(overlay.mask).toEqual([]);
    expect(overlay.grid).toBe(true);
    fireEvent.click(screen.getByRole("button", {name:"Risk grid"}));
    expect(overlay.grid).toBe(false);
    expect(screen.getByRole("button", {name:"Risk grid"})).toHaveAttribute("aria-pressed","false");
    fireEvent.click(screen.getByRole("button", {name:"Property boundaries"}));
    expect(polygons()).toHaveLength(1);
    expect(overlay.mask).toHaveLength(1);
  });

  it("waits for tiles and the first parcels, then fades and unmounts", () => {
    const view = render(<RiskMap {...props} parcels={[]} />);
    expect(screen.getByText("Loading the map…")).toBeInTheDocument();
    act(() => { tiles().fire("load"); });
    expect(screen.getByText("Loading the map…")).toBeInTheDocument();
    view.rerender(<RiskMap {...props} parcels={[unit("a")]} />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Loading the map…")).toBeNull();
  });

  it("also accepts the first active grid", () => {
    render(<RiskMap {...props} parcels={[]} />);
    act(() => { overlay.active!(true); });
    expect(screen.getByText("Loading the map…")).toBeInTheDocument();
    act(() => { tiles().fire("load"); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Loading the map…")).toBeNull();
  });

  it("starts fading at four seconds even without tiles or data", () => {
    render(<RiskMap {...props} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText("Loading the map…").parentElement).toHaveClass("opacity-0");
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Loading the map…")).toBeNull();
  });

  it("hides immediately on a tile error", () => {
    render(<RiskMap {...props} />);
    act(() => { tiles().fire("tileerror"); });
    expect(screen.queryByText("Loading the map…")).toBeNull();
  });

  it("does not fit or fly on mount at a place, and flies on later picks", () => {
    const fit = vi.spyOn(L.Map.prototype, "fitBounds");
    const fly = vi.spyOn(L.Map.prototype, "flyTo");
    const view = render(<RiskMap {...props} />);
    expect(fit).not.toHaveBeenCalled();
    expect(fly).not.toHaveBeenCalled();
    view.rerender(<RiskMap {...props} place={{ ...place, lat: 35.64, id: 2 }} />);
    expect(fly).toHaveBeenCalledWith([35.64, -120.86], 17, expect.any(Object));
  });
});
