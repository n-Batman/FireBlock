"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CellCode } from "@/data/types";
import { COLS, regions, ROWS } from "@/lib/grid";
import { mapBoxToRect } from "@/lib/scan";

/** Same weight for both: a saturated colour at the same opacity. Neutral cells get no fill. */
const COLOUR = { risk: "#ff1f1f", clear: "#00e05a" } as const;

/**
 * The 12 x 8 grid as a heatmap over the frame. Touching cells of one colour are drawn as one region
 * with a single outline, so it reads as clean areas. The grid is laid over the whole frame exactly
 * as `object-cover` crops it.
 */
export function GridOverlay({ videoSize, cells }: { videoSize: { w: number; h: number } | null; cells: CellCode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const list = useMemo(() => regions(cells), [cells]);
  const rect = videoSize && box ? mapBoxToRect([0, 0, 1000, 1000], videoSize, box) : null;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      {rect && (
        <svg
          data-testid="grid-overlay"
          aria-hidden="true"
          viewBox={`0 0 ${COLS} ${ROWS}`}
          preserveAspectRatio="none"
          className="absolute"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {list.map((r, n) => (
            <g key={n} data-tone={r.tone}>
              <path
                data-testid="region-fill"
                shapeRendering="crispEdges"
                fill={COLOUR[r.tone]}
                fillOpacity={0.34}
                d={r.cells.map((i) => `M${i % COLS} ${Math.floor(i / COLS)}h1v1h-1z`).join("")}
              />
              <path
                fill="none"
                stroke={COLOUR[r.tone]}
                strokeWidth={2.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                d={r.edges.map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`).join("")}
              />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
