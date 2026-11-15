"use client";

import { useEffect, useRef, useState } from "react";
import { RISK, CLEAR, type FuelMap } from "@/lib/fuelMask";
import { mapBoxToRect, type Fit } from "@/lib/scan";

/** Clear is a clearly visible green wash with a softer edge; risk is a stronger red with a soft thin edge. */
const CLEAR_RGBA = [74, 222, 128, 0.32] as const;
const CLEAR_EDGE_ALPHA = 0.18;
const RISK_RGBA = [239, 68, 68, 0.38] as const;
const EDGE_ALPHA = 0.85;

/** Paints the fuel map into RGBA pixels: fills, plus a one-pixel edge where risk meets anything else. */
export function paint(map: Pick<FuelMap, "w" | "h" | "labels">, out: Uint8ClampedArray): void {
  const { w, h, labels } = map;
  for (let i = 0; i < w * h; i++) {
    const l = labels[i];
    const o = i * 4;
    if (l === CLEAR) {
      const x = i % w;
      const y = (i - x) / w;
      const soft =
        (x > 0 && labels[i - 1] !== CLEAR) ||
        (x < w - 1 && labels[i + 1] !== CLEAR) ||
        (y > 0 && labels[i - w] !== CLEAR) ||
        (y < h - 1 && labels[i + w] !== CLEAR);
      out.set([CLEAR_RGBA[0], CLEAR_RGBA[1], CLEAR_RGBA[2], Math.round((soft ? CLEAR_EDGE_ALPHA : CLEAR_RGBA[3]) * 255)], o);
    } else if (l === RISK) {
      const x = i % w;
      const y = (i - x) / w;
      const edge =
        (x > 0 && labels[i - 1] !== RISK) ||
        (x < w - 1 && labels[i + 1] !== RISK) ||
        (y > 0 && labels[i - w] !== RISK) ||
        (y < h - 1 && labels[i + w] !== RISK);
      out.set([RISK_RGBA[0], RISK_RGBA[1], RISK_RGBA[2], Math.round((edge ? EDGE_ALPHA : RISK_RGBA[3]) * 255)], o);
    } else {
      out.set([0, 0, 0, 0], o);
    }
  }
}

/**
 * The fuel map over the frame, laid exactly where `fit` puts the picture (`object-cover` by default). The small map is
 * scaled up with smoothing and a slight blur, so the shapes hug the real areas without blocks or a grid.
 */
export function FuelOverlay({ videoSize, map, fit }: { videoSize: { w: number; h: number } | null; map: FuelMap; fit?: Fit }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(map.w, map.h);
    paint(map, img.data);
    ctx.putImageData(img, 0, 0);
  }, [map]);

  const rect = videoSize && size ? mapBoxToRect([0, 0, 1000, 1000], videoSize, size, fit) : null;
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas
        ref={canvas}
        data-testid="fuel-overlay"
        aria-hidden="true"
        width={map.w}
        height={map.h}
        className="absolute blur-[1.5px]"
        style={rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height } : { display: "none" }}
      />
    </div>
  );
}
