"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useSyncExternalStore } from "react";
import { MapContainer, Polygon, TileLayer, Tooltip, ZoomControl, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { Property } from "@/data/types";
import { levelOf, scoreOf } from "@/lib/score";

// Leaflet needs literal colors. Mid-tones that read on both light and dark tiles.
const RISK_COLOR = { low: "#2f7d4f", medium: "#b97a06", high: "#bf3a28" } as const;

function boundsOf(property: Property): LatLngBoundsExpression {
  const pts = property.blocks.flatMap((b) => b.polygon);
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

const WIDE = "(min-width: 1024px)";
function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

/** Re-fits the map, leaving room on the right while the breakdown panel covers it. */
function Fit({ bounds, rightInset }: { bounds: LatLngBoundsExpression; rightInset: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, {
      paddingTopLeft: [24, 24],
      paddingBottomRight: [24 + rightInset, 24],
    });
  }, [map, bounds, rightInset]);
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
  const rightInset = panelOpen && wide ? 416 : 0;

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

      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [56, 56] }}
        maxZoom={19}
        zoomControl={false}
        className="h-full w-full"
      >
        {/* Satellite imagery works in light and dark mode and shows the actual rows. */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
          attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
        />
        {!(panelOpen && wide) && <ZoomControl position="topright" />}
        <Fit bounds={bounds} rightInset={rightInset} />

        {property.blocks.map((block) => {
          if (block.kind === "habitat") {
            return (
              <Polygon
                key={block.id}
                positions={block.polygon}
                pathOptions={{ color: "#4a5a52", weight: 2, dashArray: "5 4", className: "habitat-poly" }}
              >
                <Tooltip permanent direction="center" className="block-label">
                  No-mow
                </Tooltip>
              </Polygon>
            );
          }
          const level = levelOf(scoreOf(block));
          const selected = block.id === selectedId;
          return (
            <Fragment key={block.id}>
              {/* Dark casing so every outline stays visible on golden hillsides. */}
              <Polygon
                positions={block.polygon}
                pathOptions={{ color: "#0b130f", opacity: 0.75, weight: 5, fill: false, interactive: false }}
              />
              <Polygon
                positions={block.polygon}
                pathOptions={{
                  color: selected ? "#ffffff" : RISK_COLOR[level],
                  fillColor: RISK_COLOR[level],
                  weight: selected ? 4 : 3,
                  fillOpacity: selected ? 0.6 : 0.45,
                }}
                eventHandlers={{ click: () => onSelect(block.id) }}
              >
                <Tooltip permanent direction="center" className="block-label">
                  {block.name.replace("Block ", "")}
                </Tooltip>
              </Polygon>
            </Fragment>
          );
        })}
      </MapContainer>
    </>
  );
}
