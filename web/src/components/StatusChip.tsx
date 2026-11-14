import type { ScanStatus } from "@/lib/scan";

interface StatusChipProps {
  status: ScanStatus;
  risks: number;
  problem: boolean;
}

/** The pill at the top of the camera. Announced politely to screen readers. */
export function StatusChip({ status, risks, problem }: StatusChipProps) {
  let text = "Scanning";
  let tone = "";
  if (problem) {
    text = "Connection problem";
  } else if (status === "clear") {
    text = "All clear";
    tone = "border-low! text-low-ink";
  } else if (status === "risks") {
    text = `${risks} ${risks === 1 ? "risk" : "risks"} found`;
    tone = "border-high! text-high-ink";
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={`glass pointer-events-auto rounded-full! px-4 py-2.5 text-[15px] font-semibold ${tone}`}
    >
      {text}
    </div>
  );
}
