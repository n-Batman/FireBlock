export function LayerToggles({ showParcels, showGrid, onParcels, onGrid }: {
  showParcels: boolean;
  showGrid: boolean;
  onParcels: () => void;
  onGrid: () => void;
}) {
  const button = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-white/5 active:scale-[0.98] aria-pressed:bg-ink aria-pressed:text-paper";
  return (
    <div aria-label="Map layers" className="glass flex flex-wrap gap-2 p-1.5">
      <button type="button" aria-pressed={showParcels} onClick={onParcels} className={button}>Property boundaries</button>
      <button type="button" aria-pressed={showGrid} onClick={onGrid} className={button}>Risk grid</button>
    </div>
  );
}
