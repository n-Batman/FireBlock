export function MapLoading({ fading = false }: { fading?: boolean }) {
  return (
    <div role="status" className={`absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-4 bg-paper text-ink transition-opacity duration-200 motion-reduce:transition-none ${fading ? "pointer-events-none opacity-0" : "opacity-100"}`}>
      <span className="text-2xl font-semibold tracking-tight">FireBlock</span>
      <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-line border-t-ink motion-safe:animate-spin" />
      <span className="text-[15px] text-ink-2">Loading the map…</span>
    </div>
  );
}
