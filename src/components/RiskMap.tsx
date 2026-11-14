"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  MapContainer,
  Marker,
  Polygon,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { animate } from "motion/react";
import type { LatLngBoundsExpression } from "leaflet";
import type { Block, Level, ParcelUnit, Property } from "@/data/types";
import { boundsOfPolygon, labelPoint } from "@/lib/geo";
import type { View } from "@/lib/parcelApi";
import { toGeoJSON } from "@/lib/parcelUnits";
import { scaleColor } from "@/lib/riskScale";
import { levelOf, scoreOf } from "@/lib/score";
import { tileSource } from "@/lib/tiles";
import { useWide } from "@/lib/useWide";
import type { Place } from "@/lib/geocode";
import { ParcelOverlay } from "@/lib/ParcelOverlay";
import { ParcelAreas, useParcelDisplay } from "@/lib/ParcelAreas";

// Literal colors for Leaflet: the risk colors from DESIGN.md.
const RISK_COLOR: Record<Level, string> = { low: "#5db67f", medium: "#e0a83a", high: "#e5675a" };
const HABITAT_COLOR = "#b7c5bc";
/** A parcel with no score: a neutral outline, never a risk colour. */
const PARCEL_NEUTRAL = HABITAT_COLOR;
const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const HABITAT_RANK = 3;
const STAGGER = 0.06;
const EASE = [0.16, 1, 0.3, 1] as const;

// Full class strings so Tailwind can see them (they are used inside Leaflet's divIcon HTML).
const PILL_TONE: Record<Level | "habitat", string> = {
  low: "text-low-ink border-low/70",
  medium: "text-med-ink border-med/70",
  high: "text-high-ink border-high/70",
  habitat: "text-ink-2 border-[var(--glass-border)]",
};

/** A small score pill, centred on its point, for any block shape. */
function pillIcon(text: string, tone: string, selected: boolean, dim: boolean, color?: string) {
  // `color` is for parcels: the colour of the score on Nick's scale, in place of the level's tone classes.
  const style = color ? ` style="color:${color};border-color:${color}"` : "";
  return L.divIcon({
    className: "",
    iconSize: [0, 0],
    html: `<span${style} class="num inline-flex h-6 min-w-9 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border bg-[var(--glass-bg)] px-2 text-xs font-semibold backdrop-blur-md transition-opacity ${tone} ${
      selected ? "ring-2 ring-ink" : ""
    } ${dim ? "opacity-50" : ""}">${text}</span>`,
  });
}

function propertyBounds(property: Property): LatLngBoundsExpression {
  return boundsOfPolygon(property.blocks.flatMap((b) => b.polygon));
}

/**
 * Keeps the camera on the right thing in the free space between the floating panels: the whole
 * property, or the selected block. The first framing is instant; later ones fly (off when the
 * visitor prefers reduced motion).
 */
function Camera({ property, selected, panelOpen }: { property: Property; selected: Block | null; panelOpen: boolean }) {
  const map = useMap();
  const wide = useWide();
  const first = useRef(true);
  const bounds = useMemo(
    () => (selected ? boundsOfPolygon(selected.polygon) : propertyBounds(property)),
    [property, selected],
  );

  useEffect(() => {
    const h = window.innerHeight;
    const topLeft: [number, number] = wide ? [416, 96] : [32, panelOpen ? 92 : 224];
    const bottomRight: [number, number] = wide
      ? [(panelOpen ? 432 : 16) + 24, 88]
      : [76, Math.round(h * (panelOpen ? 0.55 : 0.4)) + (panelOpen ? 48 : 100)];
    const options = { paddingTopLeft: topLeft, paddingBottomRight: bottomRight, maxZoom: 18 };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    map.invalidateSize({ pan: false });
    if (first.current || reduce) {
      map.fitBounds(bounds, { ...options, animate: false });
      first.current = false;
    } else {
      map.flyToBounds(bounds, { ...options, duration: 0.6 });
    }
  }, [map, bounds, wide, panelOpen]);
  return null;
}

/** Fades the block outlines in, highest risk first. */
function Reveal() {
  const map = useMap();
  useEffect(() => {
    const els = map.getPane("overlayPane")?.querySelectorAll<SVGElement>(".block-poly") ?? [];
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const controls = [...els].map((el) => {
      if (reduce) {
        el.style.opacity = "1";
        return null;
      }
      const rank = Number(/rank-(\d)/.exec(el.getAttribute("class") ?? "")?.[1] ?? HABITAT_RANK);
      return animate(el, { opacity: 1 }, { duration: 0.3, delay: rank * STAGGER, ease: EASE });
    });
    return () => controls.forEach((c) => c?.stop());
  }, [map]);
  return null;
}

