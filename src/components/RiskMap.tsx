"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useState } from "react";
import { MapContainer, Polygon, TileLayer, Tooltip, ZoomControl } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { Property } from "@/data/types";
import { levelOf, scoreOf } from "@/lib/score";
import { ParcelOverlay } from "@/lib/ParcelOverlay";

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

interface RiskMapProps {
  property: Property;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function RiskMap({ property, selectedId, onSelect }: RiskMapProps) {
  const [gridActive,setGridActive]=useState(false);
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
        bounds={boundsOf(property)}
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
        <ZoomControl position="topright" />
        <ParcelOverlay center={property.center} onGridActive={setGridActive} />

        {property.blocks.filter(block=>!gridActive||block.kind==="habitat").map((block) => {
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
