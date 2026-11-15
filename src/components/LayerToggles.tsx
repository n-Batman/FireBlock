import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { useMap } from "react-leaflet";

export function LayerToggles({ showParcels, showGrid, onParcels, onGrid }: {
  showParcels: boolean;
  showGrid: boolean;
  onParcels: () => void;
  onGrid: () => void;
}) {
  const map = useMap();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = L.DomUtil.create("div");
    node.className = "absolute left-4 bottom-[calc(40dvh+8rem)] z-[800] lg:bottom-auto lg:top-32";
    L.DomEvent.disableClickPropagation(node);
    L.DomEvent.disableScrollPropagation(node);
    map.getContainer().appendChild(node);
    setHost(node);
    return () => node.remove();
  }, [map]);
  const button = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-white/5 active:scale-[0.98] aria-pressed:bg-ink aria-pressed:text-paper";
  return host && createPortal(
    <div aria-label="Map layers" className="glass flex flex-wrap gap-2 p-1.5">
      <button type="button" aria-pressed={showParcels} onClick={onParcels} className={button}>Property boundaries</button>
      <button type="button" aria-pressed={showGrid} onClick={onGrid} className={button}>Risk grid</button>
    </div>, host,
  );
}