/** Reports the visible area 400 ms after the map stops moving, so panning does not fire a request per frame. */
export function ViewWatcher({ onView }: { onView: (view: View) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const map = useMapEvents({
    moveend() {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const b = map.getBounds();
        onView({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      }, 400);
    },
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return null;
}

/** A place picked in the address search. A new `id` means a new pick, even at the same point. */
export type PickedPlace = Place & { id: number };

/** Flies to the picked place (no animation when the visitor prefers reduced motion). */
function PlaceFocus({ place }: { place: PickedPlace | null }) {
  const map = useMap();
  useEffect(() => {
    if (!place) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    map.flyTo([place.lat, place.lon], 17, { animate: !reduce, duration: 1 });
  }, [map, place]);
  return null;
}

/**
 * County parcels as the clickable units, with the sample blocks' casing and selected glow. A scored
 * parcel is coloured on Nick's 0 to 100 scale. A parcel with no score is a neutral outline with no
 * pill. It is never given a colour.
 */
export function ParcelPolygons({
  parcels,
  selectedId,
  onSelect,
}: {
  parcels: ParcelUnit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { individuals, areas } = useParcelDisplay(parcels, selectedId);
  const selected = parcels.find((p) => p.id === selectedId) ?? null;
  // A scored parcel's outline, fill and glow use Nick's 0 to 100 scale, like its pill and chip.
  const colorOf = (p: ParcelUnit) => (p.score ? scaleColor(p.score.score) : PARCEL_NEUTRAL);
  return (
    <>
      <ParcelAreas areas={areas} />
      {individuals.map((parcel) => {
        const isSelected = parcel.id === selected?.id;
        const dim = selected !== null && !isSelected;
        const color = colorOf(parcel);
        const fillOpacity = parcel.score
          ? isSelected ? 0.22 : dim ? 0.06 : 0.15
          : isSelected ? 0.1 : dim ? 0.02 : 0.04;
        return (
          <Polygon
            key={parcel.id}
            positions={parcel.parts}
            pathOptions={{
              color,
              fillColor: color,
              weight: isSelected ? 4 : 2,
              opacity: dim ? 0.45 : 1,
              fillOpacity,
              lineJoin: "round",
            }}
            eventHandlers={{ click: () => onSelect(parcel.id) }}
          >
            <Tooltip sticky className="block-label">
              {`Parcel ${parcel.id}`}
            </Tooltip>
          </Polygon>
        );
      })}

      {/* Soft glow under the selected parcel's outline. */}
      {selected && (
        <Polygon
          positions={selected.parts}
          pathOptions={{ color: colorOf(selected), weight: 14, opacity: 0.25, fill: false, interactive: false, lineJoin: "round" }}
        />
      )}

      {individuals.map((parcel) => {
        if (!parcel.score) return null;
        const isSelected = parcel.id === selected?.id;
        const dim = selected !== null && !isSelected;
        const label = `Parcel ${parcel.id}, score ${parcel.score.score}`;
        return (
          <Marker
            key={`pill-${parcel.id}`}
            position={parcel.center}
            icon={pillIcon(String(parcel.score.score), "", isSelected, dim, scaleColor(parcel.score.score))}
            title={label}
            alt={label}
            zIndexOffset={isSelected ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(parcel.id) }}
          />
        );
      })}
    </>
  );
}

interface RiskMapProps {
  property: Property;
  selectedId: string | null;
  onSelect: (id: string) => void;
  panelOpen: boolean;
  place?: PickedPlace | null;
  /** County parcels for a searched place. When given, they replace the sample blocks. */
  parcels?: ParcelUnit[] | null;
  /** A point looked up through his latitude/longitude fields or "Pick on map". */
  onPoint?: (point: { lat: number; lon: number }) => void;
  /** Called with the visible area 400 ms after the map stops moving. */
  onView?: (view: View) => void;
}

export default function RiskMap({ property, selectedId, onSelect, panelOpen, place = null, parcels = null, onPoint, onView }: RiskMapProps) {
  const wide = useWide();
  const tiles = tileSource(process.env.NEXT_PUBLIC_ARCGIS_KEY);
  // Three failed tiles in a row means the imagery is not loading. Say so instead of staying grey.
  const [tileErrors, setTileErrors] = useState(0);
  // Nick's rule: once a backend risk grid is loaded, the sample blocks (but not habitat) are hidden.
  const [gridActive, setGridActive] = useState(false);

  // With county parcels on the map, or a loaded grid, the sample blocks are not drawn.
  const blocks = parcels ? [] : property.blocks.filter((b) => !gridActive || b.kind === "habitat");
  // The parcels on screen, as shapes, so the underlying grid is not drawn under them.
  const parcelMask = useMemo(() => parcels?.map(toGeoJSON), [parcels]);
  const selected = blocks.find((b) => b.id === selectedId && b.kind === "vine") ?? null;
  const labels = useMemo(
    () => new Map(property.blocks.map((b) => [b.id, labelPoint(b.polygon)] as const)),
    [property],
  );

  return (
    <>
      {/* Hatch pattern for no-mow habitat polygons (referenced from CSS). */}
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <defs>
          <pattern
            id="habitat-hatch"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" style={{ fill: "var(--surface)", fillOpacity: 0.35 }} />
            <line x1="0" y1="0" x2="0" y2="8" strokeWidth="2" style={{ stroke: "var(--ink)", strokeOpacity: 0.45 }} />
          </pattern>
        </defs>
      </svg>

      {tileErrors >= 3 && (
        <p
          role="status"
          className="glass pointer-events-none absolute left-1/2 top-28 z-[1000] -translate-x-1/2 px-4 py-2 text-[15px] font-medium"
        >
          The satellite imagery is not loading. Check your connection.
        </p>
      )}

      <MapContainer
        bounds={propertyBounds(property)}
        boundsOptions={{ padding: [56, 56] }}
        maxZoom={19}
        zoomControl={false}
        attributionControl={false}
        className="h-full w-full"
      >
        <TileLayer
          url={tiles.url}
          attribution={tiles.attribution}
          maxZoom={19}
          eventHandlers={{
            tileerror: () => setTileErrors((n) => n + 1),
            tileload: () => setTileErrors(0),
          }}
        />
        {/* Esri attribution stays visible. The "Leaflet" prefix link is dropped (it is a tiny tap target). */}
        <AttributionControl prefix={false} />
        {/* Phones: top right, below the header. Desktop: bottom right, hidden behind an open panel. */}
        {!(wide && panelOpen) && (
          <ZoomControl key={wide ? "wide" : "narrow"} position={wide ? "bottomright" : "topright"} />
        )}
        <ParcelOverlay center={property.center} lookup={place && { lat: place.lat, lon: place.lon, id: place.id }} onPoint={onPoint} onGridActive={setGridActive} showGridByDefault={false} parcelMask={parcelMask} />
        {onView && <ViewWatcher onView={onView} />}
        <PlaceFocus place={place} />

        {parcels && <ParcelPolygons parcels={parcels} selectedId={selectedId} onSelect={onSelect} />}

        {blocks.map((block) => {
          const dim = selected !== null && block.id !== selected.id;

          if (block.kind === "habitat") {
            return (
              <Polygon
                key={block.id}
                positions={block.polygon}
                pathOptions={{
                  color: HABITAT_COLOR,
                  weight: 2,
                  opacity: dim ? 0.45 : 0.9,
                  dashArray: "5 4",
                  lineJoin: "round",
                  className: `block-poly rank-${HABITAT_RANK} habitat-poly`,
                }}
              >
                <Tooltip sticky className="block-label">
                  {block.name}
                </Tooltip>
              </Polygon>
            );
          }

          const level = levelOf(scoreOf(block));
          const color = RISK_COLOR[level];
          const isSelected = block.id === selected?.id;
          return (
            <Polygon
              key={block.id}
              positions={block.polygon}
              pathOptions={{
                color,
                fillColor: color,
                weight: isSelected ? 4 : 2,
                opacity: dim ? 0.45 : 1,
                fillOpacity: isSelected ? 0.22 : dim ? 0.06 : 0.15,
                lineJoin: "round",
                className: `block-poly rank-${RANK[level]}`,
              }}
              eventHandlers={{ click: () => onSelect(block.id) }}
            >
              <Tooltip sticky className="block-label">
                {block.name}
              </Tooltip>
            </Polygon>
          );
        })}

        {/* Soft glow under the selected block's outline. */}
        {selected && (
          <Polygon
            positions={selected.polygon}
            pathOptions={{
              color: RISK_COLOR[levelOf(scoreOf(selected))],
              weight: 14,
              opacity: 0.25,
              fill: false,
              interactive: false,
              lineJoin: "round",
            }}
          />
        )}

        {blocks.map((block) => {
          const point = labels.get(block.id)!;
          const dim = selected !== null && block.id !== selected.id;
          if (block.kind === "habitat") {
            return (
              <Marker
                key={`pill-${block.id}`}
                position={point}
                icon={pillIcon("No‑mow", PILL_TONE.habitat, false, dim)}
                title={block.name}
                keyboard={false}
                interactive={false}
              />
            );
          }
          const score = scoreOf(block);
          const isSelected = block.id === selected?.id;
          return (
            <Marker
              key={`pill-${block.id}`}
              position={point}
              icon={pillIcon(String(score), PILL_TONE[levelOf(score)], isSelected, dim)}
              title={`${block.name}, score ${score}`}
              alt={`${block.name}, score ${score}`}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{ click: () => onSelect(block.id) }}
            >
              <Tooltip direction="top" offset={[0, -14]} className="block-label">
                {block.name}
              </Tooltip>
            </Marker>
          );
        })}

        {!parcels && <Camera property={property} selected={selected} panelOpen={panelOpen} />}
        {!parcels && <Reveal />}
      </MapContainer>
    </>
  );
}
