"use client";

import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { DATA_LIMITS } from "@/content/dataLimits";

export function DataLimitsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep Tab inside the dialog while it is open.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-paper/70" onClick={onClose} aria-hidden="true" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-limits-title"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface p-6 sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="data-limits-title" className="text-xl font-semibold tracking-tight">
            {DATA_LIMITS.title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-[var(--r)] text-ink-2 transition-colors hover:text-ink"
          >
            <X size={20} weight="regular" />
          </button>
        </div>

        {DATA_LIMITS.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h3 className="text-[15px] font-semibold">{section.heading}</h3>
            <ul className="mt-3 list-disc space-y-3 pl-5 text-[15px] leading-relaxed text-ink-2 marker:text-ink-2">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </aside>
    </div>
  );
}
