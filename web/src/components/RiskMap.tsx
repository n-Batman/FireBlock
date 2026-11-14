"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AttributionControl,
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from "react-leaflet";
import { animate } from "motion/react";
import type { LatLngBoundsExpression } from "leaflet";
import type { Level, Property } from "@/data/types";
import { levelOf, scoreOf } from "@/lib/score";
import { tileSource } from "@/lib/tiles";
import { useWide } from "@/lib/useWide";

// Literal colors for Leaflet: the risk colors from DESIGN.md.
const RISK_COLOR: Record<Level, string> = { low: "#5db67f", medium: "#e0a83a", high: "#e5675a" };
const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const HABITAT_RANK = 3;
const STAGGER = 0.06;
const EASE = [0.16, 1, 0.3, 1] as const;

function boundsOf(property: Property): LatLngBoundsExpression {
  const pts = property.blocks.flatMap((b) => b.polygon);
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

/** Keeps the blocks in the free space between the floating panels. No tile animation. */
function Fit({ bounds, panelOpen }: { bounds: LatLngBoundsExpression; panelOpen: boolean }) {
  const map = useMap();
  const wide = useWide();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize({ pan: false });
      const h = window.innerHeight;
      // Insets match the floating panels: rail and weather strip on desktop, bottom sheet on phones.
      const topLeft: [number, number] = wide ? [416, 120] : [32, panelOpen ? 92 : 172];
      const bottomRight: [number, number] = wide
        ? [(panelOpen ? 432 : 16) + 24, 108]
        : [32, Math.round(h * (panelOpen ? 0.55 : 0.4)) + (panelOpen ? 48 : 100)];
      map.fitBounds(bounds, { paddingTopLeft: topLeft, paddingBottomRight: bottomRight, animate: false });
    };
    fit();
    // Once the panel has finished sliding in, measure again.
    const t = window.setTimeout(fit, 320);
    return () => window.clearTimeout(t);
  }, [map, bounds, wide, panelOpen]);
  return null;
}

/** Fades the block outlines in, highest risk first. Overlays only, never tiles. */
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

interface RiskMapProps {
  property: Property;
  selectedId: string | null;
  onSelect: (id: string) => void;
  panelOpen: boolean;
}

export default function RiskMap({ property, selectedId, onSelect, panelOpen }: RiskMapProps) {
  const bounds = useMemo(() => boundsOf(property), [property]);
  const wide = useWide();
  const tiles = tileSource(process.env.NEXT_PUBLIC_ARCGIS_KEY);
  // Three failed tiles in a row means the imagery is not loading. Say so instead of staying grey.
  const [tileErrors, setTileErrors] = useState(0);

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
            <rect width="8" height="8" style={{ fill: "var(--surface)", fillOpacity: 0.6 }} />
            <line x1="0" y1="0" x2="0" y2="8" strokeWidth="2" style={{ stroke: "var(--ink)", strokeOpacity: 0.5 }} />
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
        bounds={bounds}
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
        {wide && !panelOpen && <ZoomControl position="bottomright" />}

        {property.blocks.map((block) => {
          if (block.kind === "habitat") {
            return (
              <Polygon
                key={block.id}
                positions={block.polygon}
                pathOptions={{
                  color: "#a4b4aa",
                  weight: 2,
                  dashArray: "5 4",
                  className: `block-poly rank-${HABITAT_RANK} habitat-poly`,
                }}
              >
                <Tooltip permanent direction="center" className="block-label">
                  <span className="label-in" style={{ animationDelay: `${HABITAT_RANK * 60 + 200}ms` }}>
                    No{"‑"}mow
                  </span>
                </Tooltip>
              </Polygon>
            );
          }
          const level = levelOf(scoreOf(block));
          const rank = RANK[level];
          const selected = block.id === selectedId;
          return (
            <Fragment key={block.id}>
              {/* Dark casing so every outline stays visible on light ground. */}
              <Polygon
                positions={block.polygon}
                pathOptions={{
                  color: "#050a07",
                  opacity: 0.75,
                  weight: 5,
                  fill: false,
                  interactive: false,
                  className: `block-poly rank-${rank}`,
                }}
              />
              <Polygon
                positions={block.polygon}
                pathOptions={{
                  color: selected ? "#e9eee8" : RISK_COLOR[level],
                  fillColor: RISK_COLOR[level],
                  weight: selected ? 4 : 3,
                  fillOpacity: selected ? 0.55 : 0.4,
                  className: `block-poly rank-${rank}`,
                }}
                eventHandlers={{ click: () => onSelect(block.id) }}
              >
                <Tooltip permanent direction="center" className="block-label">
                  <span className="label-in" style={{ animationDelay: `${rank * 60 + 200}ms` }}>
                    {block.name}
                  </span>
                </Tooltip>
              </Polygon>
            </Fragment>
          );
        })}

        <Fit bounds={bounds} panelOpen={panelOpen} />
        <Reveal />
      </MapContainer>
    </>
  );
}
